export const RISK_ENGINE_V1_VERSION = 'risk_engine_v1' as const;
export const RISK_ENGINE_V1_LONG_THRESHOLD = 0.5;
export const RISK_ENGINE_V1_SHORT_THRESHOLD = 0.5;
export const RISK_ENGINE_V1_PER_TRADE_EQUITY_FRACTION = 0.0025;
export const RISK_ENGINE_V1_MAX_GROSS_EXPOSURE_MULTIPLE = 1.0;
export const RISK_ENGINE_V1_STOP_ATR_MULTIPLE = 1.0;
export const RISK_ENGINE_V1_TIME_EXIT_BARS = 3;
export const RISK_ENGINE_V1_TIME_EXIT_MS = 900000;

export type PositionStateV1 = 'FLAT' | 'LONG' | 'SHORT';
export type RiskSideV1 = 'LONG' | 'SHORT';

export interface RiskSignalInputV1 {
  readonly asset: 'XAUUSD';
  readonly timeframe: 'M5';
  readonly decisionTime: number;
  readonly calibratedProbability: number;
  readonly decisionClose: number;
  readonly atrSma12OverClose: number;
  readonly accountEquityQuote: number;
  readonly positionState: PositionStateV1;
  readonly finalSignalExecutionId: string;
  readonly finalSignalModelSha256: string;
  readonly finalSignalCalibratorSha256: string;
}

export interface RiskNoTradeV1 {
  readonly version: typeof RISK_ENGINE_V1_VERSION;
  readonly action: 'NO_TRADE';
  readonly reason: 'PROBABILITY_EXACTLY_0_5' | 'POSITION_ALREADY_OPEN';
  readonly decisionTime: number;
}

export interface RiskTradeIntentV1 {
  readonly version: typeof RISK_ENGINE_V1_VERSION;
  readonly action: 'TRADE_INTENT';
  readonly side: RiskSideV1;
  readonly decisionTime: number;
  readonly calibratedProbability: number;
  readonly riskFraction: typeof RISK_ENGINE_V1_PER_TRADE_EQUITY_FRACTION;
  readonly maxQuoteRisk: number;
  readonly maxGrossExposureMultiple: typeof RISK_ENGINE_V1_MAX_GROSS_EXPOSURE_MULTIPLE;
  readonly maxGrossNotionalQuote: number;
  readonly stopAtrMultiple: typeof RISK_ENGINE_V1_STOP_ATR_MULTIPLE;
  readonly stopDistancePrice: number;
  readonly timeExitBars: typeof RISK_ENGINE_V1_TIME_EXIT_BARS;
  readonly timeExitTime: number;
  readonly takeProfitPolicy: 'NONE';
  readonly quantityConversion: 'DEFERRED_TO_EXECUTION_ENGINE';
}

export type RiskDecisionV1 = RiskNoTradeV1 | RiskTradeIntentV1;

export interface RiskEngineLineageV1 {
  readonly finalSignalExecutionId: string;
  readonly finalSignalModelSha256: string;
  readonly finalSignalCalibratorSha256: string;
}

function assertFinitePositive(value: number, code: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(code);
}

export function evaluateRiskV1(input: RiskSignalInputV1, lineage: RiskEngineLineageV1): RiskDecisionV1 {
  if (input.asset !== 'XAUUSD' || input.timeframe !== 'M5') throw new Error('RISK_ENGINE_ASSET_TIMEFRAME_MISMATCH');
  if (!Number.isFinite(input.decisionTime)) throw new Error('RISK_ENGINE_INVALID_DECISION_TIME');
  if (!Number.isFinite(input.calibratedProbability) || input.calibratedProbability < 0 || input.calibratedProbability > 1) {
    throw new Error('RISK_ENGINE_INVALID_CALIBRATED_PROBABILITY');
  }
  assertFinitePositive(input.decisionClose, 'RISK_ENGINE_INVALID_DECISION_CLOSE');
  assertFinitePositive(input.atrSma12OverClose, 'RISK_ENGINE_INVALID_ATR_RATIO');
  assertFinitePositive(input.accountEquityQuote, 'RISK_ENGINE_INVALID_ACCOUNT_EQUITY');
  if (input.finalSignalExecutionId !== lineage.finalSignalExecutionId
    || input.finalSignalModelSha256 !== lineage.finalSignalModelSha256
    || input.finalSignalCalibratorSha256 !== lineage.finalSignalCalibratorSha256) {
    throw new Error('RISK_ENGINE_SIGNAL_LINEAGE_MISMATCH');
  }

  if (input.positionState !== 'FLAT') {
    return {
      version: RISK_ENGINE_V1_VERSION,
      action: 'NO_TRADE',
      reason: 'POSITION_ALREADY_OPEN',
      decisionTime: input.decisionTime,
    };
  }
  if (input.calibratedProbability === 0.5) {
    return {
      version: RISK_ENGINE_V1_VERSION,
      action: 'NO_TRADE',
      reason: 'PROBABILITY_EXACTLY_0_5',
      decisionTime: input.decisionTime,
    };
  }

  const side: RiskSideV1 = input.calibratedProbability > 0.5 ? 'LONG' : 'SHORT';
  const stopDistancePrice = input.decisionClose * input.atrSma12OverClose * RISK_ENGINE_V1_STOP_ATR_MULTIPLE;
  assertFinitePositive(stopDistancePrice, 'RISK_ENGINE_INVALID_STOP_DISTANCE');
  const maxQuoteRisk = input.accountEquityQuote * RISK_ENGINE_V1_PER_TRADE_EQUITY_FRACTION;
  const maxGrossNotionalQuote = input.accountEquityQuote * RISK_ENGINE_V1_MAX_GROSS_EXPOSURE_MULTIPLE;
  assertFinitePositive(maxQuoteRisk, 'RISK_ENGINE_INVALID_MAX_QUOTE_RISK');
  assertFinitePositive(maxGrossNotionalQuote, 'RISK_ENGINE_INVALID_MAX_GROSS_NOTIONAL');
  const timeExitTime = input.decisionTime + RISK_ENGINE_V1_TIME_EXIT_MS;
  if (!Number.isFinite(timeExitTime)) throw new Error('RISK_ENGINE_INVALID_TIME_EXIT');

  return {
    version: RISK_ENGINE_V1_VERSION,
    action: 'TRADE_INTENT',
    side,
    decisionTime: input.decisionTime,
    calibratedProbability: input.calibratedProbability,
    riskFraction: RISK_ENGINE_V1_PER_TRADE_EQUITY_FRACTION,
    maxQuoteRisk,
    maxGrossExposureMultiple: RISK_ENGINE_V1_MAX_GROSS_EXPOSURE_MULTIPLE,
    maxGrossNotionalQuote,
    stopAtrMultiple: RISK_ENGINE_V1_STOP_ATR_MULTIPLE,
    stopDistancePrice,
    timeExitBars: RISK_ENGINE_V1_TIME_EXIT_BARS,
    timeExitTime,
    takeProfitPolicy: 'NONE',
    quantityConversion: 'DEFERRED_TO_EXECUTION_ENGINE',
  };
}
