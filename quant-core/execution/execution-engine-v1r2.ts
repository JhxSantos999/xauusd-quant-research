import type { RiskTradeIntentV1, RiskSideV1 } from '../risk/risk-engine.js';
import {
  EXECUTION_V1_CONTRACT_SIZE,
  EXECUTION_V1_POINT,
  EXECUTION_V1_STOPS_LEVEL_POINTS,
  EXECUTION_V1_VOLUME_MAX,
  EXECUTION_V1_VOLUME_MIN,
  EXECUTION_V1_VOLUME_STEP,
  quoteBarV1,
  stopFillPriceV1,
  timeExitFillPriceV1,
  type ExecutionBarV1,
  type ExecutionFillV1,
  type ExecutionSizingV1,
} from './execution-engine.js';
import {
  EXECUTION_V1R1_HOLD_BARS,
  EXECUTION_V1R1_TIMEFRAME_MS,
  buildExecutionWindowV1R1,
  type ExecutionWindowV1R1,
} from './execution-engine-v1r1.js';

export const EXECUTION_ENGINE_V1R2_VERSION = 'execution_engine_v1r2' as const;
export const EXECUTION_V1R2_BROKER_STOP_REJECTION = 'NO_FILL_BROKER_STOP_CONSTRAINT' as const;
export const EXECUTION_V1R2_SESSION_REJECTION = 'NO_FILL_SESSION_WINDOW' as const;
export const EXECUTION_V1R2_SIZING_REJECTION = 'NO_FILL_SIZING' as const;

export type ExecutionNoFillReasonV1R2 =
  | typeof EXECUTION_V1R2_BROKER_STOP_REJECTION
  | typeof EXECUTION_V1R2_SESSION_REJECTION
  | typeof EXECUTION_V1R2_SIZING_REJECTION;

export interface OpenExecutionFilledV1R2 {
  readonly status: 'FILLED';
  readonly fill: ExecutionFillV1;
  readonly window: ExecutionWindowV1R1;
}

export interface OpenExecutionRejectedV1R2 {
  readonly status: 'NO_FILL';
  readonly reason: ExecutionNoFillReasonV1R2;
}

export type OpenExecutionResultV1R2 = OpenExecutionFilledV1R2 | OpenExecutionRejectedV1R2;

function assertFinitePositive(value: number, code: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(code);
}

function floorVolumeToStepV1R2(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('EXECUTION_V1R2_INVALID_VOLUME_CANDIDATE');
  const steps = Math.floor((value + 1e-12) / EXECUTION_V1_VOLUME_STEP);
  return Number((steps * EXECUTION_V1_VOLUME_STEP).toFixed(8));
}

export function brokerMinimumStopDistanceV1R2(): number {
  return EXECUTION_V1_STOPS_LEVEL_POINTS * EXECUTION_V1_POINT;
}

export function sizeExecutionV1R2(
  intent: RiskTradeIntentV1,
  entryPrice: number,
): ExecutionSizingV1 | null {
  assertFinitePositive(entryPrice, 'EXECUTION_V1R2_INVALID_ENTRY_PRICE');
  assertFinitePositive(intent.maxQuoteRisk, 'EXECUTION_V1R2_INVALID_MAX_QUOTE_RISK');
  assertFinitePositive(intent.maxGrossNotionalQuote, 'EXECUTION_V1R2_INVALID_MAX_GROSS_NOTIONAL');
  assertFinitePositive(intent.stopDistancePrice, 'EXECUTION_V1R2_INVALID_RISK_STOP_DISTANCE');

  const brokerMinStop = brokerMinimumStopDistanceV1R2();
  if (intent.stopDistancePrice < brokerMinStop) return null;

  const stopDistancePrice = intent.stopDistancePrice;
  const quantityRisk = intent.maxQuoteRisk / (stopDistancePrice * EXECUTION_V1_CONTRACT_SIZE);
  const quantityGrossCap = intent.maxGrossNotionalQuote / (entryPrice * EXECUTION_V1_CONTRACT_SIZE);
  const capped = Math.min(quantityRisk, quantityGrossCap, EXECUTION_V1_VOLUME_MAX);
  const volume = floorVolumeToStepV1R2(capped);
  if (volume < EXECUTION_V1_VOLUME_MIN) return null;

  const grossNotionalQuote = volume * EXECUTION_V1_CONTRACT_SIZE * entryPrice;
  const maxLossAtStopBeforeSlippageQuote = volume * EXECUTION_V1_CONTRACT_SIZE * stopDistancePrice;
  if (grossNotionalQuote > intent.maxGrossNotionalQuote + 1e-9) throw new Error('EXECUTION_V1R2_GROSS_CAP_VIOLATION');
  if (maxLossAtStopBeforeSlippageQuote > intent.maxQuoteRisk + 1e-9) throw new Error('EXECUTION_V1R2_RISK_BUDGET_VIOLATION');

  return {
    stopDistancePrice,
    quantityRisk,
    quantityGrossCap,
    volume,
    grossNotionalQuote,
    maxLossAtStopBeforeSlippageQuote,
  };
}

