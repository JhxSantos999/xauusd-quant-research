import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  MT5_READONLY_SIGNAL_TRANSPORT_V1_EXPECTED_RECORD_COUNT,
  MT5_READONLY_SIGNAL_TRANSPORT_V1_MAGIC,
  MT5_READONLY_SIGNAL_TRANSPORT_V1_VERSION,
  buildMt5ReadOnlySignalTransportV1,
  serializeMt5ReadOnlySignalTransportV1,
  validateAndSelectLatestDevObservabilityLineV1,
  writeMt5ReadOnlySignalFileV1,
} from '../dist/adapters/mt5/readonly-signal-transport-v1.js';
import { serializePaperMonitorRecordV1 } from '../dist/adapters/paper/paper-monitor-adapter-v1.js';

const EXECUTION_ID = 'final_signal_v1r1_20260913235306128';
const MODEL_SHA = 'f4869afd3cfeb681bca356ee08d80a63fb617a841427932a571ff2e2306f7655';
const CALIBRATOR_SHA = '6d851a2eaa61deaa00bc2bc7899ad40fabc5b8758cd58ed933782709996ac17c';
const FIRST = 1788842100000;
const LAST = 1788931800000;

const identities = {
  core: {
    path: 'adapters/mt5/readonly-signal-transport-v1.ts',
    bytes: 9944,
    sha256: 'c3b8374051f847d00853ccc1dbcf5424d1e899dc78884a7ad3eda79602fc8061',
  },
  cli: {
    path: 'quant-core/cli/run-mt5-readonly-transport-v1.ts',
    bytes: 3290,
    sha256: '15cd92b009a2b2dddbd3ce27cdb4a8158400e9fa2264e038373622867093e44f',
  },
  receiver: {
    path: 'adapters/mt5/MT5_ReadOnly_Signal_Receiver_V1.mq5',
    bytes: 7199,
    sha256: 'ed7485ebd487b1c0b3767feba1d3b90fcbfc5dc7b78728f03b0e0ea24621413c',
  },
  spec: {
    path: 'adapters/mt5/mt5_readonly_signal_receiver_v1.spec.json',
    bytes: 2437,
    sha256: '6d5e7c766878b43ab05c6dae976831375c20f5fab0700e23978eeea92ea87f5b',
  },
  implementation: {
    path: 'adapters/mt5/mt5_readonly_signal_receiver_v1.implementation.json',
    bytes: 1129,
    sha256: '9de9404cd64dc5cd572d5d05ff7e232acab3ec6123d8d9b77571782def337051',
  },
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function monitorRecord(decisionTime, index = 0, decision = 'LONG') {
  const eventId = sha256(`event-${index}-${decisionTime}`);
  const bridgeMessageSha256 = sha256(`bridge-${index}-${decisionTime}`);
  const isTrade = decision !== 'NO_TRADE';
  return {
    version: 'paper_monitor_adapter_v1',
    mode: 'PAPER_MONITOR_ONLY',
    integrity: 'VALID',
    eventId,
    bridgeMessageSha256,
    receivedAtMs: decisionTime,
    decisionTime,
    receiptDelayMs: 0,
    asset: 'XAUUSD',
    timeframe: 'M5',
    finalSignalExecutionId: EXECUTION_ID,
    finalSignalModelSha256: MODEL_SHA,
    finalSignalCalibratorSha256: CALIBRATOR_SHA,
    decision,
    noTradeReason: isTrade ? null : 'PROBABILITY_EXACTLY_0_5',
    rawProbability: isTrade ? 0.48 : 0.5,
    calibratedProbability: decision === 'LONG' ? 0.51 : decision === 'SHORT' ? 0.49 : 0.5,
    decisionClose: 4373.01,
    atrSma12OverClose: 0.0009038396893672661,
    riskFraction: isTrade ? 0.0025 : null,
    maxQuoteRisk: isTrade ? 25 : null,
    maxGrossNotionalQuote: isTrade ? 10000 : null,
    stopDistancePrice: isTrade ? 3.9524999999999486 : null,
    timeExitTime: isTrade ? decisionTime + 900000 : null,
  };
}

function canonicalLine(decisionTime, index = 0, decision = 'LONG') {
  return serializePaperMonitorRecordV1(monitorRecord(decisionTime, index, decision));
}

function canonicalJournal() {
  const lines = [];
  for (let i = 0; i < MT5_READONLY_SIGNAL_TRANSPORT_V1_EXPECTED_RECORD_COUNT - 1; i++) {
    lines.push(canonicalLine(FIRST + i * 300000, i, i % 17 === 0 ? 'SHORT' : 'LONG'));
  }
  lines.push(canonicalLine(LAST, MT5_READONLY_SIGNAL_TRANSPORT_V1_EXPECTED_RECORD_COUNT - 1, 'LONG'));
  return `${lines.join('\n')}\n`;
}

test('MT5 read-only transport deterministically serializes a frozen DEV paper-monitor record', () => {
  const line = canonicalLine(LAST, 287, 'LONG');
  const message = buildMt5ReadOnlySignalTransportV1(line);
  const serialized = serializeMt5ReadOnlySignalTransportV1(message);
  assert.equal(message.version, MT5_READONLY_SIGNAL_TRANSPORT_V1_VERSION);
  assert.equal(message.decisionTime, LAST);
  assert.equal(message.decision, 'LONG');
  assert.equal(message.paperMonitorRecordSha256, sha256(line));
  assert.equal(serialized.split(';').length, 19);
  assert.equal(serialized.split(';')[0], MT5_READONLY_SIGNAL_TRANSPORT_V1_MAGIC);
  assert.deepEqual(serialized.split(';').slice(9, 14), ['0.0025', '25', '10000', '3.9524999999999486', String(LAST + 900000)]);
});

test('MT5 read-only transport preserves NO_TRADE as telemetry only with NA risk fields', () => {
  const line = canonicalLine(LAST, 287, 'NO_TRADE');
  const serialized = serializeMt5ReadOnlySignalTransportV1(buildMt5ReadOnlySignalTransportV1(line));
  const fields = serialized.split(';');
  assert.equal(fields[4], 'NO_TRADE');
  assert.deepEqual(fields.slice(9, 14), ['NA', 'NA', 'NA', 'NA', 'NA']);
});

test('DEV observability journal selector requires exact 288-record authorized window and strict order', () => {
  const journal = canonicalJournal();
  const selected = validateAndSelectLatestDevObservabilityLineV1(journal);
  assert.equal(selected.lines.length, 288);
  assert.equal(JSON.parse(selected.lines[0]).decisionTime, FIRST);
  assert.equal(JSON.parse(selected.latest).decisionTime, LAST);

  const tooShort = selected.lines.slice(1).join('\n');
  assert.throws(
    () => validateAndSelectLatestDevObservabilityLineV1(tooShort),
    /RECORD_COUNT_MISMATCH/,
  );

  const duplicated = [...selected.lines];
  duplicated[100] = duplicated[99];
  assert.throws(
    () => validateAndSelectLatestDevObservabilityLineV1(duplicated.join('\n')),
    /NONINCREASING_DECISION_TIME/,
  );
});

test('MT5 read-only transport fails closed on post-DEV and wrong Final Signal lineage', () => {
  const postDev = monitorRecord(LAST + 1, 1, 'LONG');
  assert.throws(
    () => buildMt5ReadOnlySignalTransportV1(serializePaperMonitorRecordV1(postDev)),
    /POST_DEV_DECISION_FORBIDDEN/,
  );

  const wrongLineage = { ...monitorRecord(LAST, 2, 'LONG'), finalSignalExecutionId: 'wrong' };
  assert.throws(
    () => buildMt5ReadOnlySignalTransportV1(serializePaperMonitorRecordV1(wrongLineage)),
    /FINAL_SIGNAL_LINEAGE_MISMATCH/,
  );
});

test('MT5 read-only file writer is one-shot create-only and emits one ASCII CSV row', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mt5-readonly-v1-'));
  const output = path.join(dir, 'xauusd_readonly_signal_v1.csv');
  const serialized = serializeMt5ReadOnlySignalTransportV1(
    buildMt5ReadOnlySignalTransportV1(canonicalLine(LAST, 287, 'LONG')),
  );
  writeMt5ReadOnlySignalFileV1(output, serialized);
  const raw = await fs.readFile(output);
  assert.equal(raw.toString('ascii'), `${serialized}\r\n`);
  assert.throws(
    () => writeMt5ReadOnlySignalFileV1(output, serialized),
    /OUTPUT_EXISTS/,
  );
});

