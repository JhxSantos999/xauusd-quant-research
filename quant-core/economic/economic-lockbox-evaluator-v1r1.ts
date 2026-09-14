import type { Candle } from '../data/contracts.js';
import { calibrateV1, type PlattCalibratorV1 } from '../calibration/platt.js';
import { openExecutionV1R1, stopBeforeTimeExitV1R1, timeExitFillV1R1 } from '../execution/execution-engine-v1r1.js';
import {
  EXECUTION_V1_CONTRACT_SIZE,
  quoteBarV1,
  quotePnlV1,
  type ExecutionBarV1,
} from '../execution/execution-engine.js';
import { extractFeatureRowsV1, type FeatureRowV1 } from '../features/extractor.js';
import { predictLogisticV1, type TrainedLogisticV1 } from '../models/logistic.js';
import {
  evaluateRiskV1,
  type PositionStateV1,
  type RiskEngineLineageV1,
  type RiskSideV1,
} from '../risk/risk-engine.js';

export const ECONOMIC_LOCKBOX_RUNNER_V1R1_VERSION = 'economic_lockbox_runner_v1r1' as const;
export const ECONOMIC_LOCKBOX_TIMEFRAME_MS = 300_000;

export interface EconomicScenarioV1R1 {
  readonly name: string;
  readonly slippageMultiplierOfSpreadPerFill: number;
}

export interface PreparedSignalV1R1 {
  readonly decisionTime: number;
  readonly decisionClose: number;
  readonly atrSma12OverClose: number;
  readonly rawProbability: number;
  readonly calibratedProbability: number;
}

export type EconomicExitReasonV1R1 = 'STOP' | 'TIME_EXIT';

export interface EconomicTradeV1R1 {
  readonly tradeIndex: number;
  readonly side: RiskSideV1;
  readonly decisionTime: number;
  readonly calibratedProbability: number;
  readonly volume: number;
  readonly baseEntryPrice: number;
  readonly scenarioEntryPrice: number;
  readonly stopPrice: number;
  readonly stopDistancePrice: number;
  readonly exitTime: number;
  readonly exitReason: EconomicExitReasonV1R1;
  readonly baseExitPrice: number;
  readonly scenarioExitPrice: number;
  readonly entrySpreadPrice: number;
  readonly exitSpreadPrice: number;
  readonly slippageMultiplierOfSpreadPerFill: number;
  readonly pnlQuote: number;
  readonly initialStopRiskQuote: number;
  readonly realizedR: number;
  readonly equityBefore: number;
  readonly equityAfter: number;
}

export interface EconomicScenarioSummaryV1R1 {
  readonly scenario: string;
  readonly slippageMultiplierOfSpreadPerFill: number;
  readonly initialEquity: number;
  readonly finalEquity: number;
  readonly finalEquityDelta: number;
  readonly filledTrades: number;
  readonly winningTrades: number;
  readonly losingTrades: number;
  readonly breakevenTrades: number;
  readonly winRate: number;
  readonly grossProfit: number;
  readonly grossLossAbs: number;
  readonly profitFactor: number | null;
  readonly profitFactorInfinite: boolean;
  readonly meanRealizedR: number;
  readonly averageTradeQuote: number;
  readonly maxDrawdownQuote: number;
  readonly maxDrawdownFraction: number;
  readonly minEquity: number;
  readonly stopExits: number;
  readonly timeExits: number;
  readonly signalsProcessed: number;
  readonly tradeIntents: number;
  readonly noTradePositionOpen: number;
  readonly noTradeProbabilityExactHalf: number;
  readonly noFillSessionWindow: number;
  readonly noFillSizing: number;
  readonly terminatedForNonpositiveEquity: boolean;
}

export interface EconomicScenarioResultV1R1 {
  readonly summary: EconomicScenarioSummaryV1R1;
  readonly trades: readonly EconomicTradeV1R1[];
}

export interface PrimaryGateResultV1R1 {
  readonly minimumFilledTrades: boolean;
  readonly basePositiveFinalEquityDelta: boolean;
  readonly baseProfitFactorAboveOne: boolean;
  readonly basePositiveMeanRealizedR: boolean;
  readonly stressHalfSpreadPositiveFinalEquityDelta: boolean;
  readonly stressHalfSpreadProfitFactorAboveOne: boolean;
  readonly allRequiredGatesPass: boolean;
}

