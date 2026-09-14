import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  serializePaperMonitorRecordV1,
  type PaperMonitorRecordV1,
} from '../paper/paper-monitor-adapter-v1.js';

export const MT5_READONLY_SIGNAL_TRANSPORT_V1_VERSION = 'mt5_readonly_signal_transport_v1' as const;
export const MT5_READONLY_SIGNAL_TRANSPORT_V1_MAGIC = 'MT5_READONLY_SIGNAL_V1' as const;
export const MT5_READONLY_SIGNAL_TRANSPORT_V1_DEV_INFORMATION_END = 1788931800000;
export const MT5_READONLY_SIGNAL_TRANSPORT_V1_EXPECTED_RECORD_COUNT = 288;
export const MT5_READONLY_SIGNAL_TRANSPORT_V1_EXPECTED_FIRST_DECISION_TIME = 1788842100000;
export const MT5_READONLY_SIGNAL_TRANSPORT_V1_EXPECTED_LAST_DECISION_TIME = 1788931800000;

export const MT5_READONLY_SIGNAL_TRANSPORT_V1_LINEAGE = Object.freeze({
  finalSignalExecutionId: 'final_signal_v1r1_20260913235306128',
  finalSignalModelSha256: 'f4869afd3cfeb681bca356ee08d80a63fb617a841427932a571ff2e2306f7655',
  finalSignalCalibratorSha256: '6d851a2eaa61deaa00bc2bc7899ad40fabc5b8758cd58ed933782709996ac17c',
});

export interface Mt5ReadOnlySignalTransportV1 {
  readonly version: typeof MT5_READONLY_SIGNAL_TRANSPORT_V1_VERSION;
  readonly eventId: string;
  readonly asset: 'XAUUSD';
  readonly timeframe: 'M5';
  readonly decision: 'LONG' | 'SHORT' | 'NO_TRADE';
  readonly decisionTime: number;
  readonly rawProbability: number;
  readonly calibratedProbability: number;
  readonly decisionClose: number;
  readonly riskFraction: number | null;
  readonly maxQuoteRisk: number | null;
  readonly maxGrossNotionalQuote: number | null;
  readonly stopDistancePrice: number | null;
  readonly timeExitTime: number | null;
  readonly finalSignalExecutionId: string;
  readonly finalSignalModelSha256: string;
  readonly finalSignalCalibratorSha256: string;
  readonly bridgeMessageSha256: string;
  readonly paperMonitorRecordSha256: string;
}