test('MT5 receiver source is display/log only and contains no trading, network or market-data API coupling', async () => {
  const receiver = await fs.readFile('adapters/mt5/MT5_ReadOnly_Signal_Receiver_V1.mq5', 'utf8');
  for (const forbidden of [
    'OrderSend(', 'OrderSendAsync(', 'CTrade', 'MqlTradeRequest', 'TRADE_ACTION_',
    'PositionOpen(', '.Buy(', '.Sell(', '#include <Trade/', 'WebRequest(', 'Socket',
    'CopyRates(', 'CopyTicks(', 'iClose(', 'SymbolInfoTick(',
  ]) {
    assert.equal(receiver.includes(forbidden), false, `forbidden MT5 coupling: ${forbidden}`);
  }
  assert.equal(receiver.includes('Comment('), true);
  assert.equal(receiver.includes('PrintFormat('), true);

  const nodeSources = [
    await fs.readFile('adapters/mt5/readonly-signal-transport-v1.ts', 'utf8'),
    await fs.readFile('quant-core/cli/run-mt5-readonly-transport-v1.ts', 'utf8'),
  ].join('\n');
  for (const forbidden of [
    'execution-engine-v1r2', 'runEconomic', 'economic-lockbox', 'node:http',
    'node:https', 'node:net', 'WebSocket', 'fetch(', '--lockbox',
  ]) {
    assert.equal(nodeSources.includes(forbidden), false, `forbidden Node coupling: ${forbidden}`);
  }
});

