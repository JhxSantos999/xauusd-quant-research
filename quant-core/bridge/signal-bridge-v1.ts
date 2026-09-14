import crypto from 'node:crypto';
import {
  RISK_ENGINE_V1_PER_TRADE_EQUITY_FRACTION,
  RISK_ENGINE_V1_STOP_ATR_MULTIPLE,
  RISK_ENGINE_V1_TIME_EXIT_BARS,
  RISK_ENGINE_V1_VERSION,
  type RiskDecisionV1,
  type RiskEngineLineageV1,
  type RiskNoTradeV1,
  type RiskTradeIntentV1,
} from '../risk/risk-engine.js';

export const SIGNAL_BRIDGE_V1_VERSION = 'signal_bridge_v1' as const;
export const SIGNAL_BRIDGE_V1_MODE = 'OBSERVE_ONLY' as const;
export const SIGNAL_BRIDGE_V1_EVENT_TYPE = 'SIGNAL_RISK_DECISION' as const;

export interface SignalObjectV1 {
  readonly asset: 'XAUUSD';
  readonly timeframe: 'M5';
  readonly decisionTime: number;
  readonly decisionClose: number;
  readonly atrSma12OverClose: number;
  readonly rawProbability: number;
  readonly calibratedProbability: number;
}

export interface SignalBridgeInputV1 {
  readonly signal: SignalObjectV1;
  readonly lineage: RiskEngineLineageV1;
  readonly riskDecision: RiskDecisionV1;
}

export interface SignalBridgePayloadV1 {
  readonly signal: SignalObjectV1;
  readonly lineage: RiskEngineLineageV1;
  readonly riskDecision: RiskDecisionV1;
}

export interface SignalBridgeEnvelopeV1 {
  readonly version: typeof SIGNAL_BRIDGE_V1_VERSION;
  readonly mode: typeof SIGNAL_BRIDGE_V1_MODE;
  readonly eventType: typeof SIGNAL_BRIDGE_V1_EVENT_TYPE;
  readonly eventId: string;
  readonly payload: SignalBridgePayloadV1;
}

export interface SignalBridgeSinkV1 {
  publish(envelope: SignalBridgeEnvelopeV1): void | Promise<void>;
}

