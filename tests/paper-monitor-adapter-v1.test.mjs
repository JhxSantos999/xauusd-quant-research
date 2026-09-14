import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

import {
  consumePaperMonitorMessageV1,
  createPaperMonitorSinkV1,
  journalPaperMonitorMessageV1,
  serializePaperMonitorRecordV1,
  PAPER_MONITOR_ADAPTER_V1_INTEGRITY,
  PAPER_MONITOR_ADAPTER_V1_MODE,
  PAPER_MONITOR_ADAPTER_V1_VERSION,
} from '../dist/adapters/paper/paper-monitor-adapter-v1.js';
import {
  buildSignalBridgeEnvelopeV1,
  publishSignalBridgeEnvelopeV1,
  serializeSignalBridgeEnvelopeV1,
} from '../dist/quant-core/bridge/signal-bridge-v1.js';
import { evaluateRiskV1 } from '../dist/quant-core/risk/risk-engine.js';

const lineage = Object.freeze({
  finalSignalExecutionId: 'final_signal_v1r1_20260913235306128',
  finalSignalModelSha256: 'f4869afd3cfeb681bca356ee08d80a63fb617a841427932a571ff2e2306f7655',
  finalSignalCalibratorSha256: '6d851a2eaa61deaa00bc2bc7899ad40fabc5b8758cd58ed933782709996ac17c',
});

function signal(calibratedProbability = 0.6) {
  return {
    asset: 'XAUUSD',
    timeframe: 'M5',
    decisionTime: 1_800_000_000_000,
    decisionClose: 3000,
    atrSma12OverClose: 0.001,
    rawProbability: 0.57,
    calibratedProbability,
  };
}

function bridgeMessage(probability = 0.6, positionState = 'FLAT') {
  const sig = signal(probability);
  const riskDecision = evaluateRiskV1({
    ...sig,
    accountEquityQuote: 10_000,
    positionState,
    ...lineage,
  }, lineage);
  const envelope = buildSignalBridgeEnvelopeV1({ signal: sig, lineage, riskDecision }, lineage);
  return { envelope, serialized: serializeSignalBridgeEnvelopeV1(envelope) };
}

test('Paper Monitor Adapter V1 preserves validated LONG bridge identity and copies risk telemetry without mutation', () => {
  const { envelope, serialized } = bridgeMessage(0.6);
  const receivedAtMs = signal().decisionTime + 1234;
  const record = consumePaperMonitorMessageV1(serialized, lineage, receivedAtMs);
  assert.equal(record.version, PAPER_MONITOR_ADAPTER_V1_VERSION);
  assert.equal(record.mode, PAPER_MONITOR_ADAPTER_V1_MODE);
  assert.equal(record.integrity, PAPER_MONITOR_ADAPTER_V1_INTEGRITY);
  assert.equal(record.eventId, envelope.eventId);
  assert.equal(record.bridgeMessageSha256, crypto.createHash('sha256').update(serialized, 'utf8').digest('hex'));
  assert.equal(record.receivedAtMs, receivedAtMs);
  assert.equal(record.receiptDelayMs, 1234);
  assert.equal(record.decision, 'LONG');
  assert.equal(record.noTradeReason, null);
  assert.equal(record.stopDistancePrice, envelope.payload.riskDecision.stopDistancePrice);
  assert.equal(record.timeExitTime, envelope.payload.riskDecision.timeExitTime);
  assert.equal(record.finalSignalExecutionId, lineage.finalSignalExecutionId);
  assert.equal(Object.isFrozen(record), true);
});

test('Paper Monitor Adapter V1 derives SHORT and NO_TRADE only from the validated frozen bridge decision', () => {
  const short = bridgeMessage(0.4);
  const shortRecord = consumePaperMonitorMessageV1(short.serialized, lineage, signal().decisionTime + 10);
  assert.equal(shortRecord.decision, 'SHORT');
  assert.equal(shortRecord.noTradeReason, null);
  assert.equal(shortRecord.stopDistancePrice, short.envelope.payload.riskDecision.stopDistancePrice);

  const exactHalf = bridgeMessage(0.5);
  const halfRecord = consumePaperMonitorMessageV1(exactHalf.serialized, lineage, signal().decisionTime + 20);
  assert.equal(halfRecord.decision, 'NO_TRADE');
  assert.equal(halfRecord.noTradeReason, 'PROBABILITY_EXACTLY_0_5');
  assert.equal(halfRecord.riskFraction, null);
  assert.equal(halfRecord.maxQuoteRisk, null);
  assert.equal(halfRecord.stopDistancePrice, null);
  assert.equal(halfRecord.timeExitTime, null);

  const positionOpen = bridgeMessage(0.7, 'LONG');
  const openRecord = consumePaperMonitorMessageV1(positionOpen.serialized, lineage, signal().decisionTime + 30);
  assert.equal(openRecord.decision, 'NO_TRADE');
  assert.equal(openRecord.noTradeReason, 'POSITION_ALREADY_OPEN');
});

