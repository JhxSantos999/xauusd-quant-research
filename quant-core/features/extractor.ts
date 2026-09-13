import { Candle, FEATURE_WARMUP, M5_TIMEFRAME_MS } from '../data/contracts.js';

export const FEATURE_SCHEMA_V1 = [
  'log_close_open',
  'range_over_close',
  'log_return_3',
  'log_return_6',
  'log_return_12',
  'log_return_24',
  'close_over_ema12_minus_1',
  'close_over_ema24_minus_1',
  'zscore_log_return_12',
  'atr_sma12_over_close',
] as const;

export type FeatureVectorV1 = readonly [number, number, number, number, number, number, number, number, number, number];

export interface FeatureRowV1 {
  readonly barIndex: number;
  readonly decisionBarOpenTime: number;
  readonly decisionTime: number;
  readonly vector: FeatureVectorV1;
}

function assertPositive(value: number, name: string, index: number): void {
  if (!(value > 0) || !Number.isFinite(value)) throw new Error(`INVALID_${name}_AT_${index}`);
}

function emaSeries(candles: readonly Candle[], period: number): number[] {
  const alpha = 2 / (period + 1);
  const ema = new Array<number>(candles.length);
  ema[0] = candles[0]!.close;
  for (let i = 1; i < candles.length; i++) ema[i] = alpha * candles[i]!.close + (1 - alpha) * ema[i - 1]!;
  return ema;
}

function trueRange(candles: readonly Candle[], index: number): number {
  const current = candles[index]!;
  if (index === 0) return current.high - current.low;
  const prevClose = candles[index - 1]!.close;
  return Math.max(
    current.high - current.low,
    Math.abs(current.high - prevClose),
    Math.abs(current.low - prevClose),
  );
}

function sampleStd(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let ss = 0;
  for (const value of values) ss += (value - mean) ** 2;
  return Math.sqrt(ss / (values.length - 1));
}

export function extractFeatureRowsV1(
  candles: readonly Candle[],
  timeframeMs = M5_TIMEFRAME_MS,
): FeatureRowV1[] {
  if (candles.length <= FEATURE_WARMUP) return [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    assertPositive(c.open, 'OPEN', i);
    assertPositive(c.close, 'CLOSE', i);
  }

  const ema12 = emaSeries(candles, 12);
  const ema24 = emaSeries(candles, 24);
  const logReturns = new Array<number>(candles.length).fill(Number.NaN);
  const tr = new Array<number>(candles.length);
  for (let i = 0; i < candles.length; i++) {
    tr[i] = trueRange(candles, i);
    if (i > 0) logReturns[i] = Math.log(candles[i]!.close / candles[i - 1]!.close);
  }

  const rows: FeatureRowV1[] = [];
  for (let i = FEATURE_WARMUP; i < candles.length; i++) {
    const c = candles[i]!;
    const retWindow = logReturns.slice(i - 11, i + 1);
    const retMean = retWindow.reduce((sum, value) => sum + value, 0) / retWindow.length;
    const sigma = sampleStd(retWindow);
    const z = sigma === 0 ? 0 : (logReturns[i]! - retMean) / sigma;
    const atr12 = tr.slice(i - 11, i + 1).reduce((sum, value) => sum + value, 0) / 12;

    const vector: FeatureVectorV1 = [
      Math.log(c.close / c.open),
      (c.high - c.low) / c.close,
      Math.log(c.close / candles[i - 3]!.close),
      Math.log(c.close / candles[i - 6]!.close),
      Math.log(c.close / candles[i - 12]!.close),
      Math.log(c.close / candles[i - 24]!.close),
      c.close / ema12[i]! - 1,
      c.close / ema24[i]! - 1,
      z,
      atr12 / c.close,
    ];

    if (!vector.every(Number.isFinite)) throw new Error(`NONFINITE_FEATURE_AT_${i}`);
    rows.push({ barIndex: i, decisionBarOpenTime: c.time, decisionTime: c.time + timeframeMs, vector });
  }
  return rows;
}
