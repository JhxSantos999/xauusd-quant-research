import type { Candle } from '../data/contracts.js';
import {
  openExecutionV1R2,
  stopBeforeTimeExitV1R2,
  timeExitFillV1R2,
} from '../execution/execution-engine-v1r2.js';
import {
  EXECUTION_V1_CONTRACT_SIZE,
  quoteBarV1,
  quotePnlV1,
  type ExecutionBarV1,
} from '../execution/execution-engine.js';
import {
  evaluateRiskV1,
  type PositionStateV1,
  type RiskEngineLineageV1,
  type RiskSideV1,
} from '../risk/risk-engine.js';
import type { PlattCalibratorV1 } from '../calibration/platt.js';
import type { TrainedLogisticV1 } from '../models/logistic.js';
import {
  adverseSlippedPriceV1R1,
  evaluatePrimaryGatesV1R1,
  prepareSignalsV1R1,
  type EconomicScenarioV1R1,
  type EconomicScenarioSummaryV1R1,
  type EconomicTradeV1R1,
  type PreparedSignalV1R1,
  type PrimaryGateResultV1R1,
  type PrimaryGatesConfigV1R1,
} from './economic-lockbox-evaluator-v1r1.js';

export const ECONOMIC_LOCKBOX_RUNNER_V1R2_VERSION = 'economic_lockbox_runner_v1r2' as const;
export const ECONOMIC_LOCKBOX_V1R2_TIMEFRAME_MS = 300_000;

export type EconomicScenarioV1R2 = EconomicScenarioV1R1;
export type PreparedSignalV1R2 = PreparedSignalV1R1;
export type EconomicTradeV1R2 = EconomicTradeV1R1;
export type PrimaryGateResultV1R2 = PrimaryGateResultV1R1;
export type PrimaryGatesConfigV1R2 = PrimaryGatesConfigV1R1;

export interface EconomicScenarioSummaryV1R2 extends EconomicScenarioSummaryV1R1 {
  readonly noFillBrokerStopConstraint: number;
}

export interface EconomicScenarioResultV1R2 {
  readonly summary: EconomicScenarioSummaryV1R2;
  readonly trades: readonly EconomicTradeV1R2[];
}

export interface EconomicLockboxEvaluationV1R2 {
  readonly version: typeof ECONOMIC_LOCKBOX_RUNNER_V1R2_VERSION;
  readonly scenarioResults: readonly EconomicScenarioResultV1R2[];
  readonly gates: PrimaryGateResultV1R2;
  readonly status: 'ECONOMIC_LOCKBOX_V1R2_PASS' | 'ECONOMIC_LOCKBOX_V1R2_FAIL';
}

function assertFiniteNonnegative(value: number, code: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(code);
}

function assertFinitePositive(value: number, code: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(code);
}

function toExecutionBarV1R2(candle: Candle): ExecutionBarV1 {
  if (candle.spread === undefined) throw new Error(`ECONOMIC_V1R2_MISSING_SPREAD:${candle.time}`);
  if (!Number.isFinite(candle.spread) || candle.spread < 0) throw new Error(`ECONOMIC_V1R2_INVALID_SPREAD:${candle.time}`);
  return {
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    spreadPoints: candle.spread,
  };
}

function summarizeScenarioV1R2(
  scenario: EconomicScenarioV1R2,
  initialEquity: number,
  trades: readonly EconomicTradeV1R2[],
  counters: {
    readonly signalsProcessed: number;
    readonly tradeIntents: number;
    readonly noTradePositionOpen: number;
    readonly noTradeProbabilityExactHalf: number;
    readonly noFillSessionWindow: number;
    readonly noFillBrokerStopConstraint: number;
    readonly noFillSizing: number;
    readonly terminatedForNonpositiveEquity: boolean;
  },
): EconomicScenarioSummaryV1R2 {
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
    noFillBrokerStopConstraint: counters.noFillBrokerStopConstraint,
    noFillSizing: counters.noFillSizing,
    terminatedForNonpositiveEquity: counters.terminatedForNonpositiveEquity,
  };
}

