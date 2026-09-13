import { calculateProbabilityMetricsV1 } from '../metrics/calculator.js';
export const EXPECTED_INNER_FOLDS_PER_OUTER_V1 = 3;

import type {
  CommonSupportDiagnosticV1,
  Gate0ResultV1,
  InnerCandidateEvidenceV1,
  LabelSelectionEvidenceV1,
  OosPredictionV1,
} from '../evidence/types.js';

function finiteMetricSet(candidate: InnerCandidateEvidenceV1): boolean {
  const metrics = [candidate.aggregateRawMetrics, candidate.aggregateCalibratedMetrics, candidate.aggregateBaselineMetrics];
  for (const metric of metrics) {
    if (!Number.isFinite(metric.brier) || !Number.isFinite(metric.logLoss) || !Number.isFinite(metric.ece)) return false;
    if (metric.auc !== null && !Number.isFinite(metric.auc)) return false;
  }
  return Number.isFinite(candidate.aggregateCalibratedBrierSkill)
    && Number.isFinite(candidate.aggregateCalibratedLogLossSkill)
    && Number.isFinite(candidate.aggregateInnerOOSRetentionRate);
}

function finitePrediction(prediction: OosPredictionV1): boolean {
  return Number.isFinite(prediction.decisionTime)
    && (prediction.actualLabel === 0 || prediction.actualLabel === 1)
    && [prediction.rawProbability, prediction.calibratedProbability, prediction.baselineProbability]
      .every((p) => Number.isFinite(p) && p >= 0 && p <= 1);
}

function aggregatePredictions(candidate: InnerCandidateEvidenceV1): OosPredictionV1[] {
  return candidate.folds.flatMap((fold) => [...fold.oosPredictions]);
}

