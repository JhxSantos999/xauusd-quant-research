import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildSignalBridgeEnvelopeV1,
  parseSignalBridgeEnvelopeV1,
  publishSignalBridgeEnvelopeV1,
  serializeSignalBridgeEnvelopeV1,
  SIGNAL_BRIDGE_V1_EVENT_TYPE,
  SIGNAL_BRIDGE_V1_MODE,
  SIGNAL_BRIDGE_V1_VERSION,
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

function riskFor(sig, positionState = 'FLAT') {
  return evaluateRiskV1({
    ...sig,
    accountEquityQuote: 10_000,
    positionState,
    ...lineage,
  }, lineage);
}

test('Signal Bridge V1 is deterministic byte-for-byte and has no wall-clock field', () => {
  const sig = signal(0.6);
  const input = { signal: sig, lineage, riskDecision: riskFor(sig) };
  const a = buildSignalBridgeEnvelopeV1(input, lineage);
  const b = buildSignalBridgeEnvelopeV1(input, lineage);
  assert.equal(a.version, SIGNAL_BRIDGE_V1_VERSION);
  assert.equal(a.mode, SIGNAL_BRIDGE_V1_MODE);
  assert.equal(a.eventType, SIGNAL_BRIDGE_V1_EVENT_TYPE);
  assert.match(a.eventId, /^[0-9a-f]{64}$/);
  assert.equal(a.eventId, b.eventId);
  assert.equal(serializeSignalBridgeEnvelopeV1(a), serializeSignalBridgeEnvelopeV1(b));
  const text = serializeSignalBridgeEnvelopeV1(a);
  assert.equal(text.includes('emittedAt'), false);
  assert.equal(text.includes('Date.now'), false);
});

test('Signal Bridge V1 round-trips canonical serialized LONG, SHORT and NO_TRADE decisions', () => {
  for (const [probability, positionState] of [[0.6, 'FLAT'], [0.4, 'FLAT'], [0.5, 'FLAT'], [0.7, 'LONG']]) {
    const sig = signal(probability);
    const envelope = buildSignalBridgeEnvelopeV1({ signal: sig, lineage, riskDecision: riskFor(sig, positionState) }, lineage);
    const serialized = serializeSignalBridgeEnvelopeV1(envelope);
    const parsed = parseSignalBridgeEnvelopeV1(serialized, lineage);
    assert.equal(parsed.eventId, envelope.eventId);
    assert.equal(serializeSignalBridgeEnvelopeV1(parsed), serialized);
  }
});

test('Signal Bridge V1 rejects lineage, direction, stop and decision-time mutation', () => {
  const sig = signal(0.6);
  const validRisk = riskFor(sig);
  assert.throws(() => buildSignalBridgeEnvelopeV1({
    signal: sig,
    lineage: { ...lineage, finalSignalExecutionId: 'wrong' },
    riskDecision: validRisk,
  }, lineage), /LINEAGE_MISMATCH/);
  assert.throws(() => buildSignalBridgeEnvelopeV1({
    signal: sig,
    lineage,
    riskDecision: { ...validRisk, side: 'SHORT' },
  }, lineage), /SIDE_MISMATCH/);
  assert.throws(() => buildSignalBridgeEnvelopeV1({
    signal: sig,
    lineage,
    riskDecision: { ...validRisk, stopDistancePrice: validRisk.stopDistancePrice + 0.01 },
  }, lineage), /STOP_DISTANCE_MISMATCH/);
  assert.throws(() => buildSignalBridgeEnvelopeV1({
    signal: sig,
    lineage,
    riskDecision: { ...validRisk, decisionTime: validRisk.decisionTime + 300000 },
  }, lineage), /DECISION_TIME_MISMATCH/);
});

test('Signal Bridge V1 rejects tampering and non-canonical JSON', () => {
  const sig = signal(0.6);
  const envelope = buildSignalBridgeEnvelopeV1({ signal: sig, lineage, riskDecision: riskFor(sig) }, lineage);
  const serialized = serializeSignalBridgeEnvelopeV1(envelope);
  const tampered = JSON.parse(serialized);
  tampered.payload.signal.calibratedProbability = 0.9;
  assert.throws(() => parseSignalBridgeEnvelopeV1(JSON.stringify(tampered), lineage), /MISMATCH/);
  const pretty = JSON.stringify(JSON.parse(serialized), null, 2);
  assert.throws(() => parseSignalBridgeEnvelopeV1(pretty, lineage), /NON_CANONICAL_SERIALIZATION/);
});

test('Signal Bridge V1 envelopes are frozen and core publishing is sink-only, ordered and fail-closed', async () => {
  const sig = signal(0.6);
  const envelope = buildSignalBridgeEnvelopeV1({ signal: sig, lineage, riskDecision: riskFor(sig) }, lineage);
  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.payload), true);
  assert.equal(Object.isFrozen(envelope.payload.signal), true);
  assert.equal(Object.isFrozen(envelope.payload.lineage), true);
  assert.equal(Object.isFrozen(envelope.payload.riskDecision), true);

  const calls = [];
  const receipt = await publishSignalBridgeEnvelopeV1(envelope, [
    { publish(value) { calls.push(`a:${value.eventId}`); } },
    { async publish(value) { calls.push(`b:${value.eventId}`); } },
  ]);
  assert.deepEqual(calls, [`a:${envelope.eventId}`, `b:${envelope.eventId}`]);
  assert.equal(receipt.sinkCount, 2);

  const failCalls = [];
  await assert.rejects(() => publishSignalBridgeEnvelopeV1(envelope, [
    { publish() { failCalls.push('first'); } },
    { publish() { failCalls.push('fail'); throw new Error('SINK_FAILURE'); } },
    { publish() { failCalls.push('must-not-run'); } },
  ]), /SINK_FAILURE/);
  assert.deepEqual(failCalls, ['first', 'fail']);
});

test('Signal Bridge V1 core contains no network, filesystem, execution, economic or lockbox coupling', () => {
  const source = fs.readFileSync('quant-core/bridge/signal-bridge-v1.ts', 'utf8');
  assert.equal(source.includes("node:http"), false);
  assert.equal(source.includes("node:https"), false);
  assert.equal(source.includes("node:net"), false);
  assert.equal(source.includes("node:fs"), false);
  assert.equal(source.includes('WebSocket'), false);
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes("../execution/"), false);
  assert.equal(source.includes("../economic/"), false);
  assert.equal(source.includes("../lockbox/"), false);
  assert.equal(source.includes('submitOrder'), false);
  assert.equal(source.includes('sendOrder'), false);
});
