export interface ProbabilityMetricsV1 {
  readonly brier: number;
  readonly logLoss: number;
  readonly ece: number;
  readonly auc: number | null;
}

export const LOG_LOSS_EPSILON_V1 = 1e-15;
export const ECE_BINS_V1 = 10;

function validateInputs(yTrue: readonly number[], yProb: readonly number[]): void {
  if (yTrue.length === 0 || yTrue.length !== yProb.length) throw new Error('INVALID_METRIC_INPUT_LENGTH');
  for (let i = 0; i < yTrue.length; i++) {
    if (yTrue[i] !== 0 && yTrue[i] !== 1) throw new Error(`INVALID_BINARY_LABEL_AT_${i}`);
    const p = yProb[i]!;
    if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error(`INVALID_PROBABILITY_AT_${i}`);
  }
}

export function aucRocV1(yTrue: readonly number[], yProb: readonly number[]): number | null {
  validateInputs(yTrue, yProb);
  let positives = 0;
  for (const y of yTrue) if (y === 1) positives++;
  const negatives = yTrue.length - positives;
  if (positives === 0 || negatives === 0) return null;

  const pairs = yProb.map((probability, index) => ({ probability, label: yTrue[index]! }));
  pairs.sort((a, b) => a.probability - b.probability);
  let positiveRankSum = 0;
  let i = 0;
  while (i < pairs.length) {
    let j = i + 1;
    while (j < pairs.length && pairs[j]!.probability === pairs[i]!.probability) j++;
    const averageRank = ((i + 1) + j) / 2;
    for (let k = i; k < j; k++) if (pairs[k]!.label === 1) positiveRankSum += averageRank;
    i = j;
  }
  const u = positiveRankSum - (positives * (positives + 1)) / 2;
  return u / (positives * negatives);
}

export function eceEqualWidthV1(
  yTrue: readonly number[],
  yProb: readonly number[],
  bins = ECE_BINS_V1,
): number {
  validateInputs(yTrue, yProb);
  if (!Number.isInteger(bins) || bins <= 0) throw new Error('INVALID_ECE_BINS');
  let ece = 0;
  for (let bin = 0; bin < bins; bin++) {
    const lower = bin / bins;
    const upper = (bin + 1) / bins;
    let count = 0;
    let probSum = 0;
    let labelSum = 0;
    for (let i = 0; i < yTrue.length; i++) {
      const p = yProb[i]!;
      const inBin = bin === bins - 1 ? p >= lower && p <= upper : p >= lower && p < upper;
      if (!inBin) continue;
      count++;
      probSum += p;
      labelSum += yTrue[i]!;
    }
    if (count === 0) continue;
    ece += (count / yTrue.length) * Math.abs(labelSum / count - probSum / count);
  }
  return ece;
}

export function calculateProbabilityMetricsV1(
  yTrue: readonly number[],
  yProb: readonly number[],
): ProbabilityMetricsV1 {
  validateInputs(yTrue, yProb);
  let brier = 0;
  let logLoss = 0;
  for (let i = 0; i < yTrue.length; i++) {
    const y = yTrue[i]!;
    const rawP = yProb[i]!;
    const p = Math.max(LOG_LOSS_EPSILON_V1, Math.min(1 - LOG_LOSS_EPSILON_V1, rawP));
    brier += (rawP - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  return {
    brier: brier / yTrue.length,
    logLoss: logLoss / yTrue.length,
    ece: eceEqualWidthV1(yTrue, yProb),
    auc: aucRocV1(yTrue, yProb),
  };
}