export function evaluateGate0V1(candidate: InnerCandidateEvidenceV1): Gate0ResultV1 {
  const reasons: string[] = [];
  if (!finiteMetricSet(candidate)) reasons.push('NONFINITE_METRICS');
  if (candidate.folds.length !== EXPECTED_INNER_FOLDS_PER_OUTER_V1) reasons.push('INNER_FOLD_COUNT_MISMATCH');

  for (const fold of candidate.folds) {
    if (fold.trainCount <= 0) reasons.push(`EMPTY_TRAIN:${fold.innerFoldId}`);
    if (fold.calibrationCount <= 0) reasons.push(`EMPTY_CALIBRATION:${fold.innerFoldId}`);
    if (fold.oosCount <= 0 || fold.oosPredictions.length <= 0) reasons.push(`EMPTY_OOS:${fold.innerFoldId}`);
    if (fold.trainClass0 <= 0 || fold.trainClass1 <= 0) reasons.push(`SINGLE_CLASS_TRAIN:${fold.innerFoldId}`);
    if (fold.calibrationClass0 <= 0 || fold.calibrationClass1 <= 0) reasons.push(`SINGLE_CLASS_CALIBRATION:${fold.innerFoldId}`);
    if (!fold.lineageValid) reasons.push(`LINEAGE_VIOLATION:${fold.innerFoldId}`);
    if (!fold.windowsValid) reasons.push(`WINDOW_VIOLATION:${fold.innerFoldId}`);
    if (!fold.lockboxValid) reasons.push(`LOCKBOX_VIOLATION:${fold.innerFoldId}`);
    if (!fold.requiredEvidencePresent) reasons.push(`MISSING_REQUIRED_EVIDENCE:${fold.innerFoldId}`);
    if (!Number.isFinite(fold.calibratedBrierSkill) || !Number.isFinite(fold.calibratedLogLossSkill)) reasons.push(`NONFINITE_FOLD_METRICS:${fold.innerFoldId}`);
    if (fold.oosPredictions.length !== fold.oosCount) reasons.push(`OOS_COUNT_MISMATCH:${fold.innerFoldId}`);
    if (!fold.oosPredictions.every(finitePrediction)) reasons.push(`NONFINITE_PREDICTION:${fold.innerFoldId}`);
  }

  const predictions = aggregatePredictions(candidate);
  const seen = new Set<number>();
  for (const prediction of predictions) {
    if (seen.has(prediction.decisionTime)) reasons.push(`DUPLICATE_INNER_OOS_PREDICTION:${prediction.decisionTime}`);
    seen.add(prediction.decisionTime);
  }
  if (predictions.length === 0) reasons.push('EMPTY_AGGREGATE_INNER_OOS');
  const classes = new Set(predictions.map((prediction) => prediction.actualLabel));
  if (predictions.length > 0 && classes.size < 2) reasons.push('SINGLE_CLASS_AGGREGATE_INNER_OOS');
  if (candidate.aggregateRawMetrics.auc === null) reasons.push('UNDEFINED_AGGREGATE_RAW_AUC');
  return { pass: reasons.length === 0, reasons };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function dominatesPareto(b: InnerCandidateEvidenceV1, a: InnerCandidateEvidenceV1): boolean {
  const bAuc = b.aggregateRawMetrics.auc!;
  const aAuc = a.aggregateRawMetrics.auc!;
  const allNoWorse = b.aggregateCalibratedBrierSkill >= a.aggregateCalibratedBrierSkill
    && b.aggregateCalibratedLogLossSkill >= a.aggregateCalibratedLogLossSkill
    && bAuc >= aAuc
    && b.aggregateInnerOOSRetentionRate >= a.aggregateInnerOOSRetentionRate;
  const oneStrict = b.aggregateCalibratedBrierSkill > a.aggregateCalibratedBrierSkill
    || b.aggregateCalibratedLogLossSkill > a.aggregateCalibratedLogLossSkill
    || bAuc > aAuc
    || b.aggregateInnerOOSRetentionRate > a.aggregateInnerOOSRetentionRate;
  return allNoWorse && oneStrict;
}

function commonSupport(a: InnerCandidateEvidenceV1, b: InnerCandidateEvidenceV1): { a: OosPredictionV1[]; b: OosPredictionV1[] } {
  const bByTime = new Map<number, OosPredictionV1>();
  for (const prediction of aggregatePredictions(b)) bByTime.set(prediction.decisionTime, prediction);
  const aCommon: OosPredictionV1[] = [];
  const bCommon: OosPredictionV1[] = [];
  for (const predictionA of aggregatePredictions(a)) {
    const predictionB = bByTime.get(predictionA.decisionTime);
    if (!predictionB) continue;
    if (predictionA.actualLabel !== predictionB.actualLabel) throw new Error('COMMON_SUPPORT_LABEL_MISMATCH');
    aCommon.push(predictionA);
    bCommon.push(predictionB);
  }
  return { a: aCommon, b: bCommon };
}

function dominatesOnCommonSupport(challenger: InnerCandidateEvidenceV1, candidate: InnerCandidateEvidenceV1): { dominates: boolean; commonCount: number } {
  if (challenger.h !== candidate.h) return { dominates: false, commonCount: 0 };
  if (!(challenger.aggregateInnerOOSRetentionRate > candidate.aggregateInnerOOSRetentionRate)) return { dominates: false, commonCount: 0 };
  const support = commonSupport(candidate, challenger);
  if (support.a.length === 0) return { dominates: false, commonCount: 0 };
  const labels = support.a.map((prediction) => prediction.actualLabel);
  if (new Set(labels).size < 2) return { dominates: false, commonCount: support.a.length };
  const candidateCal = calculateProbabilityMetricsV1(labels, support.a.map((prediction) => prediction.calibratedProbability));
  const candidateRaw = calculateProbabilityMetricsV1(labels, support.a.map((prediction) => prediction.rawProbability));
  const challengerCal = calculateProbabilityMetricsV1(labels, support.b.map((prediction) => prediction.calibratedProbability));
  const challengerRaw = calculateProbabilityMetricsV1(labels, support.b.map((prediction) => prediction.rawProbability));
  if (candidateRaw.auc === null || challengerRaw.auc === null) return { dominates: false, commonCount: support.a.length };
  return { commonCount: support.a.length, dominates: challengerCal.brier <= candidateCal.brier && challengerCal.logLoss <= candidateCal.logLoss && challengerRaw.auc >= candidateRaw.auc };
}

function id(candidate: InnerCandidateEvidenceV1): { h: number; tau: number } { return { h: candidate.h, tau: candidate.tau }; }

export function selectLabelCandidateV1(candidates: readonly InnerCandidateEvidenceV1[]): LabelSelectionEvidenceV1 {
  const trace = candidates.map((candidate) => {
    const gate0 = evaluateGate0V1(candidate);
    const gate1Pass = gate0.pass && candidate.aggregateCalibratedBrierSkill > 0 && candidate.aggregateCalibratedLogLossSkill > 0;
    const gate2Pass = gate1Pass && median(candidate.folds.map((fold) => fold.calibratedBrierSkill)) > 0 && median(candidate.folds.map((fold) => fold.calibratedLogLossSkill)) > 0;
    const gate3Pass = gate2Pass && candidate.aggregateRawMetrics.auc !== null && candidate.aggregateRawMetrics.auc > 0.5;
    return { h: candidate.h, tau: candidate.tau, gate0, gate1Pass, gate2Pass, gate3Pass };
  });
  const gate3 = candidates.filter((candidate, index) => trace[index]!.gate3Pass);
  if (gate3.length === 0) return { status: 'NO_VALID_LABEL_SPEC_V1', candidateTrace: trace, gate3Survivors: [], paretoFrontier: [], postCommonSupportFrontier: [], commonSupportDiagnostics: [] };
  const pareto = gate3.filter((candidate) => !gate3.some((challenger) => challenger !== candidate && dominatesPareto(challenger, candidate)));
  const diagnostics: CommonSupportDiagnosticV1[] = [];
  const postCommonSupport = pareto.filter((candidate) => {
    for (const challenger of pareto) {
      if (challenger === candidate || challenger.h !== candidate.h) continue;
      const result = dominatesOnCommonSupport(challenger, candidate);
      diagnostics.push({ h: candidate.h, candidateTau: candidate.tau, challengerTau: challenger.tau, commonCount: result.commonCount, candidateDominated: result.dominates });
      if (result.dominates) return false;
    }
    return true;
  });
  if (postCommonSupport.length === 0) throw new Error('SELECTION_EMPTY_AFTER_COMMON_SUPPORT');
  const sorted = [...postCommonSupport].sort((a, b) => {
    if (a.aggregateInnerOOSRetentionRate !== b.aggregateInnerOOSRetentionRate) return b.aggregateInnerOOSRetentionRate - a.aggregateInnerOOSRetentionRate;
    if (a.tau !== b.tau) return a.tau - b.tau;
    return a.h - b.h;
  });
  const selected = sorted[0]!;
  return { status: 'SELECTED', selected: id(selected), candidateTrace: trace, gate3Survivors: gate3.map(id), paretoFrontier: pareto.map(id), postCommonSupportFrontier: postCommonSupport.map(id), commonSupportDiagnostics: diagnostics };
}