export function simulateScenarioV1R2(
  candles: readonly Candle[],
  signals: readonly PreparedSignalV1R2[],
  lineage: RiskEngineLineageV1,
  initialEquity: number,
  scenario: EconomicScenarioV1R2,
): EconomicScenarioResultV1R2 {
  assertFinitePositive(initialEquity, 'ECONOMIC_V1R2_INVALID_INITIAL_EQUITY');
  assertFiniteNonnegative(
    scenario.slippageMultiplierOfSpreadPerFill,
    'ECONOMIC_V1R2_INVALID_SCENARIO_SLIPPAGE',
  );

  const executionBarsByTime = new Map<number, ExecutionBarV1>();
  for (const candle of candles) {
    if (executionBarsByTime.has(candle.time)) throw new Error(`ECONOMIC_V1R2_DUPLICATE_BAR_TIME:${candle.time}`);
    executionBarsByTime.set(candle.time, toExecutionBarV1R2(candle));
  }

  const trades: EconomicTradeV1R2[] = [];
  let equity = initialEquity;
  let flatAvailableAt = Number.NEGATIVE_INFINITY;
  let openSide: RiskSideV1 = 'LONG';
  let tradeIntents = 0;
  let noTradePositionOpen = 0;
  let noTradeProbabilityExactHalf = 0;
  let noFillSessionWindow = 0;
  let noFillBrokerStopConstraint = 0;
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
    const windowBars = requiredTimes
      .map((time) => executionBarsByTime.get(time))
      .filter((bar): bar is ExecutionBarV1 => bar !== undefined);

    const opened = openExecutionV1R2(risk, windowBars);
    if (opened.status === 'NO_FILL') {
      if (opened.reason === 'NO_FILL_SESSION_WINDOW') noFillSessionWindow++;
      else if (opened.reason === 'NO_FILL_BROKER_STOP_CONSTRAINT') noFillBrokerStopConstraint++;
      else noFillSizing++;
      continue;
    }

    if (Math.abs(opened.fill.stopDistancePrice - risk.stopDistancePrice) > 1e-12) {
      throw new Error('ECONOMIC_V1R2_EXECUTION_MUTATED_RISK_STOP');
    }
    const postFillStopRiskQuote = opened.fill.volume * EXECUTION_V1_CONTRACT_SIZE * opened.fill.stopDistancePrice;
    if (postFillStopRiskQuote > risk.maxQuoteRisk + 1e-9) {
      throw new Error('ECONOMIC_V1R2_POST_FILL_RISK_BUDGET_VIOLATION');
    }

    const stopExit = stopBeforeTimeExitV1R2(opened.fill, opened.window);
    const exit = stopExit ?? timeExitFillV1R2(opened.fill.side, opened.window);
    const exitReason = stopExit ? 'STOP' as const : 'TIME_EXIT' as const;
    const exitBar = executionBarsByTime.get(exit.time);
    if (!exitBar) throw new Error(`ECONOMIC_V1R2_EXIT_BAR_NOT_FOUND:${exit.time}`);
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
    assertFinitePositive(initialStopRiskQuote, 'ECONOMIC_V1R2_INVALID_INITIAL_STOP_RISK');
    const realizedR = pnlQuote / initialStopRiskQuote;
    if (!Number.isFinite(pnlQuote) || !Number.isFinite(realizedR)) {
      throw new Error('ECONOMIC_V1R2_NONFINITE_TRADE_RESULT');
    }

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
      ? exit.time + ECONOMIC_LOCKBOX_V1R2_TIMEFRAME_MS
      : exit.time;
  }

  return {
    summary: summarizeScenarioV1R2(scenario, initialEquity, trades, {
      signalsProcessed,
      tradeIntents,
      noTradePositionOpen,
      noTradeProbabilityExactHalf,
      noFillSessionWindow,
      noFillBrokerStopConstraint,
      noFillSizing,
      terminatedForNonpositiveEquity,
    }),
    trades,
  };
}

export function evaluateEconomicLockboxV1R2(
  candles: readonly Candle[],
  model: TrainedLogisticV1,
  calibrator: PlattCalibratorV1,
  lineage: RiskEngineLineageV1,
  firstPotentialDecisionTime: number,
  informationEnd: number,
  initialEquity: number,
  scenarios: readonly EconomicScenarioV1R2[],
  gatesConfig: PrimaryGatesConfigV1R2,
): EconomicLockboxEvaluationV1R2 {
  if (scenarios.length !== 3
    || scenarios[0]?.name !== 'BASE'
    || scenarios[1]?.name !== 'STRESS_0_5X'
    || scenarios[2]?.name !== 'STRESS_1_0X') {
    throw new Error('ECONOMIC_V1R2_SCENARIO_ORDER_MISMATCH');
  }

  const signals = prepareSignalsV1R1(
    candles,
    model,
    calibrator,
    firstPotentialDecisionTime,
    informationEnd,
  );
  const scenarioResults = scenarios.map((scenario) => simulateScenarioV1R2(
    candles,
    signals,
    lineage,
    initialEquity,
    scenario,
  ));
  const gates = evaluatePrimaryGatesV1R1(scenarioResults, gatesConfig);

  return {
    version: ECONOMIC_LOCKBOX_RUNNER_V1R2_VERSION,
    scenarioResults,
    gates,
    status: gates.allRequiredGatesPass ? 'ECONOMIC_LOCKBOX_V1R2_PASS' : 'ECONOMIC_LOCKBOX_V1R2_FAIL',
  };
}
