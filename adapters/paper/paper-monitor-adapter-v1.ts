import crypto from 'node:crypto';
import {
  parseSignalBridgeEnvelopeV1,
  serializeSignalBridgeEnvelopeV1,
  type SignalBridgeEnvelopeV1,
  type SignalBridgeSinkV1,
} from '../../quant-core/bridge/signal-bridge-v1.js';
import type { RiskEngineLineageV1 } from '../../quant-core/risk/risk-engine.js';

export const PAPER_MONITOR_ADAPTER_V1_VERSION = 'paper_monitor_adapter_v1' as const;
export const PAPER_MONITOR_ADAPTER_V1_MODE = 'PAPER_MONITOR_ONLY' as const;
export const PAPER_MONITOR_ADAPTER_V1_INTEGRITY = 'VALID' as const;

export type PaperMonitorDecisionV1 = 'LONG' | 'SHORT' | 'NO_TRADE';
export type PaperMonitorNoTradeReasonV1 = 'PROBABILITY_EXACTLY_0_5' | 'POSITION_ALREADY_OPEN';

export interface PaperMonitorRecordV1 {
  readonly version: typeof PAPER_MONITOR_ADAPTER_V1_VERSION;
  readonly mode: typeof PAPER_MONITOR_ADAPTER_V1_MODE;
  readonly integrity: typeof PAPER_MONITOR_ADAPTER_V1_INTEGRITY;
  readonly eventId: string;
  readonly bridgeMessageSha256: string;
  readonly receivedAtMs: number;
  readonly decisionTime: number;
  readonly receiptDelayMs: number;
  readonly asset: 'XAUUSD';
  readonly timeframe: 'M5';
  readonly finalSignalExecutionId: string;
  readonly finalSignalModelSha256: string;
  readonly finalSignalCalibratorSha256: string;
  readonly decision: PaperMonitorDecisionV1;
  readonly noTradeReason: PaperMonitorNoTradeReasonV1 | null;
  readonly rawProbability: number;
  readonly calibratedProbability: number;
  readonly decisionClose: number;
  readonly atrSma12OverClose: number;
  readonly riskFraction: number | null;
  readonly maxQuoteRisk: number | null;
  readonly maxGrossNotionalQuote: number | null;
  readonly stopDistancePrice: number | null;
  readonly timeExitTime: number | null;
}

export interface PaperMonitorClockV1 {
  nowMs(): number;
}

export interface PaperMonitorJournalV1 {
  appendLine(line: string): void | Promise<void>;
}

export interface PaperMonitorSinkReceiptV1 {
  readonly version: typeof PAPER_MONITOR_ADAPTER_V1_VERSION;
  readonly eventId: string;
  readonly receivedAtMs: number;
  readonly journaled: true;
}

function assertSafeInteger(value: number, code: string): void {
  if (!Number.isSafeInteger(value)) throw new Error(code);
}

function assertFinite(value: number, code: string): void {
  if (!Number.isFinite(value)) throw new Error(code);
}

function assertPositive(value: number, code: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(code);
}

function assertProbability(value: number, code: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(code);
}

function assertSha256(value: string, code: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(code);
}

