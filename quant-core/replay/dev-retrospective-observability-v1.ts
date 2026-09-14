import type { PlattCalibratorV1 } from '../calibration/platt.js';
import { extractFeatureRowsV1, type FeatureRowV1 } from '../features/extractor.js';
import type { TrainedLogisticV1 } from '../models/logistic.js';
import { evaluateRiskV1, type RiskDecisionV1 } from '../risk/risk-engine.js';
import { buildSignalBridgeEnvelopeV1, type SignalBridgeEnvelopeV1, type SignalObjectV1 } from '../bridge/signal-bridge-v1.js';
import {
  DEV_SIGNAL_REPLAY_V1_PAPER_EQUITY_QUOTE,
  DEV_SIGNAL_REPLAY_V1_POSITION_STATE,
  frozenReplayLineageV1,
  inferSignalObjectFromFeatureV1,
} from './dev-signal-replay-v1.js';
import { DEV_INFORMATION_END_V1 } from '../research/frozen-contracts.js';
import type { Candle } from '../data/contracts.js';

export const DEV_RETROSPECTIVE_OBSERVABILITY_V1_VERSION = 'dev_retrospective_observability_v1' as const;
export const DEV_RETROSPECTIVE_OBSERVABILITY_V1_MODE = 'DEV_RETROSPECTIVE_OBSERVABILITY_ONLY' as const;
export const DEV_RETROSPECTIVE_OBSERVABILITY_V1_RECORD_COUNT = 288;
export const DEV_RETROSPECTIVE_OBSERVABILITY_V1_CAUSAL_HISTORICAL_PREDICTION = false as const;
export const DEV_RETROSPECTIVE_OBSERVABILITY_V1_OUTCOMES_READ = false as const;
export const DEV_RETROSPECTIVE_OBSERVABILITY_V1_RISK_STATE_MODE = 'ISOLATED_FLAT_PER_EVENT' as const;

export interface DevRetrospectiveObservationV1 {
  readonly index: number;
  readonly signal: SignalObjectV1;
  readonly riskDecision: RiskDecisionV1;
  readonly envelope: SignalBridgeEnvelopeV1;
}

export interface DevRetrospectiveObservabilityV1Result {
  readonly version: typeof DEV_RETROSPECTIVE_OBSERVABILITY_V1_VERSION;
  readonly mode: typeof DEV_RETROSPECTIVE_OBSERVABILITY_V1_MODE;
  readonly causalHistoricalPrediction: false;
  readonly predictiveValidityClaimed: false;
  readonly outcomesRead: false;
  readonly riskStateMode: typeof DEV_RETROSPECTIVE_OBSERVABILITY_V1_RISK_STATE_MODE;
  readonly recordCount: typeof DEV_RETROSPECTIVE_OBSERVABILITY_V1_RECORD_COUNT;
  readonly firstDecisionTime: number;
  readonly lastDecisionTime: number;
  readonly observations: readonly DevRetrospectiveObservationV1[];
}

export function selectDevRetrospectiveFeatureRowsV1(
  featureRows: readonly FeatureRowV1[],
): readonly FeatureRowV1[] {
  if (featureRows.length < DEV_RETROSPECTIVE_OBSERVABILITY_V1_RECORD_COUNT) {
    throw new Error(`DEV_RETROSPECTIVE_OBSERVABILITY_V1_INSUFFICIENT_FEATURE_ROWS:${featureRows.length}`);
  }
  const selected = featureRows.slice(-DEV_RETROSPECTIVE_OBSERVABILITY_V1_RECORD_COUNT);
  let previous = Number.NEGATIVE_INFINITY;
  for (const feature of selected) {
    if (!Number.isSafeInteger(feature.decisionTime) || feature.decisionTime > DEV_INFORMATION_END_V1) {
      throw new Error('DEV_RETROSPECTIVE_OBSERVABILITY_V1_INFORMATION_BOUNDARY_VIOLATION');
    }
    if (feature.decisionTime <= previous) {
      throw new Error('DEV_RETROSPECTIVE_OBSERVABILITY_V1_NONINCREASING_DECISION_TIME');
    }
    previous = feature.decisionTime;
  }
  return Object.freeze(selected.slice());
}

export function buildDevRetrospectiveObservationV1(
  index: number,
  feature: FeatureRowV1,
  decisionClose: number,
  model: TrainedLogisticV1,
  calibrator: PlattCalibratorV1,
): DevRetrospectiveObservationV1 {
  if (!Number.isInteger(index) || index < 0 || index >= DEV_RETROSPECTIVE_OBSERVABILITY_V1_RECORD_COUNT) {
    throw new Error('DEV_RETROSPECTIVE_OBSERVABILITY_V1_INVALID_INDEX');
  }
  const signal = inferSignalObjectFromFeatureV1(feature, decisionClose, model, calibrator);
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
  return Object.freeze({ index, signal, riskDecision, envelope });
}

export function buildDevRetrospectiveObservabilityV1(
  candles: readonly Candle[],
  model: TrainedLogisticV1,
  calibrator: PlattCalibratorV1,
): DevRetrospectiveObservabilityV1Result {
  const featureRows = extractFeatureRowsV1(candles);
  const selected = selectDevRetrospectiveFeatureRowsV1(featureRows);
  const observations = selected.map((feature, index) => {
    const candle = candles[feature.barIndex];
    if (!candle || candle.time !== feature.decisionBarOpenTime) {
      throw new Error('DEV_RETROSPECTIVE_OBSERVABILITY_V1_DECISION_CANDLE_MISMATCH');
    }
    return buildDevRetrospectiveObservationV1(index, feature, candle.close, model, calibrator);
  });
  const eventIds = new Set(observations.map((observation) => observation.envelope.eventId));
  if (eventIds.size !== observations.length) {
    throw new Error('DEV_RETROSPECTIVE_OBSERVABILITY_V1_DUPLICATE_EVENT_ID');
  }
  return Object.freeze({
    version: DEV_RETROSPECTIVE_OBSERVABILITY_V1_VERSION,
    mode: DEV_RETROSPECTIVE_OBSERVABILITY_V1_MODE,
    causalHistoricalPrediction: DEV_RETROSPECTIVE_OBSERVABILITY_V1_CAUSAL_HISTORICAL_PREDICTION,
    predictiveValidityClaimed: false,
    outcomesRead: DEV_RETROSPECTIVE_OBSERVABILITY_V1_OUTCOMES_READ,
    riskStateMode: DEV_RETROSPECTIVE_OBSERVABILITY_V1_RISK_STATE_MODE,
    recordCount: DEV_RETROSPECTIVE_OBSERVABILITY_V1_RECORD_COUNT,
    firstDecisionTime: observations[0]!.signal.decisionTime,
    lastDecisionTime: observations.at(-1)!.signal.decisionTime,
    observations: Object.freeze(observations.slice()),
  });
}