test('MT5 read-only receiver semantic spec explicitly forbids execution, PnL and Future Lockbox access', async () => {
  const spec = JSON.parse(await fs.readFile('adapters/mt5/mt5_readonly_signal_receiver_v1.spec.json', 'utf8'));
  assert.equal(spec.status, 'FROZEN_PRE_LOCKBOX_READ_ONLY_TRANSPORT');
  assert.equal(spec.transport.filesystem_only, true);
  assert.equal(spec.transport.network, false);
  assert.equal(spec.mt5_receiver.order_submission, false);
  assert.equal(spec.mt5_receiver.position_management, false);
  assert.equal(spec.mt5_receiver.market_data_read, false);
  assert.equal(spec.explicit_exclusions.future_lockbox_access, false);
  assert.equal(spec.explicit_exclusions.post_dev_market_data, false);
  assert.equal(spec.explicit_exclusions.pnl, false);
  assert.equal(spec.explicit_exclusions.paper_fill_simulation, false);
  assert.equal(spec.explicit_exclusions.execution_engine_invocation, false);
  assert.equal(spec.explicit_exclusions.broker_order_submission, false);
  assert.equal(spec.explicit_exclusions.live_execution, false);
});

test('MT5 read-only transport, receiver, spec and implementation identities are frozen', async () => {
  for (const identity of Object.values(identities)) {
    const raw = await fs.readFile(identity.path);
    assert.equal(raw.length, identity.bytes, `${identity.path} bytes`);
    assert.equal(sha256(raw), identity.sha256, `${identity.path} sha256`);
  }
});
