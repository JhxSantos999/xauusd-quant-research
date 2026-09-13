import test from 'node:test';
import assert from 'node:assert/strict';
import { runNestedExperimentV1 } from '../dist/quant-core/engine/nested-experiment.js';

const M5 = 300_000;
function syntheticCandles(count = 620) {
  const candles = [];
  const start = Date.parse('2020-01-01T00:00:00Z');
  let previousClose = 100;
  for (let i = 0; i < count; i++) {
    const sign = Math.floor(i / 8) % 2 === 0 ? 1 : -1;
    const logReturn = sign * 0.002;
    const open = previousClose;
    const close = open * Math.exp(logReturn);
    const high = Math.max(open, close) * 1.0002;
    const low = Math.min(open, close) * 0.9998;
    candles.push({ time: start + i * M5, open, high, low, close, tickVolume: 100 + (i % 17), volume: 0, spread: 20 });
    previousClose = close;
  }
  return candles;
}
function singleClassCandles(count = 620) {
  const candles = [];
  const start = Date.parse('2021-01-01T00:00:00Z');
  let previousClose = 100;
  for (let i = 0; i < count; i++) {
    const open = previousClose;
    const close = open * Math.exp(0.002);
    candles.push({ time: start + i * M5, open, high: close * 1.0002, low: open * 0.9998, close, tickVolume: 100, volume: 0, spread: 20 });
    previousClose = close;
  }
  return candles;
}
function smokeGeometry(candles) {
  const start = candles[0].time;
  return {
    domainEnd: start + 580 * M5,
    embargoMs: M5,
    outer: { trainDevMs: 240 * M5, calibrationMs: 40 * M5, oosMs: 40 * M5, stepMs: 40 * M5, count: 6 },
    inner: { trainMs: 80 * M5, calibrationMs: 40 * M5, oosMs: 40 * M5, stepMs: 40 * M5, count: 3 },
  };
}

test('real nested engine smoke crosses 6x16x3, selection, outer refit and nested validation without production prereg bypass', () => {
  const candles = syntheticCandles();
  const result = runNestedExperimentV1(candles, smokeGeometry(candles));
  assert.equal(result.attemptedInnerEvaluations, 288);
  assert.equal(result.completedInnerEvaluations, 288);
  assert(result.invalidInnerEvaluations >= 0 && result.invalidInnerEvaluations <= 288);
  assert.equal(result.outerFoldGeometry.length, 6);
  assert(result.outerFoldGeometry.every((outer) => outer.inner.length === 3));
  assert(result.innerCandidateEvidence.every((outer) => outer.candidates.length === 16));
  assert.equal(result.innerSelectionEvidence.length, 6);
  assert(result.innerSelectionEvidence.every((outer) => outer.selection.status === 'SELECTED'));
  assert(result.outerRefitEvidence.every((outer) => outer.status === 'REFIT_COMPLETED'));
  assert(result.outerOosPredictions.length > 0);
  assert.equal(new Set(result.outerOosPredictions.map((p) => `${p.asset}|${p.decisionTime}`)).size, result.outerOosPredictions.length);
  assert(['VALIDATED_V1', 'NOT_VALIDATED_V1'].includes(result.nestedValidation.status));
});

test('all structurally rejected Inner folds still count as completed evaluations and remain explicit evidence', () => {
  const candles = singleClassCandles();
  const result = runNestedExperimentV1(candles, smokeGeometry(candles));
  assert.equal(result.attemptedInnerEvaluations, 288);
  assert.equal(result.completedInnerEvaluations, 288);
  assert.equal(result.invalidInnerEvaluations, 288);
  assert(result.innerCandidateEvidence.every((outer) => outer.candidates.every((candidate) => candidate.folds.length === 3)));
  assert(result.innerCandidateEvidence.every((outer) => outer.candidates.every((candidate) => candidate.folds.every((fold) => fold.integrityReasons?.includes('SINGLE_CLASS_TRAIN')))));
  assert(result.innerSelectionEvidence.every((outer) => outer.selection.status === 'NO_VALID_LABEL_SPEC_V1'));
  assert.equal(result.nestedValidation.status, 'NOT_VALIDATED_V1');
});

test('retention denominator is invariant across tau for the same h and Outer/Inner geometry', () => {
  const candles = syntheticCandles();
  const result = runNestedExperimentV1(candles, smokeGeometry(candles));
  const firstOuter = result.innerCandidateEvidence[0];
  for (const h of [3, 6, 12, 24]) {
    const sameH = firstOuter.candidates.filter((candidate) => candidate.h === h);
    for (let foldIndex = 0; foldIndex < 3; foldIndex++) {
      const denominators = sameH.map((candidate) => candidate.folds[foldIndex].retentionDenominator);
      assert.equal(new Set(denominators).size, 1);
    }
  }
});

test('baseline probability equals effective TRAIN positive prevalence in every completed synthetic inner fold', () => {
  const candles = syntheticCandles();
  const result = runNestedExperimentV1(candles, smokeGeometry(candles));
  for (const outer of result.innerCandidateEvidence) {
    for (const candidate of outer.candidates) {
      for (const fold of candidate.folds) {
        if (fold.baselineProbability === undefined) continue;
        const expected = fold.trainClass1 / fold.trainCount;
        assert.equal(fold.baselineProbability, expected);
        assert(fold.oosPredictions.every((prediction) => prediction.baselineProbability === expected));
      }
    }
  }
});
