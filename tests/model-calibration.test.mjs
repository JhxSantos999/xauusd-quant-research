import test from 'node:test';
import assert from 'node:assert/strict';
import { fitLogisticV1, predictLogisticV1 } from '../dist/quant-core/models/logistic.js';
import { fitPlattV1, calibrateV1 } from '../dist/quant-core/calibration/platt.js';

function row(x, z = 0) {
  return [x, 0, 0, 0, 0, 0, 0, 0, z, 0];
}

function trainingFixture() {
  const X = [];
  const y = [];
  for (let i = -40; i <= 40; i++) {
    if (i === 0) continue;
    const x = i / 20;
    X.push(row(x, Math.sin(i) * 0.1));
    y.push(i > 0 ? 1 : 0);
  }
  return { X, y };
}

test('logreg_v1 is deterministic byte-for-byte on identical synthetic training data', () => {
  const { X, y } = trainingFixture();
  const a = fitLogisticV1(X, y);
  const b = fitLogisticV1(X, y);
  assert.deepEqual(a, b);
  assert.equal(a.version, 'logreg_v1');
  assert.equal(a.featureCount, 10);
  assert(a.iterations > 0 && a.iterations < 100);
});

test('logreg_v1 returns finite probabilities in [0,1] and learns the synthetic ordering', () => {
  const { X, y } = trainingFixture();
  const model = fitLogisticV1(X, y);
  const p = predictLogisticV1(model, [row(-1.5), row(0), row(1.5)]);
  assert(p.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
  assert(p[0] < p[1] && p[1] < p[2]);
});

test('logreg_v1 fails loud on single-class labels, wrong feature width, and nonfinite features', () => {
  assert.throws(() => fitLogisticV1([row(-1), row(1)], [1, 1]), /SINGLE_CLASS_TRAIN/);
  assert.throws(() => fitLogisticV1([[0, 1], [1, 0]], [0, 1]), /LOGREG_FEATURE_WIDTH_MISMATCH/);
  const bad = row(1); bad[3] = Number.NaN;
  assert.throws(() => fitLogisticV1([row(-1), bad], [0, 1]), /NONFINITE_FEATURE/);
});

test('changing synthetic TRAIN data changes the fitted logreg_v1 artefact', () => {
  const { X, y } = trainingFixture();
  const original = fitLogisticV1(X, y);
  const mutatedX = X.map((r) => [...r]);
  mutatedX[mutatedX.length - 1][0] *= -1;
  const mutated = fitLogisticV1(mutatedX, y);
  assert.notDeepEqual(mutated, original);
});

test('platt_v1 is deterministic and uses only supplied calibration probabilities/labels', () => {
  const raw = [0.05, 0.15, 0.25, 0.4, 0.6, 0.75, 0.85, 0.95];
  const y =   [0,    0,    0,    0,   1,   1,    1,    1];
  const a = fitPlattV1(raw, y);
  const b = fitPlattV1(raw, y);
  assert.deepEqual(a, b);
  assert.equal(a.version, 'platt_v1');
  assert.equal(a.positiveTarget, 5 / 6);
  assert.equal(a.negativeTarget, 1 / 6);
});

test('platt_v1 calibrated probabilities are finite, bounded, and monotone for positive learned slope', () => {
  const raw = [0.05, 0.15, 0.25, 0.4, 0.6, 0.75, 0.85, 0.95];
  const y =   [0,    0,    0,    0,   1,   1,    1,    1];
  const calibrator = fitPlattV1(raw, y);
  assert(calibrator.slope > 0);
  const calibrated = calibrateV1(calibrator, raw);
  assert(calibrated.every((p) => Number.isFinite(p) && p >= 0 && p <= 1));
  for (let i = 1; i < calibrated.length; i++) assert(calibrated[i - 1] < calibrated[i]);
});

test('platt_v1 fails loud on single-class calibration and invalid raw probabilities', () => {
  assert.throws(() => fitPlattV1([0.2, 0.8], [1, 1]), /SINGLE_CLASS_CALIBRATION/);
  assert.throws(() => fitPlattV1([0.2, 1.1], [0, 1]), /INVALID_RAW_PROBABILITY/);
  const c = fitPlattV1([0.2, 0.8], [0, 1]);
  assert.throws(() => calibrateV1(c, [Number.NaN]), /INVALID_RAW_PROBABILITY/);
});

test('changing only calibration labels changes platt_v1 while leaving a previously fitted logreg artefact untouched', () => {
  const { X, y } = trainingFixture();
  const model = fitLogisticV1(X, y);
  const modelSnapshot = JSON.stringify(model);
  const raw = predictLogisticV1(model, [row(-1.5), row(-0.5), row(0.5), row(1.5)]);
  const a = fitPlattV1(raw, [0, 0, 1, 1]);
  const b = fitPlattV1(raw, [0, 1, 0, 1]);
  assert.notDeepEqual(a, b);
  assert.equal(JSON.stringify(model), modelSnapshot);
});
