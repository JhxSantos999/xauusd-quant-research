import { calibrateV1, type PlattCalibratorV1 } from '../calibration/platt.js';
import { auditCandles, enforceDatasetContract, M5_TIMEFRAME_MS, type Candle } from '../data/contracts.js';
import { extractFeatureRowsV1, type FeatureRowV1 } from '../features/extractor.js';
import { predictLogisticV1, type TrainedLogisticV1 } from '../models/logistic.js';
import { evaluateRiskV1, type RiskDecisionV1, type RiskEngineLineageV1 } from '../risk/risk-engine.js';
import {
  buildSignalBridgeEnvelopeV1,
  type SignalBridgeEnvelopeV1,
  type SignalObjectV1,
} from '../bridge/signal-bridge-v1.js';
import {
  DEV_DATASET_CANDLES_V1,
  DEV_DATASET_ID_V1,
  DEV_DATASET_SHA256_V1,
  DEV_FIRST_BAR_OPEN_TIME_V1,
  DEV_INFORMATION_END_V1,
  DEV_MAX_BAR_OPEN_TIME_V1,
} from '../research/frozen-contracts.js';
import { SIGNAL_BRIDGE_V1_FROZEN_UPSTREAM } from '../research/signal-bridge-v1-contracts.js';

export const DEV_SIGNAL_REPLAY_V1_VERSION = 'dev_signal_replay_v1' as const;
export const DEV_SIGNAL_REPLAY_V1_MODE = 'DEV_REPLAY_ONLY' as const;
export const DEV_SIGNAL_REPLAY_V1_PAPER_EQUITY_QUOTE = 10_000;
export const DEV_SIGNAL_REPLAY_V1_POSITION_STATE = 'FLAT' as const;
export const DEV_SIGNAL_REPLAY_V1_DECISION_TIME = DEV_INFORMATION_END_V1;

export interface DevSignalReplayV1Result {
  readonly version: typeof DEV_SIGNAL_REPLAY_V1_VERSION;
  readonly mode: typeof DEV_SIGNAL_REPLAY_V1_MODE;
  readonly datasetId: typeof DEV_DATASET_ID_V1;
  readonly datasetSha256: typeof DEV_DATASET_SHA256_V1;
  readonly decisionTime: typeof DEV_SIGNAL_REPLAY_V1_DECISION_TIME;
  readonly signal: SignalObjectV1;
  readonly riskDecision: RiskDecisionV1;
  readonly envelope: SignalBridgeEnvelopeV1;
}

export function frozenReplayLineageV1(): RiskEngineLineageV1 {
  return Object.freeze({
    finalSignalExecutionId: SIGNAL_BRIDGE_V1_FROZEN_UPSTREAM.finalSignalExecutionId,
    finalSignalModelSha256: SIGNAL_BRIDGE_V1_FROZEN_UPSTREAM.finalSignalModelSha256,
    finalSignalCalibratorSha256: SIGNAL_BRIDGE_V1_FROZEN_UPSTREAM.finalSignalCalibratorSha256,
  });
}

function validateCanonicalDevCandlesV1(candles: readonly Candle[]): void {
  const audit = auditCandles(candles);
  if (audit.candles !== DEV_DATASET_CANDLES_V1) {
    throw new Error(`DEV_SIGNAL_REPLAY_V1_CANDLE_COUNT_MISMATCH:${audit.candles}`);
  }
  if (audit.firstBarOpenTime !== DEV_FIRST_BAR_OPEN_TIME_V1 || audit.lastBarOpenTime !== DEV_MAX_BAR_OPEN_TIME_V1) {
    throw new Error('DEV_SIGNAL_REPLAY_V1_DATASET_BOUNDARY_MISMATCH');
  }
  if (audit.duplicateTimestamps !== 0 || audit.nonIncreasingTimestamps !== 0
    || audit.invalidGeometry !== 0 || audit.nonFiniteValues !== 0) {
    throw new Error('DEV_SIGNAL_REPLAY_V1_DATASET_AUDIT_FAILED');
  }
  enforceDatasetContract(candles, {
    datasetId: DEV_DATASET_ID_V1,
    datasetSha256: DEV_DATASET_SHA256_V1,
    timeframeMs: M5_TIMEFRAME_MS,
    maxCandleOpenTime: DEV_MAX_BAR_OPEN_TIME_V1,
    maxInformationTime: DEV_INFORMATION_END_V1,
  });
}

