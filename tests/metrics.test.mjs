import test from 'node:test';
import assert from 'node:assert/strict';
import { aucRocV1, calculateProbabilityMetricsV1, eceEqualWidthV1 } from '../dist/quant-core/metrics/calculator.js';
test('AUC handles perfect, reversed, ties, and single-class cases', () => {
    assert.equal(aucRocV1([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9]), 1);
    assert.equal(aucRocV1([0, 0, 1, 1], [0.9, 0.8, 0.2, 0.1]), 0);
    assert.equal(aucRocV1([0, 1, 0, 1], [0.5, 0.5, 0.5, 0.5]), 0.5);
    assert.equal(aucRocV1([1, 1], [0.1, 0.9]), null);
});
test('AUC tie result is permutation invariant', () => {
    const a = aucRocV1([0, 1, 0, 1], [0.2, 0.2, 0.8, 0.8]);
    const b = aucRocV1([1, 0, 1, 0], [0.8, 0.8, 0.2, 0.2]);
    assert.equal(a, b);
});
test('Brier and LogLoss use real probabilities while LogLoss safely clips endpoints', () => {
    const m = calculateProbabilityMetricsV1([0, 1], [0, 1]);
    assert.equal(m.brier, 0);
    assert.ok(Number.isFinite(m.logLoss));
    assert.equal(m.auc, 1);
});
test('ECE V1 is deterministic equal-width 10-bin weighted absolute calibration error', () => {
    assert.equal(eceEqualWidthV1([0, 1], [0, 1]), 0);
    assert.ok(Math.abs(eceEqualWidthV1([0, 1], [0.25, 0.75]) - 0.25) < 1e-12);
});
