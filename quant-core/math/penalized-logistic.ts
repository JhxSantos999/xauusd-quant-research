export interface PenalizedLogisticFitOptionsV1 {
  readonly l2: number;
  readonly maxIterations: number;
  readonly gradientTolerance: number;
  readonly hessianDiagonalJitter: number;
  readonly newtonDecrementTolerance: number;
  readonly armijo: number;
  readonly minStep: number;
}

export interface PenalizedLogisticFitResultV1 {
  readonly weights: readonly number[];
  readonly intercept: number;
  readonly iterations: number;
  readonly converged: boolean;
  readonly objective: number;
}

export function stableSigmoidV1(z: number): number {
  if (!Number.isFinite(z)) throw new Error('NONFINITE_LOGIT');
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

function validateFitInput(X: readonly (readonly number[])[], y: readonly number[]): number {
  if (X.length === 0 || X.length !== y.length) throw new Error('INVALID_FIT_LENGTH');
  const width = X[0]?.length ?? 0;
  if (width === 0) throw new Error('EMPTY_FEATURE_VECTOR');
  for (let i = 0; i < X.length; i++) {
    const row = X[i]!;
    if (row.length !== width) throw new Error(`FEATURE_WIDTH_MISMATCH_AT_${i}`);
    if (!row.every(Number.isFinite)) throw new Error(`NONFINITE_FEATURE_AT_${i}`);
    const target = y[i]!;
    if (!Number.isFinite(target) || target < 0 || target > 1) throw new Error(`INVALID_TARGET_AT_${i}`);
  }
  return width;
}

function objective(
  X: readonly (readonly number[])[],
  y: readonly number[],
  weights: readonly number[],
  intercept: number,
  l2: number,
): number {
  let loss = 0;
  for (let i = 0; i < X.length; i++) {
    const row = X[i]!;
    let z = intercept;
    for (let j = 0; j < weights.length; j++) z += weights[j]! * row[j]!;
    const target = y[i]!;
    loss += Math.max(z, 0) - target * z + Math.log1p(Math.exp(-Math.abs(z)));
  }
  loss /= X.length;
  let penalty = 0;
  for (const weight of weights) penalty += weight * weight;
  return loss + 0.5 * l2 * penalty;
}

function solveLinearSystem(matrix: readonly (readonly number[])[], rhs: readonly number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotAbs = Math.abs(a[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const value = Math.abs(a[row]![col]!);
      if (value > pivotAbs) { pivotAbs = value; pivotRow = row; }
    }
    if (!Number.isFinite(pivotAbs) || pivotAbs < 1e-18) throw new Error('SINGULAR_NEWTON_SYSTEM');
    if (pivotRow !== col) [a[col], a[pivotRow]] = [a[pivotRow]!, a[col]!];
    const pivot = a[col]![col]!;
    for (let j = col; j <= n; j++) a[col]![j] = a[col]![j]! / pivot;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row]![col]!;
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) a[row]![j] = a[row]![j]! - factor * a[col]![j]!;
    }
  }
  return a.map((row) => row[n]!);
}