export interface EconomicLockboxEvaluationV1R1 {
  readonly version: typeof ECONOMIC_LOCKBOX_RUNNER_V1R1_VERSION;
  readonly scenarioResults: readonly EconomicScenarioResultV1R1[];
  readonly gates: PrimaryGateResultV1R1;
  readonly status: 'ECONOMIC_LOCKBOX_V1R1_PASS' | 'ECONOMIC_LOCKBOX_V1R1_FAIL';
}

export interface PrimaryGatesConfigV1R1 {
  readonly minimumFilledTrades: number;
}

function assertFiniteNonnegative(value: number, code: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(code);
}

function assertFinitePositive(value: number, code: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(code);
}

function toExecutionBarV1R1(candle: Candle): ExecutionBarV1 {
  if (candle.spread === undefined) throw new Error(`ECONOMIC_V1R1_MISSING_SPREAD:${candle.time}`);
  if (!Number.isFinite(candle.spread) || candle.spread < 0) throw new Error(`ECONOMIC_V1R1_INVALID_SPREAD:${candle.time}`);
  return {
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    spreadPoints: candle.spread,
  };
}

function featureRowsInLockboxV1R1(
  candles: readonly Candle[],
  firstPotentialDecisionTime: number,
  informationEnd: number,
): FeatureRowV1[] {
  return extractFeatureRowsV1(candles).filter(
    (row) => row.decisionTime >= firstPotentialDecisionTime && row.decisionTime < informationEnd,
  );
}

export function prepareSignalsV1R1(
  candles: readonly Candle[],
  model: TrainedLogisticV1,
  calibrator: PlattCalibratorV1,
  firstPotentialDecisionTime: number,
  informationEnd: number,
): PreparedSignalV1R1[] {
  if (!Number.isFinite(firstPotentialDecisionTime) || !Number.isFinite(informationEnd) || firstPotentialDecisionTime >= informationEnd) {
    throw new Error('ECONOMIC_V1R1_INVALID_SIGNAL_WINDOW');
  }
  const rows = featureRowsInLockboxV1R1(candles, firstPotentialDecisionTime, informationEnd);
  if (rows.length === 0) throw new Error('ECONOMIC_V1R1_NO_SIGNAL_ROWS');
  const raw = predictLogisticV1(model, rows.map((row) => row.vector));
  const calibrated = calibrateV1(calibrator, raw);
  if (raw.length !== rows.length || calibrated.length !== rows.length) throw new Error('ECONOMIC_V1R1_SIGNAL_LENGTH_MISMATCH');
  return rows.map((row, i) => {
    const candle = candles[row.barIndex];
    if (!candle) throw new Error(`ECONOMIC_V1R1_SIGNAL_BAR_NOT_FOUND:${row.barIndex}`);
    const rawProbability = raw[i]!;
    const calibratedProbability = calibrated[i]!;
    if (!Number.isFinite(rawProbability) || !Number.isFinite(calibratedProbability)) {
      throw new Error(`ECONOMIC_V1R1_NONFINITE_PROBABILITY:${row.decisionTime}`);
    }
    return {
      decisionTime: row.decisionTime,
      decisionClose: candle.close,
      atrSma12OverClose: row.vector[9],
      rawProbability,
      calibratedProbability,
    };
  });
}

export function adverseSlippedPriceV1R1(
  side: RiskSideV1,
  phase: 'ENTRY' | 'EXIT',
  basePrice: number,
  spreadPrice: number,
  multiplier: number,
): number {
  assertFinitePositive(basePrice, 'ECONOMIC_V1R1_INVALID_BASE_FILL_PRICE');
  assertFiniteNonnegative(spreadPrice, 'ECONOMIC_V1R1_INVALID_FILL_SPREAD');
  assertFiniteNonnegative(multiplier, 'ECONOMIC_V1R1_INVALID_SLIPPAGE_MULTIPLIER');
  const adverse = multiplier * spreadPrice;
  const sign = phase === 'ENTRY'
    ? (side === 'LONG' ? 1 : -1)
    : (side === 'LONG' ? -1 : 1);
  const price = basePrice + sign * adverse;
  assertFinitePositive(price, 'ECONOMIC_V1R1_NONPOSITIVE_SLIPPED_PRICE');
  return price;
}

function profitFactorAboveOne(summary: EconomicScenarioSummaryV1R1): boolean {
  return summary.profitFactorInfinite || (summary.profitFactor !== null && summary.profitFactor > 1);
}

