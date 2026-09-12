export const M5_TIMEFRAME_MS = 300_000;
export const FEATURE_WARMUP = 24;

export interface Candle {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly tickVolume?: number;
  readonly volume?: number;
  readonly spread?: number;
}

export interface ResearchDatasetContract {
  readonly datasetId: string;
  readonly datasetSha256: string;
  readonly timeframeMs: number;
  readonly maxCandleOpenTime: number;
  readonly maxInformationTime: number;
}

export interface CandleAudit {
  readonly candles: number;
  readonly firstBarOpenTime: number;
  readonly lastBarOpenTime: number;
  readonly duplicateTimestamps: number;
  readonly nonIncreasingTimestamps: number;
  readonly invalidGeometry: number;
  readonly nonFiniteValues: number;
}

export function auditCandles(candles: readonly Candle[]): CandleAudit {
  if (candles.length === 0) throw new Error('EMPTY_DATASET');

  let duplicateTimestamps = 0;
  let nonIncreasingTimestamps = 0;
  let invalidGeometry = 0;
  let nonFiniteValues = 0;
  const seen = new Set<number>();

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)) nonFiniteValues++;
    if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close) || c.high < c.low) invalidGeometry++;
    if (seen.has(c.time)) duplicateTimestamps++;
    seen.add(c.time);
    if (i > 0 && c.time <= candles[i - 1]!.time) nonIncreasingTimestamps++;
  }

  return {
    candles: candles.length,
    firstBarOpenTime: candles[0]!.time,
    lastBarOpenTime: candles[candles.length - 1]!.time,
    duplicateTimestamps,
    nonIncreasingTimestamps,
    invalidGeometry,
    nonFiniteValues,
  };
}

export function enforceDatasetContract(
  candles: readonly Candle[],
  contract: ResearchDatasetContract,
): void {
  if (!Number.isFinite(contract.timeframeMs) || contract.timeframeMs <= 0) throw new Error('INVALID_TIMEFRAME_MS');
  if (!Number.isFinite(contract.maxCandleOpenTime) || !Number.isFinite(contract.maxInformationTime)) throw new Error('INVALID_DATASET_BOUNDARY');
  const audit = auditCandles(candles);
  if (audit.duplicateTimestamps !== 0 || audit.nonIncreasingTimestamps !== 0) {
    throw new Error('INVALID_TIMESTAMP_ORDER');
  }
  if (audit.invalidGeometry !== 0 || audit.nonFiniteValues !== 0) {
    throw new Error('INVALID_CANDLE_DATA');
  }
  for (const candle of candles) {
    if (candle.time > contract.maxCandleOpenTime) throw new Error('LOCKBOX_BOUNDARY_VIOLATION');
    if (candle.time + contract.timeframeMs > contract.maxInformationTime) throw new Error('INFORMATION_BOUNDARY_VIOLATION');
  }
}
