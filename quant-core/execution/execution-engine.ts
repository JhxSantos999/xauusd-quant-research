import type { RiskTradeIntentV1, RiskSideV1 } from '../risk/risk-engine.js';

export const EXECUTION_ENGINE_V1_VERSION = 'execution_engine_v1' as const;
export const EXECUTION_V1_POINT = 0.01;
export const EXECUTION_V1_CONTRACT_SIZE = 100;
export const EXECUTION_V1_STOPS_LEVEL_POINTS = 20;
export const EXECUTION_V1_VOLUME_MIN = 0.01;
export const EXECUTION_V1_VOLUME_MAX = 20;
export const EXECUTION_V1_VOLUME_STEP = 0.01;
export const EXECUTION_V1_COMMISSION_PER_LOT_PER_SIDE = 0;

export interface ExecutionBarV1 {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly spreadPoints: number;
}

export interface ExecutionQuoteBarV1 extends ExecutionBarV1 {
  readonly spreadPrice: number;
  readonly askOpen: number;
  readonly askHigh: number;
  readonly askLow: number;
  readonly askClose: number;
}

export interface ExecutionSizingV1 {
  readonly stopDistancePrice: number;
  readonly quantityRisk: number;
  readonly quantityGrossCap: number;
  readonly volume: number;
  readonly grossNotionalQuote: number;
  readonly maxLossAtStopBeforeSlippageQuote: number;
}

export interface ExecutionFillV1 {
  readonly time: number;
  readonly side: RiskSideV1;
  readonly price: number;
  readonly volume: number;
  readonly spreadPrice: number;
  readonly stopDistancePrice: number;
  readonly stopPrice: number;
}

function assertFinitePositive(value: number, code: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(code);
}

export function quoteBarV1(bar: ExecutionBarV1): ExecutionQuoteBarV1 {
  if (!Number.isFinite(bar.time)) throw new Error('EXECUTION_V1_INVALID_BAR_TIME');
  for (const [value, code] of [
    [bar.open, 'OPEN'], [bar.high, 'HIGH'], [bar.low, 'LOW'], [bar.close, 'CLOSE'],
  ] as const) assertFinitePositive(value, `EXECUTION_V1_INVALID_${code}`);
  if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.high < bar.low) throw new Error('EXECUTION_V1_INVALID_BAR_GEOMETRY');
  if (!Number.isFinite(bar.spreadPoints) || bar.spreadPoints < 0) throw new Error('EXECUTION_V1_INVALID_SPREAD_POINTS');
  const spreadPrice = bar.spreadPoints * EXECUTION_V1_POINT;
  return {
    ...bar,
    spreadPrice,
    askOpen: bar.open + spreadPrice,
    askHigh: bar.high + spreadPrice,
    askLow: bar.low + spreadPrice,
    askClose: bar.close + spreadPrice,
  };
}

function floorVolumeToStep(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('EXECUTION_V1_INVALID_VOLUME_CANDIDATE');
  const steps = Math.floor((value + 1e-12) / EXECUTION_V1_VOLUME_STEP);
  return Number((steps * EXECUTION_V1_VOLUME_STEP).toFixed(8));
}

export function sizeExecutionV1(intent: RiskTradeIntentV1, entryPrice: number): ExecutionSizingV1 | null {
  assertFinitePositive(entryPrice, 'EXECUTION_V1_INVALID_ENTRY_PRICE');
  assertFinitePositive(intent.maxQuoteRisk, 'EXECUTION_V1_INVALID_MAX_QUOTE_RISK');
  assertFinitePositive(intent.maxGrossNotionalQuote, 'EXECUTION_V1_INVALID_MAX_GROSS_NOTIONAL');
  assertFinitePositive(intent.stopDistancePrice, 'EXECUTION_V1_INVALID_RISK_STOP_DISTANCE');
  const brokerMinStop = EXECUTION_V1_STOPS_LEVEL_POINTS * EXECUTION_V1_POINT;
  const stopDistancePrice = Math.max(intent.stopDistancePrice, brokerMinStop);
  const quantityRisk = intent.maxQuoteRisk / (stopDistancePrice * EXECUTION_V1_CONTRACT_SIZE);
  const quantityGrossCap = intent.maxGrossNotionalQuote / (entryPrice * EXECUTION_V1_CONTRACT_SIZE);
  const capped = Math.min(quantityRisk, quantityGrossCap, EXECUTION_V1_VOLUME_MAX);
  const volume = floorVolumeToStep(capped);
  if (volume < EXECUTION_V1_VOLUME_MIN) return null;
  const grossNotionalQuote = volume * EXECUTION_V1_CONTRACT_SIZE * entryPrice;
  const maxLossAtStopBeforeSlippageQuote = volume * EXECUTION_V1_CONTRACT_SIZE * stopDistancePrice;
  if (grossNotionalQuote > intent.maxGrossNotionalQuote + 1e-9) throw new Error('EXECUTION_V1_GROSS_CAP_VIOLATION');
  if (maxLossAtStopBeforeSlippageQuote > intent.maxQuoteRisk + 1e-9) throw new Error('EXECUTION_V1_RISK_BUDGET_VIOLATION');
  return { stopDistancePrice, quantityRisk, quantityGrossCap, volume, grossNotionalQuote, maxLossAtStopBeforeSlippageQuote };
}

export function openExecutionV1(intent: RiskTradeIntentV1, bar: ExecutionBarV1): ExecutionFillV1 | null {
  if (bar.time !== intent.decisionTime) return null;
  const quoted = quoteBarV1(bar);
  const entryPrice = intent.side === 'LONG' ? quoted.askOpen : quoted.open;
  const sizing = sizeExecutionV1(intent, entryPrice);
  if (!sizing) return null;
  const stopPrice = intent.side === 'LONG'
    ? entryPrice - sizing.stopDistancePrice
    : entryPrice + sizing.stopDistancePrice;
  assertFinitePositive(stopPrice, 'EXECUTION_V1_INVALID_STOP_PRICE');
  return {
    time: intent.decisionTime,
    side: intent.side,
    price: entryPrice,
    volume: sizing.volume,
    spreadPrice: quoted.spreadPrice,
    stopDistancePrice: sizing.stopDistancePrice,
    stopPrice,
  };
}

export function stopFillPriceV1(fill: ExecutionFillV1, bar: ExecutionBarV1): number | null {
  const q = quoteBarV1(bar);
  if (bar.time < fill.time) throw new Error('EXECUTION_V1_BAR_BEFORE_ENTRY');
  if (fill.side === 'LONG') {
    if (q.low > fill.stopPrice) return null;
    return q.open <= fill.stopPrice ? q.open : fill.stopPrice;
  }
  if (q.askHigh < fill.stopPrice) return null;
  return q.askOpen >= fill.stopPrice ? q.askOpen : fill.stopPrice;
}

export function timeExitFillPriceV1(side: RiskSideV1, bar: ExecutionBarV1): number {
  const q = quoteBarV1(bar);
  return side === 'LONG' ? q.open : q.askOpen;
}

export function quotePnlV1(side: RiskSideV1, entryPrice: number, exitPrice: number, volume: number): number {
  assertFinitePositive(entryPrice, 'EXECUTION_V1_INVALID_PNL_ENTRY_PRICE');
  assertFinitePositive(exitPrice, 'EXECUTION_V1_INVALID_PNL_EXIT_PRICE');
  assertFinitePositive(volume, 'EXECUTION_V1_INVALID_PNL_VOLUME');
  const delta = side === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice;
  return delta * EXECUTION_V1_CONTRACT_SIZE * volume;
}
