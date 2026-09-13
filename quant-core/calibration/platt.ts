import { fitPenalizedLogisticV1, stableSigmoidV1 } from '../math/penalized-logistic.js';

export const PLATT_V1_VERSION = 'platt_v1' as const;
export const PLATT_V1_INPUT_CLIP = 1e-15;
export const PLATT_V1_L2 = 1e-8;
export const PLATT_V1_MAX_ITERATIONS = 100;
export const PLATT_V1_GRADIENT_TOLERANCE = 1e-10;
export const PLATT_V1_HESSIAN_JITTER = 1e-12;
export const PLATT_V1_NEWTON_DECREMENT_TOLERANCE = 1e-12;
export const PLATT_V1_ARMIJO = 1e-4;
export const PLATT_V1_MIN_STEP = 2 ** -20;

export interface PlattCalibratorV1 {
  readonly version: typeof PLATT_V1_VERSION;
  readonly slope: number;
  readonly intercept: number;
  readonly iterations: number;
  readonly objective: number;
  readonly positiveTarget: number;
  readonly negativeTarget: number;
}

function clippedLogit(probability: number): number {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('INVALID_RAW_PROBABILITY');
  const p = Math.max(PLATT_V1_INPUT_CLIP, Math.min(1 - PLATT_V1_INPUT_CLIP, probability));
  return Math.log(p / (1 - p));
}

export function fitPlattV1(rawProbabilities: readonly number[], labels: readonly number[]): PlattCalibratorV1 {
  if (rawProbabilities.length === 0 || rawProbabilities.length !== labels.length) throw new Error('INVALID_CALIBRATION_LENGTH');
  let positives = 0;
  let negatives = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === 1) positives++;
    else if (labels[i] === 0) negatives++;
    else throw new Error(`INVALID_BINARY_LABEL_AT_${i}`);
  }
  if (positives === 0 || negatives === 0) throw new Error('SINGLE_CLASS_CALIBRATION');
  const positiveTarget = (positives + 1) / (positives + 2);
  const negativeTarget = 1 / (negatives + 2);
  const X = rawProbabilities.map((probability) => [clippedLogit(probability)] as const);
  const smoothedTargets = labels.map((label) => label === 1 ? positiveTarget : negativeTarget);
  const fit = fitPenalizedLogisticV1(X, smoothedTargets, {
    l2: PLATT_V1_L2,
    maxIterations: PLATT_V1_MAX_ITERATIONS,
    gradientTolerance: PLATT_V1_GRADIENT_TOLERANCE,
    hessianDiagonalJitter: PLATT_V1_HESSIAN_JITTER,
    newtonDecrementTolerance: PLATT_V1_NEWTON_DECREMENT_TOLERANCE,
    armijo: PLATT_V1_ARMIJO,
    minStep: PLATT_V1_MIN_STEP,
  });
  return { version: PLATT_V1_VERSION, slope: fit.weights[0]!, intercept: fit.intercept, iterations: fit.iterations, objective: fit.objective, positiveTarget, negativeTarget };
}

export function calibrateV1(calibrator: PlattCalibratorV1, rawProbabilities: readonly number[]): number[] {
  if (calibrator.version !== PLATT_V1_VERSION || !Number.isFinite(calibrator.slope) || !Number.isFinite(calibrator.intercept)) throw new Error('INVALID_PLATT_CALIBRATOR');
  return rawProbabilities.map((probability) => stableSigmoidV1(calibrator.slope * clippedLogit(probability) + calibrator.intercept));
}
