export const IDENTITY_TRANSFORMER_VERSION = 'scaler_identity_v1' as const;

export interface IdentityTransformerV1 {
  readonly version: typeof IDENTITY_TRANSFORMER_VERSION;
  readonly featureCount: number;
}

function validateMatrix(matrix: readonly (readonly number[])[], expectedFeatureCount?: number): number {
  if (matrix.length === 0) throw new Error('EMPTY_FEATURE_MATRIX');
  const featureCount = matrix[0]!.length;
  if (featureCount === 0) throw new Error('EMPTY_FEATURE_VECTOR');
  if (expectedFeatureCount !== undefined && featureCount !== expectedFeatureCount) throw new Error('FEATURE_COUNT_MISMATCH');
  for (const row of matrix) {
    if (row.length !== featureCount) throw new Error('RAGGED_FEATURE_MATRIX');
    if (!row.every(Number.isFinite)) throw new Error('NONFINITE_FEATURE_MATRIX');
  }
  return featureCount;
}

export function fitIdentityTransformerV1(trainX: readonly (readonly number[])[]): IdentityTransformerV1 {
  return { version: IDENTITY_TRANSFORMER_VERSION, featureCount: validateMatrix(trainX) };
}

export function transformIdentityV1(
  transformer: IdentityTransformerV1,
  X: readonly (readonly number[])[],
): number[][] {
  validateMatrix(X, transformer.featureCount);
  return X.map((row) => [...row]);
}
