import { calculateProbabilityMetricsV1 } from '../metrics/calculator.js';
import type { NestedValidationEvidenceV1, OuterFoldEvidenceV1, OosPredictionV1 } from '../evidence/types.js';

export const EXPECTED_OUTER_FOLDS_V1 = 6;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}
function skill(modelLoss: number, baselineLoss: number): number {
  if (!(baselineLoss > 0) || !Number.isFinite(modelLoss) || !Number.isFinite(baselineLoss)) return Number.NaN;
  return 1 - modelLoss / baselineLoss;
}
function validPrediction(prediction: OosPredictionV1): boolean {
  return Number.isFinite(prediction.decisionTime)
    && (prediction.actualLabel === 0 || prediction.actualLabel === 1)
    && [prediction.rawProbability, prediction.calibratedProbability, prediction.baselineProbability].every((p) => Number.isFinite(p) && p >= 0 && p <= 1);
}

export function validateNestedProcedureV1(outerFolds: readonly OuterFoldEvidenceV1[]): NestedValidationEvidenceV1 {
  const reasons: string[] = [];
  if (outerFolds.length !== EXPECTED_OUTER_FOLDS_V1) reasons.push('OUTER_FOLD_COUNT_MISMATCH');
  if (new Set(outerFolds.map((fold) => fold.outerFoldId)).size !== outerFolds.length) reasons.push('DUPLICATE_OUTER_FOLD_ID');
  if (outerFolds.some((fold) => fold.selectionStatus !== 'SELECTED')) reasons.push('OUTER_NO_VALID_SELECTION');
  const selected = outerFolds.filter((fold) => fold.selectionStatus === 'SELECTED');
  const allPredictions: OosPredictionV1[] = [];
  const perOuter: { outerFoldId: string; brierSkill: number; logLossSkill: number }[] = [];
  for (const fold of selected) {
    const predictions = fold.predictions ?? [];
    if (predictions.length === 0) { reasons.push(`EMPTY_OUTER_OOS:${fold.outerFoldId}`); continue; }
    if (!predictions.every(validPrediction)) { reasons.push(`INVALID_OUTER_PREDICTION:${fold.outerFoldId}`); continue; }
    const labels = predictions.map((prediction) => prediction.actualLabel);
    const calibrated = predictions.map((prediction) => prediction.calibratedProbability);
    const baseline = predictions.map((prediction) => prediction.baselineProbability);
    const modelMetrics = calculateProbabilityMetricsV1(labels, calibrated);
    const baselineMetrics = calculateProbabilityMetricsV1(labels, baseline);
    const brierSkill = skill(modelMetrics.brier, baselineMetrics.brier);
    const logLossSkill = skill(modelMetrics.logLoss, baselineMetrics.logLoss);
    if (!Number.isFinite(brierSkill) || !Number.isFinite(logLossSkill)) reasons.push(`NONFINITE_OUTER_SKILL:${fold.outerFoldId}`);
    perOuter.push({ outerFoldId: fold.outerFoldId, brierSkill, logLossSkill });
    allPredictions.push(...predictions);
  }
  const seen = new Set<string>();
  for (const prediction of allPredictions) {
    const key = `${prediction.asset ?? 'XAUUSD'}|${prediction.decisionTime}`;
    if (seen.has(key)) reasons.push(`DUPLICATE_OUTER_OOS_PREDICTION:${key}`);
    seen.add(key);
  }
  if (reasons.length > 0 || perOuter.length !== EXPECTED_OUTER_FOLDS_V1 || allPredictions.length === 0) return { status: 'NOT_VALIDATED_V1', rejectionReasons: [...new Set(reasons)], perOuterFold: perOuter };
  const labels = allPredictions.map((prediction) => prediction.actualLabel);
  const calibrated = allPredictions.map((prediction) => prediction.calibratedProbability);
  const raw = allPredictions.map((prediction) => prediction.rawProbability);
  const baseline = allPredictions.map((prediction) => prediction.baselineProbability);
  const globalCalibrated = calculateProbabilityMetricsV1(labels, calibrated);
  const globalRaw = calculateProbabilityMetricsV1(labels, raw);
  const globalBaseline = calculateProbabilityMetricsV1(labels, baseline);
  const globalBrierSkill = skill(globalCalibrated.brier, globalBaseline.brier);
  const globalLogLossSkill = skill(globalCalibrated.logLoss, globalBaseline.logLoss);
  const medianBrier = median(perOuter.map((fold) => fold.brierSkill));
  const medianLogLoss = median(perOuter.map((fold) => fold.logLossSkill));
  if (!(globalBrierSkill > 0)) reasons.push('GLOBAL_BRIER_SKILL_NOT_POSITIVE');
  if (!(globalLogLossSkill > 0)) reasons.push('GLOBAL_LOGLOSS_SKILL_NOT_POSITIVE');
  if (!(medianBrier > 0)) reasons.push('MEDIAN_OUTER_BRIER_SKILL_NOT_POSITIVE');
  if (!(medianLogLoss > 0)) reasons.push('MEDIAN_OUTER_LOGLOSS_SKILL_NOT_POSITIVE');
  const retention = selected.map((fold) => fold.retentionRate).filter((value): value is number => value !== undefined && Number.isFinite(value));
  const meanRetention = retention.length === selected.length ? retention.reduce((sum, value) => sum + value, 0) / retention.length : undefined;
  return {
    status: reasons.length === 0 ? 'VALIDATED_V1' : 'NOT_VALIDATED_V1',
    rejectionReasons: reasons,
    globalCalibratedMetrics: globalCalibrated,
    globalBaselineMetrics: globalBaseline,
    globalBrierSkill,
    globalLogLossSkill,
    medianOuterBrierSkill: medianBrier,
    medianOuterLogLossSkill: medianLogLoss,
    diagnosticGlobalRawAuc: globalRaw.auc,
    diagnosticGlobalCalibratedAuc: globalCalibrated.auc,
    perOuterFold: perOuter,
    ...(meanRetention === undefined ? {} : { diagnosticMeanRetention: meanRetention }),
  };
}
