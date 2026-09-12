import { fitPenalizedLogisticV1, stableSigmoidV1 } from '../math/penalized-logistic.js';

export const LOGREG_V1_VERSION = 'logreg_v1' as const;
export const LOGREG_V1_FEATURE_COUNT = 10;
export const LOGREG_V1_L2 = 1e-8;
export const LOGREG_V1_MAX_ITERATIONS = 100;
export const LOGREG_V1_GRADIENT_TOLERANCE = 1e-10;
export const LOGREG_V1_HESSIAN_JITTER = 1e-12;
export const LOGREG_V1_NEWTON_DECREMENT_TOLERANCE = 1e-12;
export const LOGREG_V1_ARMIJO = 1e-4;
export const LOGREG_V1_MIN_STEP = 2 ** -20;

export interface TrainedLogisticV1 {
  readonly version: typeof LOGREG_V1_VERSION;
  readonly featureCount: typeof LOGREG_V1_FEATURE_COUNT;
  readonly weights: readonly number[];
  readonly intercept: number;
  readonly iterations: number;
  readonly objective: number;
}

function validateBinaryBiclass(y: readonly number[]): void {
  if (y.length === 0) throw new Error('EMPTY_TRAIN_LABELS');
  let c0 = 0;
  let c1 = 0;
  for (let i = 0; i < y.length; i++) {
    if (y[i] === 0) c0++;
    else if (y[i] === 1) c1++;
    else throw new Error(`INVALID_BINARY_LABEL_AT_${i}`);
  }
  if (c0 === 0 || c1 === 0) throw new Error('SINGLE_CLASS_TRAIN');
}

export function fitLogisticV1(X: readonly (readonly number[])[], y: readonly number[]): TrainedLogisticV1 {
  validateBinaryBiclass(y);
  for (let i = 0; i < X.length; i++) if (X[i]!.length !== LOGREG_V1_FEATURE_COUNT) throw new Error(`LOGREG_FEATURE_WIDTH_MISMATCH_AT_${i}`);
  const fit = fitPenalizedLogisticV1(X, y, {
    l2: LOGREG_V1_L2,
    maxIterations: LOGREG_V1_MAX_ITERATIONS,
    gradientTolerance: LOGREG_V1_GRADIENT_TOLERANCE,
    hessianDiagonalJitter: LOGREG_V1_HESSIAN_JITTER,
    newtonDecrementTolerance: LOGREG_V1_NEWTON_DECREMENT_TOLERANCE,
    armijo: LOGREG_V1_ARMIJO,
    minStep: LOGREG_V1_MIN_STEP,
  });
  return { version: LOGREG_V1_VERSION, featureCount: LOGREG_V1_FEATURE_COUNT, weights: fit.weights, intercept: fit.intercept, iterations: fit.iterations, objective: fit.objective };
}

export function predictLogisticV1(model: TrainedLogisticV1, X: readonly (readonly number[])[]): number[] {
  if (model.version !== LOGREG_V1_VERSION || model.weights.length !== LOGREG_V1_FEATURE_COUNT) throw new Error('INVALID_LOGREG_MODEL');
  return X.map((row, i) => {
    if (row.length !== LOGREG_V1_FEATURE_COUNT) throw new Error(`LOGREG_FEATURE_WIDTH_MISMATCH_AT_${i}`);
    if (!row.every(Number.isFinite)) throw new Error(`NONFINITE_FEATURE_AT_${i}`);
    let z = model.intercept;
    for (let j = 0; j < LOGREG_V1_FEATURE_COUNT; j++) z += model.weights[j]! * row[j]!;
    return stableSigmoidV1(z);
  });
}
