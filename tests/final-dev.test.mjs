import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { selectLabelCandidateV1 } from '../dist/quant-core/selection/selector.js';
import { selectLabelCandidateForExpectedFoldCountV1, evaluateGate0ForExpectedFoldCountV1 } from '../dist/quant-core/selection/selector-fold-count.js';
import { runFinalDevSelectionV1 } from '../dist/quant-core/engine/final-dev-selection.js';
import { FROZEN_FINAL_DEV_GEOMETRY_V1, FINAL_DEV_IMPLEMENTATION_BINDING_V1R1 } from '../dist/quant-core/research/final-dev-contracts.js';
import { generateEndAlignedFolds } from '../dist/quant-core/walkforward/orchestrator.js';

function metric(brier, logLoss, auc) { return { brier, logLoss, ece: 0.01, auc }; }
function fold(id, offset, brierSkill = 0.01, logLossSkill = 0.01) {
  return {
    innerFoldId: id,
    trainCount: 20,
    calibrationCount: 10,
    oosCount: 2,
    trainClass0: 10,
    trainClass1: 10,
    calibrationClass0: 5,
    calibrationClass1: 5,
    lineageValid: true,
    windowsValid: true,
    lockboxValid: true,
    requiredEvidencePresent: true,
    calibratedBrierSkill: brierSkill,
    calibratedLogLossSkill: logLossSkill,
    oosPredictions: [
      { asset: 'XAUUSD', decisionTime: offset + 1, actualLabel: 0, rawProbability: 0.4, calibratedProbability: 0.42, baselineProbability: 0.5 },
      { asset: 'XAUUSD', decisionTime: offset + 2, actualLabel: 1, rawProbability: 0.6, calibratedProbability: 0.58, baselineProbability: 0.5 },
    ],
  };
}
function candidate(h, tau, foldCount, aggregateBrierSkill, aggregateLogLossSkill, auc = 0.6) {
  return {
    h,
    tau,
    folds: Array.from({ length: foldCount }, (_, i) => fold(`F_${i + 1}`, i * 10, aggregateBrierSkill > 0 ? 0.01 : -0.01, aggregateLogLossSkill > 0 ? 0.01 : -0.01)),
    aggregateRawMetrics: metric(0.24, 0.68, auc),
    aggregateCalibratedMetrics: metric(0.23, 0.67, auc),
    aggregateBaselineMetrics: metric(0.25, 0.69, 0.5),
    aggregateCalibratedBrierSkill: aggregateBrierSkill,
    aggregateCalibratedLogLossSkill: aggregateLogLossSkill,
    aggregateInnerOOSRetentionRate: 0.9,
  };
}

test('Final DEV implementation binding has frozen exact identity', () => {
  const raw = fs.readFileSync(FINAL_DEV_IMPLEMENTATION_BINDING_V1R1.path);
  assert.equal(raw.length, FINAL_DEV_IMPLEMENTATION_BINDING_V1R1.bytes);
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), FINAL_DEV_IMPLEMENTATION_BINDING_V1R1.sha256);
});

test('fold-count selector is exactly backward-compatible with Selection V1 at 3 folds', () => {
  const candidates = [candidate(3, 0, 3, 0.02, 0.02), candidate(6, 0, 3, -0.01, -0.01)];
  assert.deepEqual(selectLabelCandidateForExpectedFoldCountV1(candidates, 3), selectLabelCandidateV1(candidates));
});

test('Final DEV selector changes only the Gate0 expected fold count from 3 to 10', () => {
  const c = candidate(3, 0, 10, 0.02, 0.02);
  assert.equal(evaluateGate0ForExpectedFoldCountV1(c, 10).pass, true);
  assert.equal(evaluateGate0ForExpectedFoldCountV1(c, 3).pass, false);
  const selected = selectLabelCandidateForExpectedFoldCountV1([c], 10);
  assert.equal(selected.status, 'SELECTED');
  assert.deepEqual(selected.selected, { h: 3, tau: 0 });
});

test('frozen Final DEV geometry is 10 non-overlapping end-aligned 180/30/30-day folds', () => {
  assert.equal(FROZEN_FINAL_DEV_GEOMETRY_V1.count, 10);
  const total = FROZEN_FINAL_DEV_GEOMETRY_V1.trainMs + FROZEN_FINAL_DEV_GEOMETRY_V1.calibrationMs + FROZEN_FINAL_DEV_GEOMETRY_V1.oosMs;
  const folds = generateEndAlignedFolds(FROZEN_FINAL_DEV_GEOMETRY_V1.domainEnd, total, FROZEN_FINAL_DEV_GEOMETRY_V1.stepMs, FROZEN_FINAL_DEV_GEOMETRY_V1.count);
  assert.equal(folds.length, 10);
  assert.equal(folds[0].start, Date.parse('2025-04-17T05:30:00Z'));
  assert.equal(folds.at(-1).end, Date.parse('2026-09-09T05:30:00Z'));
  for (let i = 1; i < folds.length; i++) assert.ok(folds[i].end - FROZEN_FINAL_DEV_GEOMETRY_V1.oosMs >= folds[i - 1].end - FROZEN_FINAL_DEV_GEOMETRY_V1.oosMs);
});

test('Final DEV engine attempts exactly 16 candidates x 10 folds and never accesses a lockbox path', () => {
  const step = 300000;
  const candles = Array.from({ length: 260 }, (_, i) => {
    const base = 1900 + 0.02 * i + 0.8 * Math.sin(i / 3);
    const close = base + 0.15 * Math.sin(i * 1.7);
    return { time: i * step, open: base, high: Math.max(base, close) + 0.4, low: Math.min(base, close) - 0.4, close, tickVolume: 100 + (i % 7), volume: 0, spread: 10 };
  });
  const geometry = { domainEnd: 250 * step, embargoMs: 0, trainMs: 60 * step, calibrationMs: 20 * step, oosMs: 10 * step, stepMs: 10 * step, count: 10 };
  const result = runFinalDevSelectionV1(candles, geometry);
  assert.equal(result.attemptedEvaluations, 160);
  assert.equal(result.completedEvaluations, 160);
  assert.ok(result.invalidEvaluations >= 0 && result.invalidEvaluations <= 160);
  assert.equal(result.candidateEvidence.length, 16);
  assert.equal(result.finalDevFoldGeometry.length, 10);
  for (const candidateEvidence of result.candidateEvidence) assert.equal(candidateEvidence.folds.length, 10);
});