function sha256Utf8(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertSha256(value: string, code: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(code);
}

function parseCanonicalPaperMonitorLineV1(line: string): PaperMonitorRecordV1 {
  if (typeof line !== 'string' || line.length === 0) throw new Error('MT5_READONLY_V1_EMPTY_MONITOR_LINE');
  let parsed: PaperMonitorRecordV1;
  try {
    parsed = JSON.parse(line) as PaperMonitorRecordV1;
  } catch {
    throw new Error('MT5_READONLY_V1_INVALID_MONITOR_JSON');
  }
  const canonical = serializePaperMonitorRecordV1(parsed);
  if (canonical !== line) throw new Error('MT5_READONLY_V1_NONCANONICAL_MONITOR_LINE');
  return parsed;
}

function assertFrozenDevRecordV1(record: PaperMonitorRecordV1): void {
  if (record.finalSignalExecutionId !== MT5_READONLY_SIGNAL_TRANSPORT_V1_LINEAGE.finalSignalExecutionId
    || record.finalSignalModelSha256 !== MT5_READONLY_SIGNAL_TRANSPORT_V1_LINEAGE.finalSignalModelSha256
    || record.finalSignalCalibratorSha256 !== MT5_READONLY_SIGNAL_TRANSPORT_V1_LINEAGE.finalSignalCalibratorSha256) {
    throw new Error('MT5_READONLY_V1_FINAL_SIGNAL_LINEAGE_MISMATCH');
  }
  if (record.decisionTime > MT5_READONLY_SIGNAL_TRANSPORT_V1_DEV_INFORMATION_END) {
    throw new Error('MT5_READONLY_V1_POST_DEV_DECISION_FORBIDDEN');
  }
  if (record.receivedAtMs !== record.decisionTime || record.receiptDelayMs !== 0) {
    throw new Error('MT5_READONLY_V1_NONDETERMINISTIC_RECEIPT_TELEMETRY');
  }
}

export function buildMt5ReadOnlySignalTransportV1(
  monitorLine: string,
): Mt5ReadOnlySignalTransportV1 {
  const record = parseCanonicalPaperMonitorLineV1(monitorLine);
  assertFrozenDevRecordV1(record);
  return Object.freeze({
    version: MT5_READONLY_SIGNAL_TRANSPORT_V1_VERSION,
    eventId: record.eventId,
    asset: record.asset,
    timeframe: record.timeframe,
    decision: record.decision,
    decisionTime: record.decisionTime,
    rawProbability: record.rawProbability,
    calibratedProbability: record.calibratedProbability,
    decisionClose: record.decisionClose,
    riskFraction: record.riskFraction,
    maxQuoteRisk: record.maxQuoteRisk,
    maxGrossNotionalQuote: record.maxGrossNotionalQuote,
    stopDistancePrice: record.stopDistancePrice,
    timeExitTime: record.timeExitTime,
    finalSignalExecutionId: record.finalSignalExecutionId,
    finalSignalModelSha256: record.finalSignalModelSha256,
    finalSignalCalibratorSha256: record.finalSignalCalibratorSha256,
    bridgeMessageSha256: record.bridgeMessageSha256,
    paperMonitorRecordSha256: sha256Utf8(monitorLine),
  });
}

function field(value: number | string | null): string {
  if (value === null) return 'NA';
  const out = String(value);
  if (out.includes(';') || out.includes('\r') || out.includes('\n')) {
    throw new Error('MT5_READONLY_V1_UNSAFE_FIELD');
  }
  return out;
}

export function serializeMt5ReadOnlySignalTransportV1(
  message: Mt5ReadOnlySignalTransportV1,
): string {
  if (message.version !== MT5_READONLY_SIGNAL_TRANSPORT_V1_VERSION) {
    throw new Error('MT5_READONLY_V1_VERSION_MISMATCH');
  }
  assertSha256(message.eventId, 'MT5_READONLY_V1_INVALID_EVENT_ID');
  assertSha256(message.bridgeMessageSha256, 'MT5_READONLY_V1_INVALID_BRIDGE_SHA256');
  assertSha256(message.paperMonitorRecordSha256, 'MT5_READONLY_V1_INVALID_MONITOR_SHA256');
  if (message.asset !== 'XAUUSD' || message.timeframe !== 'M5') {
    throw new Error('MT5_READONLY_V1_ASSET_TIMEFRAME_MISMATCH');
  }
  if (message.finalSignalExecutionId !== MT5_READONLY_SIGNAL_TRANSPORT_V1_LINEAGE.finalSignalExecutionId
    || message.finalSignalModelSha256 !== MT5_READONLY_SIGNAL_TRANSPORT_V1_LINEAGE.finalSignalModelSha256
    || message.finalSignalCalibratorSha256 !== MT5_READONLY_SIGNAL_TRANSPORT_V1_LINEAGE.finalSignalCalibratorSha256) {
    throw new Error('MT5_READONLY_V1_FINAL_SIGNAL_LINEAGE_MISMATCH');
  }
  if (!Number.isSafeInteger(message.decisionTime)
    || message.decisionTime > MT5_READONLY_SIGNAL_TRANSPORT_V1_DEV_INFORMATION_END) {
    throw new Error('MT5_READONLY_V1_INVALID_DECISION_TIME');
  }
  if (message.decision !== 'LONG' && message.decision !== 'SHORT' && message.decision !== 'NO_TRADE') {
    throw new Error('MT5_READONLY_V1_INVALID_DECISION');
  }
  if (!Number.isFinite(message.rawProbability) || message.rawProbability < 0 || message.rawProbability > 1
    || !Number.isFinite(message.calibratedProbability) || message.calibratedProbability < 0 || message.calibratedProbability > 1
    || !Number.isFinite(message.decisionClose) || message.decisionClose <= 0) {
    throw new Error('MT5_READONLY_V1_INVALID_SIGNAL_NUMERIC_FIELDS');
  }
  if (message.decision === 'NO_TRADE') {
    if (message.riskFraction !== null || message.maxQuoteRisk !== null || message.maxGrossNotionalQuote !== null
      || message.stopDistancePrice !== null || message.timeExitTime !== null) {
      throw new Error('MT5_READONLY_V1_NO_TRADE_HAS_RISK_FIELDS');
    }
  } else {
    if (message.riskFraction === null || message.maxQuoteRisk === null || message.maxGrossNotionalQuote === null
      || message.stopDistancePrice === null || message.timeExitTime === null
      || !Number.isFinite(message.riskFraction) || message.riskFraction <= 0
      || !Number.isFinite(message.maxQuoteRisk) || message.maxQuoteRisk <= 0
      || !Number.isFinite(message.maxGrossNotionalQuote) || message.maxGrossNotionalQuote <= 0
      || !Number.isFinite(message.stopDistancePrice) || message.stopDistancePrice <= 0
      || !Number.isSafeInteger(message.timeExitTime) || message.timeExitTime <= message.decisionTime) {
      throw new Error('MT5_READONLY_V1_INVALID_RISK_TELEMETRY');
    }
  }
  return [
    MT5_READONLY_SIGNAL_TRANSPORT_V1_MAGIC,
    message.eventId,
    message.asset,
    message.timeframe,
    message.decision,
    message.decisionTime,
    message.rawProbability,
    message.calibratedProbability,
    message.decisionClose,
    message.riskFraction,
    message.maxQuoteRisk,
    message.maxGrossNotionalQuote,
    message.stopDistancePrice,
    message.timeExitTime,
    message.finalSignalExecutionId,
    message.finalSignalModelSha256,
    message.finalSignalCalibratorSha256,
    message.bridgeMessageSha256,
    message.paperMonitorRecordSha256,
  ].map(field).join(';');
}

export function validateAndSelectLatestDevObservabilityLineV1(
  journalText: string,
): { readonly lines: readonly string[]; readonly latest: string } {
  const lines = journalText.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length !== MT5_READONLY_SIGNAL_TRANSPORT_V1_EXPECTED_RECORD_COUNT) {
    throw new Error(`MT5_READONLY_V1_RECORD_COUNT_MISMATCH:${lines.length}`);
  }
  let previous = -Infinity;
  for (const line of lines) {
    const record = parseCanonicalPaperMonitorLineV1(line);
    assertFrozenDevRecordV1(record);
    if (record.decisionTime <= previous) throw new Error('MT5_READONLY_V1_NONINCREASING_DECISION_TIME');
    previous = record.decisionTime;
  }
  const first = parseCanonicalPaperMonitorLineV1(lines[0]!);
  const latest = lines[lines.length - 1]!;
  const last = parseCanonicalPaperMonitorLineV1(latest);
  if (first.decisionTime !== MT5_READONLY_SIGNAL_TRANSPORT_V1_EXPECTED_FIRST_DECISION_TIME
    || last.decisionTime !== MT5_READONLY_SIGNAL_TRANSPORT_V1_EXPECTED_LAST_DECISION_TIME) {
    throw new Error('MT5_READONLY_V1_DEV_WINDOW_IDENTITY_MISMATCH');
  }
  return Object.freeze({ lines: Object.freeze([...lines]), latest });
}

export function writeMt5ReadOnlySignalFileV1(outputFilePath: string, serialized: string): void {
  const output = path.resolve(outputFilePath);
  if (path.extname(output).toLowerCase() !== '.csv') throw new Error('MT5_READONLY_V1_OUTPUT_MUST_BE_CSV');
  if (fs.existsSync(output)) throw new Error(`MT5_READONLY_V1_OUTPUT_EXISTS:${output}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${serialized}\r\n`, { encoding: 'ascii', flag: 'wx' });
}