export function inferSignalObjectFromFeatureV1(
  feature: FeatureRowV1,
  decisionClose: number,
  model: TrainedLogisticV1,
  calibrator: PlattCalibratorV1,
): SignalObjectV1 {
  if (!Number.isFinite(decisionClose) || decisionClose <= 0) {
    throw new Error('DEV_SIGNAL_REPLAY_V1_INVALID_DECISION_CLOSE');
  }
  if (feature.decisionTime > DEV_INFORMATION_END_V1) {
    throw new Error('DEV_SIGNAL_REPLAY_V1_FUTURE_INFORMATION_FORBIDDEN');
  }
  const rawProbability = predictLogisticV1(model, [feature.vector])[0]!;
  const calibratedProbability = calibrateV1(calibrator, [rawProbability])[0]!;
  return Object.freeze({
    asset: 'XAUUSD',
    timeframe: 'M5',
    decisionTime: feature.decisionTime,
    decisionClose,
    atrSma12OverClose: feature.vector[9],
    rawProbability,
    calibratedProbability,
  });
}

export function buildDevSignalReplayV1(
  candles: readonly Candle[],
  model: TrainedLogisticV1,
  calibrator: PlattCalibratorV1,
): DevSignalReplayV1Result {
  validateCanonicalDevCandlesV1(candles);
  const featureRows = extractFeatureRowsV1(candles);
  const feature = featureRows.at(-1);
  if (!feature) throw new Error('DEV_SIGNAL_REPLAY_V1_NO_FEATURE_ROWS');
  if (feature.barIndex !== candles.length - 1
    || feature.decisionBarOpenTime !== DEV_MAX_BAR_OPEN_TIME_V1
    || feature.decisionTime !== DEV_SIGNAL_REPLAY_V1_DECISION_TIME) {
    throw new Error('DEV_SIGNAL_REPLAY_V1_LATEST_DECISION_MISMATCH');
  }

  const decisionCandle = candles[feature.barIndex]!;
  const signal = inferSignalObjectFromFeatureV1(feature, decisionCandle.close, model, calibrator);
  const lineage = frozenReplayLineageV1();
  const riskDecision = evaluateRiskV1({
    asset: 'XAUUSD',
    timeframe: 'M5',
    decisionTime: signal.decisionTime,
    calibratedProbability: signal.calibratedProbability,
    decisionClose: signal.decisionClose,
    atrSma12OverClose: signal.atrSma12OverClose,
    accountEquityQuote: DEV_SIGNAL_REPLAY_V1_PAPER_EQUITY_QUOTE,
    positionState: DEV_SIGNAL_REPLAY_V1_POSITION_STATE,
    finalSignalExecutionId: lineage.finalSignalExecutionId,
    finalSignalModelSha256: lineage.finalSignalModelSha256,
    finalSignalCalibratorSha256: lineage.finalSignalCalibratorSha256,
  }, lineage);

  const envelope = buildSignalBridgeEnvelopeV1({ signal, lineage, riskDecision }, lineage);
  return Object.freeze({
    version: DEV_SIGNAL_REPLAY_V1_VERSION,
    mode: DEV_SIGNAL_REPLAY_V1_MODE,
    datasetId: DEV_DATASET_ID_V1,
    datasetSha256: DEV_DATASET_SHA256_V1,
    decisionTime: DEV_SIGNAL_REPLAY_V1_DECISION_TIME,
    signal,
    riskDecision,
    envelope,
  });
}
