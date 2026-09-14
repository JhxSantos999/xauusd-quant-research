import type { RiskTradeIntentV1, RiskSideV1 } from '../risk/risk-engine.js';
import type { ExecutionBarV1, ExecutionFillV1 } from './execution-engine.js';
import { openExecutionV1, stopFillPriceV1, timeExitFillPriceV1 } from './execution-engine.js';

export const EXECUTION_ENGINE_V1R1_VERSION = 'execution_engine_v1r1' as const;
export const EXECUTION_V1R1_TIMEFRAME_MS = 300_000;
export const EXECUTION_V1R1_HOLD_BARS = 3;
export const EXECUTION_V1R1_REQUIRED_OPEN_OFFSETS_MS = [0, 300_000, 600_000, 900_000] as const;
export const EXECUTION_V1R1_SESSION_REJECTION = 'NO_FILL_SESSION_WINDOW' as const;

export interface ExecutionWindowV1R1 {
  readonly entryBar: ExecutionBarV1;
  readonly holdingBars: readonly [ExecutionBarV1, ExecutionBarV1, ExecutionBarV1];
  readonly exitBar: ExecutionBarV1;
}

export interface OpenExecutionWindowV1R1 {
  readonly fill: ExecutionFillV1;
  readonly window: ExecutionWindowV1R1;
}

function indexUniqueBarsByTimeV1R1(bars: readonly ExecutionBarV1[]): Map<number, ExecutionBarV1> {
  const byTime = new Map<number, ExecutionBarV1>();
  for (const bar of bars) {
    if (!Number.isFinite(bar.time)) throw new Error('EXECUTION_V1R1_INVALID_BAR_TIME');
    if (byTime.has(bar.time)) throw new Error(`EXECUTION_V1R1_DUPLICATE_BAR_TIME:${bar.time}`);
    byTime.set(bar.time, bar);
  }
  return byTime;
}

export function buildExecutionWindowV1R1(
  decisionTime: number,
  bars: readonly ExecutionBarV1[],
): ExecutionWindowV1R1 | null {
  if (!Number.isFinite(decisionTime)) throw new Error('EXECUTION_V1R1_INVALID_DECISION_TIME');
  const byTime = indexUniqueBarsByTimeV1R1(bars);
  const required = EXECUTION_V1R1_REQUIRED_OPEN_OFFSETS_MS.map((offset) => byTime.get(decisionTime + offset));
  if (required.some((bar) => bar === undefined)) return null;
  const [entryBar, secondBar, thirdBar, exitBar] = required as [
    ExecutionBarV1,
    ExecutionBarV1,
    ExecutionBarV1,
    ExecutionBarV1,
  ];
  return {
    entryBar,
    holdingBars: [entryBar, secondBar, thirdBar],
    exitBar,
  };
}

export function openExecutionV1R1(
  intent: RiskTradeIntentV1,
  bars: readonly ExecutionBarV1[],
): OpenExecutionWindowV1R1 | null {
  if (intent.timeExitBars !== EXECUTION_V1R1_HOLD_BARS) throw new Error('EXECUTION_V1R1_TIME_EXIT_BARS_MISMATCH');
  const expectedExit = intent.decisionTime + EXECUTION_V1R1_HOLD_BARS * EXECUTION_V1R1_TIMEFRAME_MS;
  if (intent.timeExitTime !== expectedExit) throw new Error('EXECUTION_V1R1_TIME_EXIT_TIME_MISMATCH');
  const window = buildExecutionWindowV1R1(intent.decisionTime, bars);
  if (!window) return null;
  const fill = openExecutionV1(intent, window.entryBar);
  if (!fill) return null;
  return { fill, window };
}

export function stopBeforeTimeExitV1R1(
  fill: ExecutionFillV1,
  window: ExecutionWindowV1R1,
): { readonly time: number; readonly price: number } | null {
  for (const bar of window.holdingBars) {
    const price = stopFillPriceV1(fill, bar);
    if (price !== null) return { time: bar.time, price };
  }
  return null;
}

export function timeExitFillV1R1(
  side: RiskSideV1,
  window: ExecutionWindowV1R1,
): { readonly time: number; readonly price: number } {
  return {
    time: window.exitBar.time,
    price: timeExitFillPriceV1(side, window.exitBar),
  };
}