function summarizeScenarioV1R1(
  scenario: EconomicScenarioV1R1,
  initialEquity: number,
  trades: readonly EconomicTradeV1R1[],
  counters: {
    readonly signalsProcessed: number;
    readonly tradeIntents: number;
    readonly noTradePositionOpen: number;
    readonly noTradeProbabilityExactHalf: number;
    readonly noFillSessionWindow: number;
    readonly noFillSizing: number;
    readonly terminatedForNonpositiveEquity: boolean;
  },
): EconomicScenarioSummaryV1R1 {
  let grossProfit = 0;
  let grossLossAbs = 0;
  let winningTrades = 0;
  let losingTrades = 0;
  let breakevenTrades = 0;
  let stopExits = 0;
  let timeExits = 0;
  let sumR = 0;
  let sumPnl = 0;
  let peak = initialEquity;
  let maxDrawdownQuote = 0;
  let maxDrawdownFraction = 0;
  let minEquity = initialEquity;

  for (const trade of trades) {
    sumPnl += trade.pnlQuote;
    sumR += trade.realizedR;
    if (trade.pnlQuote > 0) {
      grossProfit += trade.pnlQuote;
      winningTrades++;
    } else if (trade.pnlQuote < 0) {
      grossLossAbs += -trade.pnlQuote;
      losingTrades++;
    } else {
      breakevenTrades++;
    }
    trade.exitReason === 'STOP' ? stopExits++ : timeExits++;
    if (trade.equityAfter > peak) peak = trade.equityAfter;
    const drawdown = peak - trade.equityAfter;
    const drawdownFraction = peak > 0 ? drawdown / peak : 0;
    if (drawdown > maxDrawdownQuote) maxDrawdownQuote = drawdown;
    if (drawdownFraction > maxDrawdownFraction) maxDrawdownFraction = drawdownFraction;
    if (trade.equityAfter < minEquity) minEquity = trade.equityAfter;
  }

  const finalEquity = trades.length === 0 ? initialEquity : trades[trades.length - 1]!.equityAfter;
  const profitFactorInfinite = grossLossAbs === 0 && grossProfit > 0;
  const profitFactor = grossLossAbs > 0 ? grossProfit / grossLossAbs : (profitFactorInfinite ? null : 0);
  const filledTrades = trades.length;

  return {
    scenario: scenario.name,
    slippageMultiplierOfSpreadPerFill: scenario.slippageMultiplierOfSpreadPerFill,
    initialEquity,
    finalEquity,
    finalEquityDelta: finalEquity - initialEquity,
    filledTrades,
    winningTrades,
    losingTrades,
    breakevenTrades,
    winRate: filledTrades > 0 ? winningTrades / filledTrades : 0,
    grossProfit,
    grossLossAbs,
    profitFactor,
    profitFactorInfinite,
    meanRealizedR: filledTrades > 0 ? sumR / filledTrades : 0,
    averageTradeQuote: filledTrades > 0 ? sumPnl / filledTrades : 0,
    maxDrawdownQuote,
    maxDrawdownFraction,
    minEquity,
    stopExits,
    timeExits,
    signalsProcessed: counters.signalsProcessed,
    tradeIntents: counters.tradeIntents,
    noTradePositionOpen: counters.noTradePositionOpen,
    noTradeProbabilityExactHalf: counters.noTradeProbabilityExactHalf,
    noFillSessionWindow: counters.noFillSessionWindow,
    noFillSizing: counters.noFillSizing,
    terminatedForNonpositiveEquity: counters.terminatedForNonpositiveEquity,
  };
}