function hashUtf8(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function buildRecordFromEnvelopeV1(
  serializedBridgeMessage: string,
  envelope: SignalBridgeEnvelopeV1,
  receivedAtMs: number,
): PaperMonitorRecordV1 {
  assertSafeInteger(receivedAtMs, 'PAPER_MONITOR_V1_INVALID_RECEIVED_AT');
  const signal = envelope.payload.signal;
  const lineage = envelope.payload.lineage;
  const risk = envelope.payload.riskDecision;
  const decision: PaperMonitorDecisionV1 = risk.action === 'TRADE_INTENT' ? risk.side : 'NO_TRADE';
  const noTradeReason: PaperMonitorNoTradeReasonV1 | null = risk.action === 'NO_TRADE' ? risk.reason : null;

  return Object.freeze({
    version: PAPER_MONITOR_ADAPTER_V1_VERSION,
    mode: PAPER_MONITOR_ADAPTER_V1_MODE,
    integrity: PAPER_MONITOR_ADAPTER_V1_INTEGRITY,
    eventId: envelope.eventId,
    bridgeMessageSha256: hashUtf8(serializedBridgeMessage),
    receivedAtMs,
    decisionTime: signal.decisionTime,
    receiptDelayMs: receivedAtMs - signal.decisionTime,
    asset: signal.asset,
    timeframe: signal.timeframe,
    finalSignalExecutionId: lineage.finalSignalExecutionId,
    finalSignalModelSha256: lineage.finalSignalModelSha256,
    finalSignalCalibratorSha256: lineage.finalSignalCalibratorSha256,
    decision,
    noTradeReason,
    rawProbability: signal.rawProbability,
    calibratedProbability: signal.calibratedProbability,
    decisionClose: signal.decisionClose,
    atrSma12OverClose: signal.atrSma12OverClose,
    riskFraction: risk.action === 'TRADE_INTENT' ? risk.riskFraction : null,
    maxQuoteRisk: risk.action === 'TRADE_INTENT' ? risk.maxQuoteRisk : null,
    maxGrossNotionalQuote: risk.action === 'TRADE_INTENT' ? risk.maxGrossNotionalQuote : null,
    stopDistancePrice: risk.action === 'TRADE_INTENT' ? risk.stopDistancePrice : null,
    timeExitTime: risk.action === 'TRADE_INTENT' ? risk.timeExitTime : null,
  });
}

export function consumePaperMonitorMessageV1(
  serializedBridgeMessage: string,
  expectedLineage: RiskEngineLineageV1,
  receivedAtMs: number,
): PaperMonitorRecordV1 {
  if (typeof serializedBridgeMessage !== 'string' || serializedBridgeMessage.length === 0) {
    throw new Error('PAPER_MONITOR_V1_EMPTY_BRIDGE_MESSAGE');
  }
  const envelope = parseSignalBridgeEnvelopeV1(serializedBridgeMessage, expectedLineage);
  return buildRecordFromEnvelopeV1(serializedBridgeMessage, envelope, receivedAtMs);
}

function validatePaperMonitorRecordV1(record: PaperMonitorRecordV1): void {
  if (record.version !== PAPER_MONITOR_ADAPTER_V1_VERSION) throw new Error('PAPER_MONITOR_V1_VERSION_MISMATCH');
  if (record.mode !== PAPER_MONITOR_ADAPTER_V1_MODE) throw new Error('PAPER_MONITOR_V1_MODE_MISMATCH');
  if (record.integrity !== PAPER_MONITOR_ADAPTER_V1_INTEGRITY) throw new Error('PAPER_MONITOR_V1_INTEGRITY_MISMATCH');
  assertSha256(record.eventId, 'PAPER_MONITOR_V1_INVALID_EVENT_ID');
  assertSha256(record.bridgeMessageSha256, 'PAPER_MONITOR_V1_INVALID_MESSAGE_SHA256');
  assertSafeInteger(record.receivedAtMs, 'PAPER_MONITOR_V1_INVALID_RECEIVED_AT');
  assertFinite(record.decisionTime, 'PAPER_MONITOR_V1_INVALID_DECISION_TIME');
  assertFinite(record.receiptDelayMs, 'PAPER_MONITOR_V1_INVALID_RECEIPT_DELAY');
  if (record.receiptDelayMs !== record.receivedAtMs - record.decisionTime) throw new Error('PAPER_MONITOR_V1_RECEIPT_DELAY_MISMATCH');
  if (record.asset !== 'XAUUSD' || record.timeframe !== 'M5') throw new Error('PAPER_MONITOR_V1_ASSET_TIMEFRAME_MISMATCH');
  if (record.finalSignalExecutionId.length === 0) throw new Error('PAPER_MONITOR_V1_EMPTY_EXECUTION_ID');
  assertSha256(record.finalSignalModelSha256, 'PAPER_MONITOR_V1_INVALID_MODEL_SHA256');
  assertSha256(record.finalSignalCalibratorSha256, 'PAPER_MONITOR_V1_INVALID_CALIBRATOR_SHA256');
  assertProbability(record.rawProbability, 'PAPER_MONITOR_V1_INVALID_RAW_PROBABILITY');
  assertProbability(record.calibratedProbability, 'PAPER_MONITOR_V1_INVALID_CALIBRATED_PROBABILITY');
  assertPositive(record.decisionClose, 'PAPER_MONITOR_V1_INVALID_DECISION_CLOSE');
  assertPositive(record.atrSma12OverClose, 'PAPER_MONITOR_V1_INVALID_ATR_RATIO');

  if (record.decision === 'NO_TRADE') {
    if (record.noTradeReason !== 'PROBABILITY_EXACTLY_0_5' && record.noTradeReason !== 'POSITION_ALREADY_OPEN') {
      throw new Error('PAPER_MONITOR_V1_INVALID_NO_TRADE_REASON');
    }
    if (record.riskFraction !== null || record.maxQuoteRisk !== null || record.maxGrossNotionalQuote !== null
      || record.stopDistancePrice !== null || record.timeExitTime !== null) {
      throw new Error('PAPER_MONITOR_V1_NO_TRADE_HAS_RISK_FIELDS');
    }
    return;
  }

  if (record.decision !== 'LONG' && record.decision !== 'SHORT') throw new Error('PAPER_MONITOR_V1_INVALID_DECISION');
  if (record.noTradeReason !== null) throw new Error('PAPER_MONITOR_V1_TRADE_HAS_NO_TRADE_REASON');
  if (record.riskFraction === null || record.maxQuoteRisk === null || record.maxGrossNotionalQuote === null
    || record.stopDistancePrice === null || record.timeExitTime === null) {
    throw new Error('PAPER_MONITOR_V1_TRADE_MISSING_RISK_FIELDS');
  }
  assertPositive(record.riskFraction, 'PAPER_MONITOR_V1_INVALID_RISK_FRACTION');
  assertPositive(record.maxQuoteRisk, 'PAPER_MONITOR_V1_INVALID_MAX_QUOTE_RISK');
  assertPositive(record.maxGrossNotionalQuote, 'PAPER_MONITOR_V1_INVALID_MAX_GROSS_NOTIONAL');
  assertPositive(record.stopDistancePrice, 'PAPER_MONITOR_V1_INVALID_STOP_DISTANCE');
  assertFinite(record.timeExitTime, 'PAPER_MONITOR_V1_INVALID_TIME_EXIT');
}

export function serializePaperMonitorRecordV1(record: PaperMonitorRecordV1): string {
  validatePaperMonitorRecordV1(record);
  return JSON.stringify({
    version: record.version,
    mode: record.mode,
    integrity: record.integrity,
    eventId: record.eventId,
    bridgeMessageSha256: record.bridgeMessageSha256,
    receivedAtMs: record.receivedAtMs,
    decisionTime: record.decisionTime,
    receiptDelayMs: record.receiptDelayMs,
    asset: record.asset,
    timeframe: record.timeframe,
    finalSignalExecutionId: record.finalSignalExecutionId,
    finalSignalModelSha256: record.finalSignalModelSha256,
    finalSignalCalibratorSha256: record.finalSignalCalibratorSha256,
    decision: record.decision,
    noTradeReason: record.noTradeReason,
    rawProbability: record.rawProbability,
    calibratedProbability: record.calibratedProbability,
    decisionClose: record.decisionClose,
    atrSma12OverClose: record.atrSma12OverClose,
    riskFraction: record.riskFraction,
    maxQuoteRisk: record.maxQuoteRisk,
    maxGrossNotionalQuote: record.maxGrossNotionalQuote,
    stopDistancePrice: record.stopDistancePrice,
    timeExitTime: record.timeExitTime,
  });
}

export function createPaperMonitorSinkV1(
  expectedLineage: RiskEngineLineageV1,
  clock: PaperMonitorClockV1,
  journal: PaperMonitorJournalV1,
): SignalBridgeSinkV1 {
  if (!clock || typeof clock.nowMs !== 'function') throw new Error('PAPER_MONITOR_V1_INVALID_CLOCK');
  if (!journal || typeof journal.appendLine !== 'function') throw new Error('PAPER_MONITOR_V1_INVALID_JOURNAL');

  return Object.freeze({
    async publish(envelope: SignalBridgeEnvelopeV1): Promise<void> {
      const serializedBridgeMessage = serializeSignalBridgeEnvelopeV1(envelope);
      const receivedAtMs = clock.nowMs();
      const record = consumePaperMonitorMessageV1(serializedBridgeMessage, expectedLineage, receivedAtMs);
      const line = serializePaperMonitorRecordV1(record);
      await journal.appendLine(line);
    },
  });
}

export async function journalPaperMonitorMessageV1(
  serializedBridgeMessage: string,
  expectedLineage: RiskEngineLineageV1,
  receivedAtMs: number,
  journal: PaperMonitorJournalV1,
): Promise<PaperMonitorSinkReceiptV1> {
  if (!journal || typeof journal.appendLine !== 'function') throw new Error('PAPER_MONITOR_V1_INVALID_JOURNAL');
  const record = consumePaperMonitorMessageV1(serializedBridgeMessage, expectedLineage, receivedAtMs);
  await journal.appendLine(serializePaperMonitorRecordV1(record));
  return Object.freeze({
    version: PAPER_MONITOR_ADAPTER_V1_VERSION,
    eventId: record.eventId,
    receivedAtMs: record.receivedAtMs,
    journaled: true,
  });
}