test('Paper Monitor timing is telemetry only: negative receipt delay from clock skew is recorded and never changes decision', () => {
  const { serialized } = bridgeMessage(0.6);
  const receivedAtMs = signal().decisionTime - 250;
  const record = consumePaperMonitorMessageV1(serialized, lineage, receivedAtMs);
  assert.equal(record.receiptDelayMs, -250);
  assert.equal(record.decision, 'LONG');
  assert.equal(record.calibratedProbability, 0.6);
});

test('Paper Monitor rejects tampered, noncanonical, wrong-lineage and invalid-clock bridge observations', () => {
  const { serialized } = bridgeMessage(0.6);
  const tampered = JSON.parse(serialized);
  tampered.payload.signal.calibratedProbability = 0.9;
  assert.throws(() => consumePaperMonitorMessageV1(JSON.stringify(tampered), lineage, signal().decisionTime), /MISMATCH/);
  const pretty = JSON.stringify(JSON.parse(serialized), null, 2);
  assert.throws(() => consumePaperMonitorMessageV1(pretty, lineage, signal().decisionTime), /NON_CANONICAL_SERIALIZATION/);
  assert.throws(() => consumePaperMonitorMessageV1(serialized, {
    ...lineage,
    finalSignalExecutionId: 'wrong',
  }, signal().decisionTime), /LINEAGE_MISMATCH/);
  assert.throws(() => consumePaperMonitorMessageV1(serialized, lineage, 1.5), /INVALID_RECEIVED_AT/);
});

test('Paper Monitor canonical record serialization is deterministic with fixed fields', () => {
  const { serialized } = bridgeMessage(0.6);
  const record = consumePaperMonitorMessageV1(serialized, lineage, signal().decisionTime + 100);
  const a = serializePaperMonitorRecordV1(record);
  const b = serializePaperMonitorRecordV1(record);
  assert.equal(a, b);
  assert.equal(a.includes('\n'), false);
  assert.deepEqual(Object.keys(JSON.parse(a)), [
    'version', 'mode', 'integrity', 'eventId', 'bridgeMessageSha256', 'receivedAtMs', 'decisionTime',
    'receiptDelayMs', 'asset', 'timeframe', 'finalSignalExecutionId', 'finalSignalModelSha256',
    'finalSignalCalibratorSha256', 'decision', 'noTradeReason', 'rawProbability', 'calibratedProbability',
    'decisionClose', 'atrSma12OverClose', 'riskFraction', 'maxQuoteRisk', 'maxGrossNotionalQuote',
    'stopDistancePrice', 'timeExitTime',
  ]);
});

test('Paper Monitor sink consumes Signal Bridge publish path, records duplicates for observability, and propagates journal failure', async () => {
  const { envelope } = bridgeMessage(0.6);
  const lines = [];
  let now = signal().decisionTime + 100;
  const sink = createPaperMonitorSinkV1(lineage, { nowMs: () => now }, { appendLine: line => lines.push(line) });
  await publishSignalBridgeEnvelopeV1(envelope, [sink]);
  now += 50;
  await publishSignalBridgeEnvelopeV1(envelope, [sink]);
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  const second = JSON.parse(lines[1]);
  assert.equal(first.eventId, envelope.eventId);
  assert.equal(second.eventId, envelope.eventId);
  assert.equal(first.receivedAtMs, signal().decisionTime + 100);
  assert.equal(second.receivedAtMs, signal().decisionTime + 150);

  const directLines = [];
  const serialized = serializeSignalBridgeEnvelopeV1(envelope);
  const receipt = await journalPaperMonitorMessageV1(serialized, lineage, signal().decisionTime + 200, {
    appendLine: line => directLines.push(line),
  });
  assert.equal(receipt.eventId, envelope.eventId);
  assert.equal(receipt.journaled, true);
  assert.equal(directLines.length, 1);

  const failingSink = createPaperMonitorSinkV1(lineage, { nowMs: () => signal().decisionTime + 300 }, {
    appendLine() { throw new Error('JOURNAL_FAILURE'); },
  });
  await assert.rejects(() => publishSignalBridgeEnvelopeV1(envelope, [failingSink]), /JOURNAL_FAILURE/);
});

test('Paper Monitor Adapter V1 library contains no filesystem, network, execution, economic, lockbox, broker or browser coupling', () => {
  const source = fs.readFileSync('adapters/paper/paper-monitor-adapter-v1.ts', 'utf8');
  for (const forbidden of [
    "node:fs", "node:http", "node:https", "node:net", 'WebSocket', 'fetch(',
    '../../quant-core/execution/', '../../quant-core/economic/', '../../quant-core/lockbox/',
    'submitOrder', 'sendOrder', 'OrderSend', 'browser.', 'page.click', 'profitFactor', 'pnl',
  ]) {
    assert.equal(source.includes(forbidden), false, `forbidden coupling: ${forbidden}`);
  }
});