export function simulateScenarioV1R1(
  candles: readonly Candle[],
  signals: readonly PreparedSignalV1R1[],
  lineage: RiskEngineLineageV1,
  initialEquity: number,
  scenario: EconomicScenarioV1R1,
): EconomicScenarioResultV1R1 {
  assertFinitePositive(initialEquity, 'ECONOMIC_V1R1_INVALID_INITIAL_EQUITY');
  assertFiniteNonnegative(
    scenario.slippageMultiplierOfSpreadPerFill,
    'ECONOMIC_V1R1_INVALID_SCENARIO_SLIPPAGE',
  );

  const executionBarsByTime = new Map<number, ExecutionBarV1>();
  for (const candle of candles) {
    if (executionBarsByTime.has(candle.time)) throw new Error(`ECONOMIC_V1R1_DUPLICATE_BAR_TIME:${candle.time}`);
    executionBarsByTime.set(candle.time, toExecutionBarV1R1(candle));
  }

  const trades: EconomicTradeV1R1[] = [];
  let equity = initialEquity;
  let flatAvailableAt = Number.NEGATIVE_INFINITY;
  let openSide: RiskSideV1 = 'LONG';
  let tradeIntents = 0;
  let noTradePositionOpen = 0;
  let noTradeProbabilityExactHalf = 0;
  let noFillSessionWindow = 0;
  let noFillSizing = 0;
  let signalsProcessed = 0;
  let terminatedForNonpositiveEquity = false;

  for (const signal of signals) {
    if (!(equity > 0) || !Number.isFinite(equity)) {
      terminatedForNonpositiveEquity = true;
      break;
    }
    signalsProcessed++;
    const positionState: PositionStateV1 = signal.decisionTime < flatAvailableAt ? openSide : 'FLAT';
    const risk = evaluateRiskV1({
      asset: 'XAUUSD',
      timeframe: 'M5',
      decisionTime: signal.decisionTime,
      calibratedProbability: signal.calibratedProbability,
      decisionClose: signal.decisionClose,
      atrSma12OverClose: signal.atrSma12OverClose,
      accountEquityQuote: equity,
      positionState,
      finalSignalExecutionId: lineage.finalSignalExecutionId,
      finalSignalModelSha256: lineage.finalSignalModelSha256,
      finalSignalCalibratorSha256: lineage.finalSignalCalibratorSha256,
    }, lineage);

    if (risk.action === 'NO_TRADE') {
      if (risk.reason === 'POSITION_ALREADY_OPEN') noTradePositionOpen++;
      else noTradeProbabilityExactHalf++;
      continue;
    }
    tradeIntents++;

    const requiredTimes = [0, 300_000, 600_000, 900_000].map((offset) => signal.decisionTime + offset);
    const windowBars = requiredTimes.map((time) => executionBarsByTime.get(time));
    if (windowBars.some((bar) => bar === undefined)) {
      noFillSessionWindow++;
      continue;
    }

    const opened = openExecutionV1R1(risk, windowBars as [ExecutionBarV1, ExecutionBarV1, ExecutionBarV1, ExecutionBarV1]);
    if (!opened) {
      noFillSizing++;
      continue;
    }

    const stopExit = stopBeforeTimeExitV1R1(opened.fill, opened.window);
    const exit = stopExit ?? timeExitFillV1R1(opened.fill.side, opened.window);
    const exitReason: EconomicExitReasonV1R1 = stopExit ? 'STOP' : 'TIME_EXIT';
    const exitBar = executionBarsByTime.get(exit.time);
    if (!exitBar) throw new Error(`ECONOMIC_V1R1_EXIT_BAR_NOT_FOUND:${exit.time}`);
    const exitSpreadPrice = quoteBarV1(exitBar).spreadPrice;

    const scenarioEntryPrice = adverseSlippedPriceV1R1(
      opened.fill.side,
      'ENTRY',
      opened.fill.price,
      opened.fill.spreadPrice,
      scenario.slippageMultiplierOfSpreadPerFill,
    );
    const scenarioExitPrice = adverseSlippedPriceV1R1(
      opened.fill.side,
      'EXIT',
      exit.price,
      exitSpreadPrice,
      scenario.slippageMultiplierOfSpreadPerFill,
    );
    const pnlQuote = quotePnlV1(opened.fill.side, scenarioEntryPrice, scenarioExitPrice, opened.fill.volume);
    const initialStopRiskQuote = opened.fill.volume * EXECUTION_V1_CONTRACT_SIZE * opened.fill.stopDistancePrice;
    assertFinitePositive(initialStopRiskQuote, 'ECONOMIC_V1R1_INVALID_INITIAL_STOP_RISK');
    const realizedR = pnlQuote / initialStopRiskQuote;
    if (!Number.isFinite(pnlQuote) || !Number.isFinite(realizedR)) throw new Error('ECONOMIC_V1R1_NONFINITE_TRADE_RESULT');

    const equityBefore = equity;
    equity += pnlQuote;
    const tradeIndex = trades.length + 1;
    trades.push({
      tradeIndex,
      side: opened.fill.side,
      decisionTime: signal.decisionTime,
      calibratedProbability: signal.calibratedProbability,
      volume: opened.fill.volume,
      baseEntryPrice: opened.fill.price,
      scenarioEntryPrice,
      stopPrice: opened.fill.stopPrice,
      stopDistancePrice: opened.fill.stopDistancePrice,
      exitTime: exit.time,
      exitReason,
      baseExitPrice: exit.price,
      scenarioExitPrice,
      entrySpreadPrice: opened.fill.spreadPrice,
      exitSpreadPrice,
      slippageMultiplierOfSpreadPerFill: scenario.slippageMultiplierOfSpreadPerFill,
      pnlQuote,
      initialStopRiskQuote,
      realizedR,
      equityBefore,
      equityAfter: equity,
    });

    openSide = opened.fill.side;
    flatAvailableAt = exitReason === 'STOP'
      ? exit.time + ECONOMIC_LOCKBOX_TIMEFRAME_MS
      : exit.time;
  }

  return {
    summary: summarizeScenarioV1R1(scenario, initialEquity, trades, {
      signalsProcessed,
      tradeIntents,
      noTradePositionOpen,
      noTradeProbabilityExactHalf,
      noFillSessionWindow,
      noFillSizing,
      terminatedForNonpositiveEquity,
    }),
    trades,
  };
}