export interface SignalBridgePublishReceiptV1 {
  readonly version: typeof SIGNAL_BRIDGE_V1_VERSION;
  readonly eventId: string;
  readonly sinkCount: number;
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

function assertLineageV1(lineage: RiskEngineLineageV1, expected: RiskEngineLineageV1): void {
  if (lineage.finalSignalExecutionId !== expected.finalSignalExecutionId
    || lineage.finalSignalModelSha256 !== expected.finalSignalModelSha256
    || lineage.finalSignalCalibratorSha256 !== expected.finalSignalCalibratorSha256) {
    throw new Error('SIGNAL_BRIDGE_V1_LINEAGE_MISMATCH');
  }
  if (lineage.finalSignalExecutionId.length === 0) throw new Error('SIGNAL_BRIDGE_V1_EMPTY_EXECUTION_ID');
  assertSha256(lineage.finalSignalModelSha256, 'SIGNAL_BRIDGE_V1_INVALID_MODEL_SHA256');
  assertSha256(lineage.finalSignalCalibratorSha256, 'SIGNAL_BRIDGE_V1_INVALID_CALIBRATOR_SHA256');
}

function normalizeNoTradeV1(decision: RiskNoTradeV1): RiskNoTradeV1 {
  if (decision.version !== RISK_ENGINE_V1_VERSION) throw new Error('SIGNAL_BRIDGE_V1_RISK_VERSION_MISMATCH');
  if (decision.action !== 'NO_TRADE') throw new Error('SIGNAL_BRIDGE_V1_INVALID_NO_TRADE_ACTION');
  if (decision.reason !== 'PROBABILITY_EXACTLY_0_5' && decision.reason !== 'POSITION_ALREADY_OPEN') {
    throw new Error('SIGNAL_BRIDGE_V1_INVALID_NO_TRADE_REASON');
  }
  assertFinite(decision.decisionTime, 'SIGNAL_BRIDGE_V1_INVALID_RISK_DECISION_TIME');
  return Object.freeze({
    version: RISK_ENGINE_V1_VERSION,
    action: 'NO_TRADE',
    reason: decision.reason,
    decisionTime: decision.decisionTime,
  });
}

function normalizeTradeIntentV1(decision: RiskTradeIntentV1): RiskTradeIntentV1 {
  if (decision.version !== RISK_ENGINE_V1_VERSION) throw new Error('SIGNAL_BRIDGE_V1_RISK_VERSION_MISMATCH');
  if (decision.action !== 'TRADE_INTENT') throw new Error('SIGNAL_BRIDGE_V1_INVALID_TRADE_ACTION');
  if (decision.side !== 'LONG' && decision.side !== 'SHORT') throw new Error('SIGNAL_BRIDGE_V1_INVALID_SIDE');
  assertFinite(decision.decisionTime, 'SIGNAL_BRIDGE_V1_INVALID_RISK_DECISION_TIME');
  assertProbability(decision.calibratedProbability, 'SIGNAL_BRIDGE_V1_INVALID_RISK_PROBABILITY');
  if (decision.riskFraction !== RISK_ENGINE_V1_PER_TRADE_EQUITY_FRACTION) throw new Error('SIGNAL_BRIDGE_V1_RISK_FRACTION_MISMATCH');
  assertPositive(decision.maxQuoteRisk, 'SIGNAL_BRIDGE_V1_INVALID_MAX_QUOTE_RISK');
  if (decision.maxGrossExposureMultiple !== 1) throw new Error('SIGNAL_BRIDGE_V1_GROSS_MULTIPLE_MISMATCH');
  assertPositive(decision.maxGrossNotionalQuote, 'SIGNAL_BRIDGE_V1_INVALID_MAX_GROSS_NOTIONAL');
  if (decision.stopAtrMultiple !== RISK_ENGINE_V1_STOP_ATR_MULTIPLE) throw new Error('SIGNAL_BRIDGE_V1_STOP_ATR_MULTIPLE_MISMATCH');
  assertPositive(decision.stopDistancePrice, 'SIGNAL_BRIDGE_V1_INVALID_STOP_DISTANCE');
  if (decision.timeExitBars !== RISK_ENGINE_V1_TIME_EXIT_BARS) throw new Error('SIGNAL_BRIDGE_V1_TIME_EXIT_BARS_MISMATCH');
  assertFinite(decision.timeExitTime, 'SIGNAL_BRIDGE_V1_INVALID_TIME_EXIT');
  if (decision.takeProfitPolicy !== 'NONE') throw new Error('SIGNAL_BRIDGE_V1_TAKE_PROFIT_POLICY_MISMATCH');
  if (decision.quantityConversion !== 'DEFERRED_TO_EXECUTION_ENGINE') throw new Error('SIGNAL_BRIDGE_V1_QUANTITY_POLICY_MISMATCH');
  return Object.freeze({
    version: RISK_ENGINE_V1_VERSION,
    action: 'TRADE_INTENT',
    side: decision.side,
    decisionTime: decision.decisionTime,
    calibratedProbability: decision.calibratedProbability,
    riskFraction: RISK_ENGINE_V1_PER_TRADE_EQUITY_FRACTION,
    maxQuoteRisk: decision.maxQuoteRisk,
    maxGrossExposureMultiple: 1,
    maxGrossNotionalQuote: decision.maxGrossNotionalQuote,
    stopAtrMultiple: RISK_ENGINE_V1_STOP_ATR_MULTIPLE,
    stopDistancePrice: decision.stopDistancePrice,
    timeExitBars: RISK_ENGINE_V1_TIME_EXIT_BARS,
    timeExitTime: decision.timeExitTime,
    takeProfitPolicy: 'NONE',
    quantityConversion: 'DEFERRED_TO_EXECUTION_ENGINE',
  });
}

function normalizeRiskDecisionV1(decision: RiskDecisionV1): RiskDecisionV1 {
  return decision.action === 'NO_TRADE' ? normalizeNoTradeV1(decision) : normalizeTradeIntentV1(decision);
}

function normalizeSignalV1(signal: SignalObjectV1): SignalObjectV1 {
  if (signal.asset !== 'XAUUSD' || signal.timeframe !== 'M5') throw new Error('SIGNAL_BRIDGE_V1_ASSET_TIMEFRAME_MISMATCH');
  assertFinite(signal.decisionTime, 'SIGNAL_BRIDGE_V1_INVALID_DECISION_TIME');
  assertPositive(signal.decisionClose, 'SIGNAL_BRIDGE_V1_INVALID_DECISION_CLOSE');
  assertPositive(signal.atrSma12OverClose, 'SIGNAL_BRIDGE_V1_INVALID_ATR_RATIO');
  assertProbability(signal.rawProbability, 'SIGNAL_BRIDGE_V1_INVALID_RAW_PROBABILITY');
  assertProbability(signal.calibratedProbability, 'SIGNAL_BRIDGE_V1_INVALID_CALIBRATED_PROBABILITY');
  return Object.freeze({
    asset: 'XAUUSD',
    timeframe: 'M5',
    decisionTime: signal.decisionTime,
    decisionClose: signal.decisionClose,
    atrSma12OverClose: signal.atrSma12OverClose,
    rawProbability: signal.rawProbability,
    calibratedProbability: signal.calibratedProbability,
  });
}

function assertSignalRiskConsistencyV1(signal: SignalObjectV1, risk: RiskDecisionV1): void {
  if (risk.decisionTime !== signal.decisionTime) throw new Error('SIGNAL_BRIDGE_V1_DECISION_TIME_MISMATCH');
  if (risk.action === 'NO_TRADE') {
    if (risk.reason === 'PROBABILITY_EXACTLY_0_5' && signal.calibratedProbability !== 0.5) {
      throw new Error('SIGNAL_BRIDGE_V1_EXACT_HALF_REASON_MISMATCH');
    }
    return;
  }
  if (signal.calibratedProbability === 0.5) throw new Error('SIGNAL_BRIDGE_V1_TRADE_AT_EXACT_HALF');
  const expectedSide = signal.calibratedProbability > 0.5 ? 'LONG' : 'SHORT';
  if (risk.side !== expectedSide) throw new Error('SIGNAL_BRIDGE_V1_SIDE_MISMATCH');
  if (risk.calibratedProbability !== signal.calibratedProbability) throw new Error('SIGNAL_BRIDGE_V1_RISK_PROBABILITY_MISMATCH');
  const expectedStop = signal.decisionClose * signal.atrSma12OverClose;
  if (risk.stopDistancePrice !== expectedStop) throw new Error('SIGNAL_BRIDGE_V1_STOP_DISTANCE_MISMATCH');
  if (risk.timeExitTime !== signal.decisionTime + 900_000) throw new Error('SIGNAL_BRIDGE_V1_TIME_EXIT_MISMATCH');
}

function canonicalPayloadJsonV1(payload: SignalBridgePayloadV1): string {
  return JSON.stringify({
    signal: {
      asset: payload.signal.asset,
      timeframe: payload.signal.timeframe,
      decisionTime: payload.signal.decisionTime,
      decisionClose: payload.signal.decisionClose,
      atrSma12OverClose: payload.signal.atrSma12OverClose,
      rawProbability: payload.signal.rawProbability,
      calibratedProbability: payload.signal.calibratedProbability,
    },
    lineage: {
      finalSignalExecutionId: payload.lineage.finalSignalExecutionId,
      finalSignalModelSha256: payload.lineage.finalSignalModelSha256,
      finalSignalCalibratorSha256: payload.lineage.finalSignalCalibratorSha256,
    },
    riskDecision: payload.riskDecision,
  });
}

function eventIdForPayloadV1(payload: SignalBridgePayloadV1): string {
  const canonical = JSON.stringify({
    version: SIGNAL_BRIDGE_V1_VERSION,
    mode: SIGNAL_BRIDGE_V1_MODE,
    eventType: SIGNAL_BRIDGE_V1_EVENT_TYPE,
    payload: JSON.parse(canonicalPayloadJsonV1(payload)) as unknown,
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function freezePayloadV1(signal: SignalObjectV1, lineage: RiskEngineLineageV1, riskDecision: RiskDecisionV1): SignalBridgePayloadV1 {
  const frozenLineage = Object.freeze({
    finalSignalExecutionId: lineage.finalSignalExecutionId,
    finalSignalModelSha256: lineage.finalSignalModelSha256,
    finalSignalCalibratorSha256: lineage.finalSignalCalibratorSha256,
  });
  return Object.freeze({ signal, lineage: frozenLineage, riskDecision });
}

export function buildSignalBridgeEnvelopeV1(
  input: SignalBridgeInputV1,
  expectedLineage: RiskEngineLineageV1,
): SignalBridgeEnvelopeV1 {
  const signal = normalizeSignalV1(input.signal);
  assertLineageV1(input.lineage, expectedLineage);
  const riskDecision = normalizeRiskDecisionV1(input.riskDecision);
  assertSignalRiskConsistencyV1(signal, riskDecision);
  const payload = freezePayloadV1(signal, input.lineage, riskDecision);
  const eventId = eventIdForPayloadV1(payload);
  return Object.freeze({
    version: SIGNAL_BRIDGE_V1_VERSION,
    mode: SIGNAL_BRIDGE_V1_MODE,
    eventType: SIGNAL_BRIDGE_V1_EVENT_TYPE,
    eventId,
    payload,
  });
}

export function serializeSignalBridgeEnvelopeV1(envelope: SignalBridgeEnvelopeV1): string {
  const recomputed = eventIdForPayloadV1(envelope.payload);
  if (envelope.version !== SIGNAL_BRIDGE_V1_VERSION
    || envelope.mode !== SIGNAL_BRIDGE_V1_MODE
    || envelope.eventType !== SIGNAL_BRIDGE_V1_EVENT_TYPE
    || envelope.eventId !== recomputed) {
    throw new Error('SIGNAL_BRIDGE_V1_ENVELOPE_INTEGRITY_MISMATCH');
  }
  return JSON.stringify({
    version: SIGNAL_BRIDGE_V1_VERSION,
    mode: SIGNAL_BRIDGE_V1_MODE,
    eventType: SIGNAL_BRIDGE_V1_EVENT_TYPE,
    eventId: envelope.eventId,
    payload: JSON.parse(canonicalPayloadJsonV1(envelope.payload)) as unknown,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseSignalBridgeEnvelopeV1(
  serialized: string,
  expectedLineage: RiskEngineLineageV1,
): SignalBridgeEnvelopeV1 {
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new Error('SIGNAL_BRIDGE_V1_INVALID_JSON'); }
  if (!isRecord(parsed) || !isRecord(parsed.payload) || !isRecord(parsed.payload.signal)
    || !isRecord(parsed.payload.lineage) || !isRecord(parsed.payload.riskDecision)) {
    throw new Error('SIGNAL_BRIDGE_V1_INVALID_ENVELOPE_SHAPE');
  }
  const signal = parsed.payload.signal;
  const lineage = parsed.payload.lineage;
  const risk = parsed.payload.riskDecision;
  const rebuilt = buildSignalBridgeEnvelopeV1({
    signal: {
      asset: signal.asset as 'XAUUSD',
      timeframe: signal.timeframe as 'M5',
      decisionTime: signal.decisionTime as number,
      decisionClose: signal.decisionClose as number,
      atrSma12OverClose: signal.atrSma12OverClose as number,
      rawProbability: signal.rawProbability as number,
      calibratedProbability: signal.calibratedProbability as number,
    },
    lineage: {
      finalSignalExecutionId: lineage.finalSignalExecutionId as string,
      finalSignalModelSha256: lineage.finalSignalModelSha256 as string,
      finalSignalCalibratorSha256: lineage.finalSignalCalibratorSha256 as string,
    },
    riskDecision: risk as unknown as RiskDecisionV1,
  }, expectedLineage);
  if (parsed.version !== SIGNAL_BRIDGE_V1_VERSION || parsed.mode !== SIGNAL_BRIDGE_V1_MODE
    || parsed.eventType !== SIGNAL_BRIDGE_V1_EVENT_TYPE || parsed.eventId !== rebuilt.eventId) {
    throw new Error('SIGNAL_BRIDGE_V1_ENVELOPE_INTEGRITY_MISMATCH');
  }
  if (serializeSignalBridgeEnvelopeV1(rebuilt) !== serialized) throw new Error('SIGNAL_BRIDGE_V1_NON_CANONICAL_SERIALIZATION');
  return rebuilt;
}

export async function publishSignalBridgeEnvelopeV1(
  envelope: SignalBridgeEnvelopeV1,
  sinks: readonly SignalBridgeSinkV1[],
): Promise<SignalBridgePublishReceiptV1> {
  if (sinks.length === 0) throw new Error('SIGNAL_BRIDGE_V1_NO_SINKS');
  serializeSignalBridgeEnvelopeV1(envelope);
  for (const sink of sinks) {
    if (!sink || typeof sink.publish !== 'function') throw new Error('SIGNAL_BRIDGE_V1_INVALID_SINK');
    await sink.publish(envelope);
  }
  return Object.freeze({ version: SIGNAL_BRIDGE_V1_VERSION, eventId: envelope.eventId, sinkCount: sinks.length });
}