function openOnEntryBarV1R2(
  intent: RiskTradeIntentV1,
  bar: ExecutionBarV1,
): ExecutionFillV1 | null {
  if (bar.time !== intent.decisionTime) return null;
  const quoted = quoteBarV1(bar);
  const entryPrice = intent.side === 'LONG' ? quoted.askOpen : quoted.open;
  const sizing = sizeExecutionV1R2(intent, entryPrice);
  if (!sizing) return null;

  const stopPrice = intent.side === 'LONG'
    ? entryPrice - sizing.stopDistancePrice
    : entryPrice + sizing.stopDistancePrice;
  assertFinitePositive(stopPrice, 'EXECUTION_V1R2_INVALID_STOP_PRICE');

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

export function openExecutionV1R2(
  intent: RiskTradeIntentV1,
  bars: readonly ExecutionBarV1[],
): OpenExecutionResultV1R2 {
  if (intent.timeExitBars !== EXECUTION_V1R1_HOLD_BARS) throw new Error('EXECUTION_V1R2_TIME_EXIT_BARS_MISMATCH');
  const expectedExit = intent.decisionTime + EXECUTION_V1R1_HOLD_BARS * EXECUTION_V1R1_TIMEFRAME_MS;
  if (intent.timeExitTime !== expectedExit) throw new Error('EXECUTION_V1R2_TIME_EXIT_TIME_MISMATCH');

  const window = buildExecutionWindowV1R1(intent.decisionTime, bars);
  if (!window) return { status: 'NO_FILL', reason: EXECUTION_V1R2_SESSION_REJECTION };

  if (intent.stopDistancePrice < brokerMinimumStopDistanceV1R2()) {
    return { status: 'NO_FILL', reason: EXECUTION_V1R2_BROKER_STOP_REJECTION };
  }

  const fill = openOnEntryBarV1R2(intent, window.entryBar);
  if (!fill) return { status: 'NO_FILL', reason: EXECUTION_V1R2_SIZING_REJECTION };

  if (Math.abs(fill.stopDistancePrice - intent.stopDistancePrice) > 1e-12) {
    throw new Error('EXECUTION_V1R2_STOP_INTENT_MUTATION');
  }
  const stopRisk = fill.volume * EXECUTION_V1_CONTRACT_SIZE * fill.stopDistancePrice;
  if (stopRisk > intent.maxQuoteRisk + 1e-9) throw new Error('EXECUTION_V1R2_POST_FILL_RISK_BUDGET_VIOLATION');

  return { status: 'FILLED', fill, window };
}

export function stopBeforeTimeExitV1R2(
  fill: ExecutionFillV1,
  window: ExecutionWindowV1R1,
): { readonly time: number; readonly price: number } | null {
  for (const bar of window.holdingBars) {
    const price = stopFillPriceV1(fill, bar);
    if (price !== null) return { time: bar.time, price };
  }
  return null;
}

export function timeExitFillV1R2(
  side: RiskSideV1,
  window: ExecutionWindowV1R1,
): { readonly time: number; readonly price: number } {
  return {
    time: window.exitBar.time,
    price: timeExitFillPriceV1(side, window.exitBar),
  };
}