export function evaluatePrimaryGatesV1R1(
  scenarioResults: readonly EconomicScenarioResultV1R1[],
  config: PrimaryGatesConfigV1R1,
): PrimaryGateResultV1R1 {
  if (!Number.isInteger(config.minimumFilledTrades) || config.minimumFilledTrades <= 0) {
    throw new Error('ECONOMIC_V1R1_INVALID_MINIMUM_FILLED_TRADES');
  }
  const byName = new Map(scenarioResults.map((result) => [result.summary.scenario, result.summary] as const));
  const base = byName.get('BASE');
  const stressHalf = byName.get('STRESS_0_5X');
  if (!base || !stressHalf) throw new Error('ECONOMIC_V1R1_REQUIRED_SCENARIOS_MISSING');

  const minimumFilledTrades = base.filledTrades >= config.minimumFilledTrades;
  const basePositiveFinalEquityDelta = base.finalEquityDelta > 0;
  const baseProfitFactorAboveOne = profitFactorAboveOne(base);
  const basePositiveMeanRealizedR = base.meanRealizedR > 0;
  const stressHalfSpreadPositiveFinalEquityDelta = stressHalf.finalEquityDelta > 0;
  const stressHalfSpreadProfitFactorAboveOne = profitFactorAboveOne(stressHalf);
  const allRequiredGatesPass = minimumFilledTrades
    && basePositiveFinalEquityDelta
    && baseProfitFactorAboveOne
    && basePositiveMeanRealizedR
    && stressHalfSpreadPositiveFinalEquityDelta
    && stressHalfSpreadProfitFactorAboveOne;

  return {
    minimumFilledTrades,
    basePositiveFinalEquityDelta,
    baseProfitFactorAboveOne,
    basePositiveMeanRealizedR,
    stressHalfSpreadPositiveFinalEquityDelta,
    stressHalfSpreadProfitFactorAboveOne,
    allRequiredGatesPass,
  };
}

export function evaluateEconomicLockboxV1R1(
  candles: readonly Candle[],
  model: TrainedLogisticV1,
  calibrator: PlattCalibratorV1,
  lineage: RiskEngineLineageV1,
  firstPotentialDecisionTime: number,
  informationEnd: number,
  initialEquity: number,
  scenarios: readonly EconomicScenarioV1R1[],
  gatesConfig: PrimaryGatesConfigV1R1,
): EconomicLockboxEvaluationV1R1 {
  if (scenarios.length !== 3
    || scenarios[0]?.name !== 'BASE'
    || scenarios[1]?.name !== 'STRESS_0_5X'
    || scenarios[2]?.name !== 'STRESS_1_0X') {
    throw new Error('ECONOMIC_V1R1_SCENARIO_ORDER_MISMATCH');
  }
  const signals = prepareSignalsV1R1(candles, model, calibrator, firstPotentialDecisionTime, informationEnd);
  const scenarioResults = scenarios.map((scenario) => simulateScenarioV1R1(
    candles,
    signals,
    lineage,
    initialEquity,
    scenario,
  ));
  const gates = evaluatePrimaryGatesV1R1(scenarioResults, gatesConfig);
  return {
    version: ECONOMIC_LOCKBOX_RUNNER_V1R1_VERSION,
    scenarioResults,
    gates,
    status: gates.allRequiredGatesPass ? 'ECONOMIC_LOCKBOX_V1R1_PASS' : 'ECONOMIC_LOCKBOX_V1R1_FAIL',
  };
}