export function fitPenalizedLogisticV1(
  X: readonly (readonly number[])[],
  y: readonly number[],
  options: PenalizedLogisticFitOptionsV1,
): PenalizedLogisticFitResultV1 {
  const width = validateFitInput(X, y);
  if (!(options.l2 > 0) || !Number.isFinite(options.l2)) throw new Error('INVALID_L2');
  if (!Number.isInteger(options.maxIterations) || options.maxIterations <= 0) throw new Error('INVALID_MAX_ITERATIONS');
  if (!(options.gradientTolerance > 0) || !Number.isFinite(options.gradientTolerance)) throw new Error('INVALID_GRADIENT_TOLERANCE');
  if (!(options.hessianDiagonalJitter > 0) || !Number.isFinite(options.hessianDiagonalJitter)) throw new Error('INVALID_HESSIAN_JITTER');
  if (!(options.newtonDecrementTolerance > 0) || !Number.isFinite(options.newtonDecrementTolerance)) throw new Error('INVALID_NEWTON_DECREMENT_TOLERANCE');
  if (!(options.armijo > 0 && options.armijo < 1)) throw new Error('INVALID_ARMIJO');
  if (!(options.minStep > 0 && options.minStep < 1)) throw new Error('INVALID_MIN_STEP');

  let weights = new Array<number>(width).fill(0);
  let intercept = 0;
  let currentObjective = objective(X, y, weights, intercept, options.l2);

  for (let iteration = 0; iteration < options.maxIterations; iteration++) {
    const dimension = width + 1;
    const gradient = new Array<number>(dimension).fill(0);
    const hessian = Array.from({ length: dimension }, () => new Array<number>(dimension).fill(0));

    for (let i = 0; i < X.length; i++) {
      const row = X[i]!;
      let z = intercept;
      for (let j = 0; j < width; j++) z += weights[j]! * row[j]!;
      const p = stableSigmoidV1(z);
      const residual = p - y[i]!;
      const variance = p * (1 - p);
      gradient[0] = gradient[0]! + residual;
      hessian[0]![0] = hessian[0]![0]! + variance;
      for (let j = 0; j < width; j++) {
        const xj = row[j]!;
        gradient[j + 1] = gradient[j + 1]! + residual * xj;
        hessian[0]![j + 1] = hessian[0]![j + 1]! + variance * xj;
        hessian[j + 1]![0] = hessian[j + 1]![0]! + variance * xj;
        for (let k = 0; k < width; k++) hessian[j + 1]![k + 1] = hessian[j + 1]![k + 1]! + variance * xj * row[k]!;
      }
    }

    const invN = 1 / X.length;
    for (let j = 0; j < dimension; j++) {
      gradient[j] = gradient[j]! * invN;
      for (let k = 0; k < dimension; k++) hessian[j]![k] = hessian[j]![k]! * invN;
    }
    for (let j = 0; j < width; j++) {
      gradient[j + 1] = gradient[j + 1]! + options.l2 * weights[j]!;
      hessian[j + 1]![j + 1] = hessian[j + 1]![j + 1]! + options.l2;
    }
    for (let j = 0; j < dimension; j++) hessian[j]![j] = hessian[j]![j]! + options.hessianDiagonalJitter;

    const maxAbsGradient = Math.max(...gradient.map(Math.abs));
    if (maxAbsGradient <= options.gradientTolerance) {
      return { weights, intercept, iterations: iteration, converged: true, objective: currentObjective };
    }

    const delta = solveLinearSystem(hessian, gradient);
    let directionalMagnitude = 0;
    for (let j = 0; j < dimension; j++) directionalMagnitude += gradient[j]! * delta[j]!;
    if (!Number.isFinite(directionalMagnitude) || directionalMagnitude < 0) throw new Error('INVALID_NEWTON_DIRECTION');
    if (directionalMagnitude <= options.newtonDecrementTolerance) {
      return { weights, intercept, iterations: iteration, converged: true, objective: currentObjective };
    }

    let step = 1;
    let accepted = false;
    let nextWeights = weights;
    let nextIntercept = intercept;
    let nextObjective = currentObjective;
    while (step >= options.minStep) {
      const candidateIntercept = intercept - step * delta[0]!;
      const candidateWeights = weights.map((weight, j) => weight - step * delta[j + 1]!);
      const candidateObjective = objective(X, y, candidateWeights, candidateIntercept, options.l2);
      if (Number.isFinite(candidateObjective) && candidateObjective <= currentObjective - options.armijo * step * directionalMagnitude) {
        nextWeights = candidateWeights;
        nextIntercept = candidateIntercept;
        nextObjective = candidateObjective;
        accepted = true;
        break;
      }
      step *= 0.5;
    }
    if (!accepted) throw new Error('NEWTON_LINE_SEARCH_FAILED');
    weights = nextWeights;
    intercept = nextIntercept;
    currentObjective = nextObjective;
  }
  throw new Error('LOGISTIC_OPTIMIZER_DID_NOT_CONVERGE');
}
