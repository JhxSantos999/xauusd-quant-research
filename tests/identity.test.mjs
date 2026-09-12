import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fitIdentityTransformerV1,
  IDENTITY_TRANSFORMER_VERSION,
  transformIdentityV1,
} from '../dist/quant-core/transformers/identity.js';

test('identity transformer is train-fitted only for dimensional contract and changes no values', () => {
  const train = [[1, 2], [3, 4]];
  const transformer = fitIdentityTransformerV1(train);
  assert.equal(transformer.version, IDENTITY_TRANSFORMER_VERSION);
  assert.equal(transformer.featureCount, 2);
  const output = transformIdentityV1(transformer, [[5, 6]]);
  assert.deepEqual(output, [[5, 6]]);
});

test('identity transformer fails loud on nonfinite or wrong-width features', () => {
  const transformer = fitIdentityTransformerV1([[1, 2], [3, 4]]);
  assert.throws(() => transformIdentityV1(transformer, [[1, Number.NaN]]), /NONFINITE/);
  assert.throws(() => transformIdentityV1(transformer, [[1, 2, 3]]), /FEATURE_COUNT_MISMATCH/);
});
