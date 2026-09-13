import { Candle, M5_TIMEFRAME_MS } from '../data/contracts.js';

export type LabelStatus = 'VALID' | 'NEUTRAL' | 'INVALID_GAP';

export interface LabeledSampleV1 {
  readonly candidateIndex: number;
  readonly timestamp: number;
  readonly decisionTime: number;
  readonly decisionBarOpenTime: number;
  readonly labelStart: number;
  readonly targetBarOpenTime: number;
  readonly labelEnd: number;
  readonly futureReturn: number;
  readonly status: LabelStatus;
  readonly label?: 0 | 1;
}

export interface LabelCoverageV1 {
  readonly totalCandidates: number;
  readonly valid: number;
  readonly neutral: number;
  readonly invalidGap: number;
  readonly class0: number;
  readonly class1: number;
  readonly validRate: number;
  readonly neutralRate: number;
  readonly invalidGapRate: number;
}

export function generateLabelsV1(
  candles: readonly Candle[],
  h: number,
  tau: number,
  timeframeMs = M5_TIMEFRAME_MS,
): LabeledSampleV1[] {
  if (!Number.isInteger(h) || h <= 0) throw new Error('INVALID_HORIZON');
  if (!Number.isFinite(tau) || tau < 0) throw new Error('INVALID_TAU');
  if (candles.length <= h) return [];

  const samples: LabeledSampleV1[] = [];
  for (let i = 0; i < candles.length - h; i++) {
    const decisionBar = candles[i]!;
    const targetBar = candles[i + h]!;
    const decisionTime = decisionBar.time + timeframeMs;
    const labelEnd = targetBar.time + timeframeMs;
    const futureReturn = targetBar.close / decisionBar.close - 1;

    let hasGap = false;
    for (let j = i + 1; j <= i + h; j++) {
      if (candles[j]!.time - candles[j - 1]!.time > timeframeMs) {
        hasGap = true;
        break;
      }
    }

    const base = {
      candidateIndex: i,
      timestamp: decisionTime,
      decisionTime,
      decisionBarOpenTime: decisionBar.time,
      labelStart: decisionTime,
      targetBarOpenTime: targetBar.time,
      labelEnd,
      futureReturn,
    } as const;

    if (hasGap) {
      samples.push({ ...base, status: 'INVALID_GAP' });
      continue;
    }

    if (tau === 0) {
      if (futureReturn > 0) samples.push({ ...base, status: 'VALID', label: 1 });
      else if (futureReturn < 0) samples.push({ ...base, status: 'VALID', label: 0 });
      else samples.push({ ...base, status: 'NEUTRAL' });
      continue;
    }

    if (futureReturn > tau) samples.push({ ...base, status: 'VALID', label: 1 });
    else if (futureReturn < -tau) samples.push({ ...base, status: 'VALID', label: 0 });
    else samples.push({ ...base, status: 'NEUTRAL' });
  }
  return samples;
}

export function summarizeLabelCoverageV1(samples: readonly LabeledSampleV1[]): LabelCoverageV1 {
  let valid = 0;
  let neutral = 0;
  let invalidGap = 0;
  let class0 = 0;
  let class1 = 0;
  for (const sample of samples) {
    if (sample.status === 'VALID') {
      valid++;
      if (sample.label === 0) class0++;
      else if (sample.label === 1) class1++;
      else throw new Error('VALID_LABEL_MISSING_CLASS');
    } else if (sample.status === 'NEUTRAL') neutral++;
    else invalidGap++;
  }
  const totalCandidates = samples.length;
  const denom = totalCandidates || 1;
  return {
    totalCandidates,
    valid,
    neutral,
    invalidGap,
    class0,
    class1,
    validRate: valid / denom,
    neutralRate: neutral / denom,
    invalidGapRate: invalidGap / denom,
  };
}
