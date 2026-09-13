import test from 'node:test';
import assert from 'node:assert/strict';
import { M5_TIMEFRAME_MS } from '../dist/quant-core/data/contracts.js';
import { extractFeatureRowsV1 } from '../dist/quant-core/features/extractor.js';

function makeCandles(count) {
  const start = Date.parse('2025-01-01T00:00:00Z');
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + Math.sin(i / 5) + i * 0.02;
    return { time: start + i * M5_TIMEFRAME_MS, open: close - 0.1, high: close + 0.4, low: close - 0.5, close };
  });
}

test('Future Perturbation Test: changing candles after decision index cannot change features at that decision', () => {
  const base = makeCandles(60);
  const decisionIndex = 40;
  const originalRow = extractFeatureRowsV1(base).find((row) => row.barIndex === decisionIndex);
  assert.ok(originalRow);

  const perturbed = base.map((c) => ({ ...c }));
  for (let i = decisionIndex + 1; i < perturbed.length; i++) {
    perturbed[i] = {
      ...perturbed[i],
      open: perturbed[i].open * 7,
      high: perturbed[i].high * 9,
      low: perturbed[i].low * 5,
      close: perturbed[i].close * 8,
    };
  }
  const changedRow = extractFeatureRowsV1(perturbed).find((row) => row.barIndex === decisionIndex);
  assert.deepEqual(changedRow, originalRow);
});
