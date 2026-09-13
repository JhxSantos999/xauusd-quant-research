import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fitFinalSignalModelV1R1 } from '../dist/quant-core/engine/final-signal-model.js';
import { FROZEN_FINAL_SIGNAL_FIT_V1R1, FINAL_SIGNAL_IMPLEMENTATION_BINDING_V1R1, AUDITED_FINAL_DEV_EXECUTION_V1R1 } from '../dist/quant-core/research/final-signal-contracts.js';
import { parseFinalSignalArgsV1R1 } from '../dist/quant-core/cli/run-final-signal-v1r1.js';

const M5 = 300_000;

function syntheticCandles(count = 900) {
  const start = Date.parse('2026-01-01T00:00:00Z');
  const out = [];
  let previousClose = 1900;
  for (let i = 0; i < count; i++) {
    const close = 1900 + 0.025 * i + 2.4 * Math.sin(i / 6.5) + 1.1 * Math.sin(i / 2.7);
    const open = previousClose;
    const high = Math.max(open, close) + 0.45 + 0.05 * Math.sin(i / 5) ** 2;
    const low = Math.min(open, close) - 0.45 - 0.05 * Math.cos(i / 4) ** 2;
    out.push({ time: start + i * M5, open, high, low, close, tickVolume: 100 + (i % 17), volume: 0, spread: 10 });
    previousClose = close;
  }
  return out;
}

test('Final Signal implementation binding has frozen exact identity', () => {
  const raw = fs.readFileSync(FINAL_SIGNAL_IMPLEMENTATION_BINDING_V1R1.path);
  assert.equal(raw.length, 1314);
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), 'f5bf2acd6796c376a54a18a5b77d597dd2d6823c3053bd39c4c26d924b1c4b6a');
});

test('frozen Final Signal fit is exactly 180d TRAIN + 30d CALIB, one-day embargo, h=3 tau=0', () => {
  assert.equal(FROZEN_FINAL_SIGNAL_FIT_V1R1.domainEnd, Date.parse('2026-09-09T05:30:00Z'));
  assert.equal(FROZEN_FINAL_SIGNAL_FIT_V1R1.trainMs, 180 * 86_400_000);
  assert.equal(FROZEN_FINAL_SIGNAL_FIT_V1R1.calibrationMs, 30 * 86_400_000);
  assert.equal(FROZEN_FINAL_SIGNAL_FIT_V1R1.embargoMs, 86_400_000);
  assert.equal(FROZEN_FINAL_SIGNAL_FIT_V1R1.h, 3);
  assert.equal(FROZEN_FINAL_SIGNAL_FIT_V1R1.tau, 0);
  assert.deepEqual(AUDITED_FINAL_DEV_EXECUTION_V1R1.selected, { h: 3, tau: 0 });
});

test('Final Signal fit is deterministic, uses isolated TRAIN/CALIB only, and emits no OOS stage', () => {
  const candles = syntheticCandles();
  const geometry = {
    domainEnd: candles[0].time + candles.length * M5,
    embargoMs: 4 * M5,
    trainMs: 500 * M5,
    calibrationMs: 200 * M5,
    h: 3,
    tau: 0,
  };
  const a = fitFinalSignalModelV1R1(candles, geometry);
  const b = fitFinalSignalModelV1R1(candles, geometry);
  assert.deepEqual(a, b);
  assert.equal(a.status, 'FIT_COMPLETED');
  assert.deepEqual(a.selectedLabelSpec, { h: 3, tau: 0 });
  assert.equal(a.trainWindow.end, a.calibrationWindow.start);
  assert.equal(a.calibrationWindow.end, geometry.domainEnd);
  assert.ok(a.trainCount > 0 && a.calibrationCount > 0);
  assert.ok(a.trainClass0 > 0 && a.trainClass1 > 0);
  assert.ok(a.calibrationClass0 > 0 && a.calibrationClass1 > 0);
  assert.ok(a.trainMaxLabelEnd <= a.calibrationWindow.start - geometry.embargoMs);
  assert.ok(a.calibrationMaxLabelEnd <= geometry.domainEnd - geometry.embargoMs);
  assert.equal(a.model.weights.length, 10);
  assert.ok(a.model.weights.every(Number.isFinite));
  assert.ok(Number.isFinite(a.model.intercept));
  assert.ok(Number.isFinite(a.calibrator.slope));
  assert.ok(Number.isFinite(a.calibrator.intercept));
  assert.equal('oosPredictions' in a, false);
});

test('Final Signal production CLI requires audited Final DEV artifacts and exposes no lockbox argument', () => {
  const parsed = parseFinalSignalArgsV1R1(['--dataset', 'dev.csv', '--final-dev-artifacts', 'final-dev', '--preflight-only']);
  assert.equal(parsed.dataset, 'dev.csv');
  assert.equal(parsed.finalDevArtifacts, 'final-dev');
  assert.equal(parsed.preflightOnly, true);
  assert.equal(parsed.outputRoot, undefined);
  assert.throws(() => parseFinalSignalArgsV1R1(['--dataset', 'dev.csv', '--final-dev-artifacts', 'final-dev', '--lockbox', 'future.csv', '--preflight-only']), /UNKNOWN_ARGUMENT:--lockbox/);
});
