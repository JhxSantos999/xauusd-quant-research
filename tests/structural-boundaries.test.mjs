import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceDatasetContract } from '../dist/quant-core/data/contracts.js';
import { assertNonOverlappingOosGeometryV1, FROZEN_NESTED_GEOMETRY_V1 } from '../dist/quant-core/research/frozen-contracts.js';

const candle = (time) => ({ time, open: 1, high: 1.1, low: 0.9, close: 1 });

test('dataset contract enforces information availability boundary, not only raw bar-open boundary', () => {
  const candles = [candle(900)];
  assert.throws(() => enforceDatasetContract(candles, {
    datasetId: 'fixture',
    datasetSha256: 'fixture',
    timeframeMs: 200,
    maxCandleOpenTime: 2_000,
    maxInformationTime: 1_000,
  }), /INFORMATION_BOUNDARY_VIOLATION/);
});

test('dataset contract accepts information availability exactly equal to maxInformationTime', () => {
  const candles = [candle(800)];
  assert.doesNotThrow(() => enforceDatasetContract(candles, {
    datasetId: 'fixture',
    datasetSha256: 'fixture',
    timeframeMs: 200,
    maxCandleOpenTime: 2_000,
    maxInformationTime: 1_000,
  }));
});

test('frozen V1 geometry is structurally non-overlapping', () => {
  assert.doesNotThrow(() => assertNonOverlappingOosGeometryV1(FROZEN_NESTED_GEOMETRY_V1));
});

test('geometry contract rejects Outer OOS overlap before execution', () => {
  assert.throws(() => assertNonOverlappingOosGeometryV1({
    ...FROZEN_NESTED_GEOMETRY_V1,
    outer: { ...FROZEN_NESTED_GEOMETRY_V1.outer, stepMs: FROZEN_NESTED_GEOMETRY_V1.outer.oosMs - 1 },
  }), /OUTER_OOS_OVERLAP_NOT_ALLOWED/);
});

test('geometry contract rejects Inner OOS overlap before execution', () => {
  assert.throws(() => assertNonOverlappingOosGeometryV1({
    ...FROZEN_NESTED_GEOMETRY_V1,
    inner: { ...FROZEN_NESTED_GEOMETRY_V1.inner, stepMs: FROZEN_NESTED_GEOMETRY_V1.inner.oosMs - 1 },
  }), /INNER_OOS_OVERLAP_NOT_ALLOWED/);
});
