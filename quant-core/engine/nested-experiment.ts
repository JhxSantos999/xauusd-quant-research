import type { Candle } from '../data/contracts.js';
import { extractFeatureRowsV1, type FeatureRowV1 } from '../features/extractor.js';
import { generateLabelsV1, type LabeledSampleV1 } from '../ml/labeling.js';
import { isolatePrecedingPartition, generateEndAlignedFolds, inWindow, type FoldWindow, type IsolationCounts } from '../walkforward/orchestrator.js';
import { fitLogisticV1, predictLogisticV1 } from '../models/logistic.js';
import { fitPlattV1, calibrateV1 } from '../calibration/platt.js';
import { calculateProbabilityMetricsV1, type ProbabilityMetricsV1 } from '../metrics/calculator.js';
import { selectLabelCandidateV1 } from '../selection/selector.js';
import { validateNestedProcedureV1 } from '../research/nested-validation.js';
import { FROZEN_H_GRID_V1, FROZEN_TAU_GRID_V1, type NestedGeometryV1 } from '../research/frozen-contracts.js';
import type { InnerCandidateEvidenceV1, InnerFoldEvidenceV1, LabelSelectionEvidenceV1, NestedValidationEvidenceV1, OosPredictionV1, OuterFoldEvidenceV1 } from '../evidence/types.js';

interface FeatureLabelPairV1 {
  readonly sample: LabeledSampleV1 & { readonly status: 'VALID'; readonly label: 0 | 1 };
  readonly feature: FeatureRowV1;
}

export interface FoldGeometryEvidenceV1 {
  readonly outerFoldId: string;
  readonly outer: FoldWindow;
  readonly development: FoldWindow;
  readonly calibration: FoldWindow;
  readonly oos: FoldWindow;
  readonly inner: readonly {
    readonly innerFoldId: string;
    readonly full: FoldWindow;
    readonly train: FoldWindow;
    readonly calibration: FoldWindow;
    readonly oos: FoldWindow;
  }[];
}

export interface OuterRefitEvidenceV1 {
  readonly outerFoldId: string;
  readonly status: 'REFIT_COMPLETED' | 'NO_VALID_LABEL_SPEC_V1' | 'OUTER_INTEGRITY_FAIL';
  readonly selected?: { readonly h: number; readonly tau: number };
  readonly counts?: { readonly train: IsolationCounts; readonly calibration: IsolationCounts; readonly oos: number };
  readonly baselineProbability?: number;
  readonly trainClass0?: number;
  readonly trainClass1?: number;
  readonly calibrationClass0?: number;
  readonly calibrationClass1?: number;
  readonly modelIterations?: number;
  readonly calibrationIterations?: number;
}

export interface OuterMetricsEvidenceV1 {
  readonly outerFoldId: string;
  readonly rawMetrics: ProbabilityMetricsV1;
  readonly calibratedMetrics: ProbabilityMetricsV1;
  readonly baselineMetrics: ProbabilityMetricsV1;
  readonly brierSkill: number;
  readonly logLossSkill: number;
  readonly retentionRate: number;
}

export interface NestedExperimentResultV1 {
  readonly attemptedInnerEvaluations: number;
  readonly completedInnerEvaluations: number;
  readonly invalidInnerEvaluations: number;
  readonly outerFoldGeometry: readonly FoldGeometryEvidenceV1[];
  readonly innerCandidateEvidence: readonly { readonly outerFoldId: string; readonly candidates: readonly InnerCandidateEvidenceV1[] }[];
  readonly innerSelectionEvidence: readonly { readonly outerFoldId: string; readonly selection: LabelSelectionEvidenceV1 }[];
  readonly outerRefitEvidence: readonly OuterRefitEvidenceV1[];
  readonly outerOosPredictions: readonly (OosPredictionV1 & { readonly outerFoldId: string; readonly selectedH: number; readonly selectedTau: number })[];
  readonly outerOosMetrics: readonly OuterMetricsEvidenceV1[];
  readonly nestedValidation: NestedValidationEvidenceV1;
}

const NAN_METRICS: ProbabilityMetricsV1 = { brier: Number.NaN, logLoss: Number.NaN, ece: Number.NaN, auc: null };

function classCounts(samples: readonly FeatureLabelPairV1[]): { class0: number; class1: number } {
  let class0 = 0;
  let class1 = 0;
  for (const pair of samples) pair.sample.label === 0 ? class0++ : class1++;
  return { class0, class1 };
}
function skill(model: number, baseline: number): number { return baseline > 0 ? 1 - model / baseline : Number.NaN; }

function featureLabelPairs(labels: readonly LabeledSampleV1[], featuresByDecisionTime: ReadonlyMap<number, FeatureRowV1>, window: FoldWindow): { readonly allEligible: readonly LabeledSampleV1[]; readonly valid: readonly FeatureLabelPairV1[] } {
  const allEligible: LabeledSampleV1[] = [];
  const valid: FeatureLabelPairV1[] = [];
  for (const sample of labels) {
    if (!inWindow(sample.decisionTime, window)) continue;
    const feature = featuresByDecisionTime.get(sample.decisionTime);
    if (!feature) continue;
    allEligible.push(sample);
    if (sample.status === 'VALID') valid.push({ sample: sample as FeatureLabelPairV1['sample'], feature });
  }
  return { allEligible, valid };
}
function isolatePairs(pairs: readonly FeatureLabelPairV1[], boundary: number, embargoMs: number): { readonly pairs: readonly FeatureLabelPairV1[]; readonly counts: IsolationCounts } {
  const isolated = isolatePrecedingPartition(pairs.map((pair) => ({ ...pair, decisionTime: pair.sample.decisionTime, labelEnd: pair.sample.labelEnd })), boundary, embargoMs);
  return { pairs: isolated.samples, counts: isolated.counts };
}
function buildPredictions(samples: readonly FeatureLabelPairV1[], raw: readonly number[], calibrated: readonly number[], baselineProbability: number): OosPredictionV1[] {
  return samples.map((pair, index) => ({ asset: 'XAUUSD', decisionTime: pair.sample.decisionTime, actualLabel: pair.sample.label, rawProbability: raw[index]!, calibratedProbability: calibrated[index]!, baselineProbability }));
}

function evaluateInnerFold(labels: readonly LabeledSampleV1[], featuresByDecisionTime: ReadonlyMap<number, FeatureRowV1>, innerFoldId: string, trainWindow: FoldWindow, calibrationWindow: FoldWindow, oosWindow: FoldWindow, embargoMs: number): { readonly evidence: InnerFoldEvidenceV1; readonly valid: boolean } {
  const trainBase = featureLabelPairs(labels, featuresByDecisionTime, trainWindow);
  const calibrationBase = featureLabelPairs(labels, featuresByDecisionTime, calibrationWindow);
  const oosBase = featureLabelPairs(labels, featuresByDecisionTime, oosWindow);
  const train = isolatePairs(trainBase.valid, calibrationWindow.start, embargoMs);
  const calibration = isolatePairs(calibrationBase.valid, oosWindow.start, embargoMs);
  const oos = oosBase.valid;
  const trainClasses = classCounts(train.pairs);
  const calibrationClasses = classCounts(calibration.pairs);
  const integrityReasons: string[] = [];
  if (train.pairs.length === 0) integrityReasons.push('EMPTY_TRAIN');
  if (calibration.pairs.length === 0) integrityReasons.push('EMPTY_CALIBRATION');
  if (oos.length === 0) integrityReasons.push('EMPTY_OOS');
  if (trainClasses.class0 === 0 || trainClasses.class1 === 0) integrityReasons.push('SINGLE_CLASS_TRAIN');
  if (calibrationClasses.class0 === 0 || calibrationClasses.class1 === 0) integrityReasons.push('SINGLE_CLASS_CALIBRATION');
  if (integrityReasons.length > 0) {
    return { valid: false, evidence: { innerFoldId, trainCount: train.pairs.length, calibrationCount: calibration.pairs.length, oosCount: oos.length, trainClass0: trainClasses.class0, trainClass1: trainClasses.class1, calibrationClass0: calibrationClasses.class0, calibrationClass1: calibrationClasses.class1, lineageValid: true, windowsValid: true, lockboxValid: true, requiredEvidencePresent: true, calibratedBrierSkill: Number.NaN, calibratedLogLossSkill: Number.NaN, oosPredictions: [], retentionNumerator: oos.length, retentionDenominator: oosBase.allEligible.length, isolation: { train: train.counts, calibration: calibration.counts }, integrityReasons } };
  }
  const trainX = train.pairs.map((pair) => pair.feature.vector);
  const trainY = train.pairs.map((pair) => pair.sample.label);
  const calibrationX = calibration.pairs.map((pair) => pair.feature.vector);
  const calibrationY = calibration.pairs.map((pair) => pair.sample.label);
  const oosX = oos.map((pair) => pair.feature.vector);
  const oosY = oos.map((pair) => pair.sample.label);
  const baselineProbability = trainY.reduce<number>((sum, label) => sum + label, 0) / trainY.length;
  const model = fitLogisticV1(trainX, trainY);
  const calibrationRaw = predictLogisticV1(model, calibrationX);
  const calibrator = fitPlattV1(calibrationRaw, calibrationY);
  const raw = predictLogisticV1(model, oosX);
  const calibrated = calibrateV1(calibrator, raw);
  const predictions = buildPredictions(oos, raw, calibrated, baselineProbability);
  const baselineArray = new Array<number>(oosY.length).fill(baselineProbability);
  const rawMetrics = calculateProbabilityMetricsV1(oosY, raw);
  const calibratedMetrics = calculateProbabilityMetricsV1(oosY, calibrated);
  const baselineMetrics = calculateProbabilityMetricsV1(oosY, baselineArray);
  return { valid: true, evidence: { innerFoldId, trainCount: train.pairs.length, calibrationCount: calibration.pairs.length, oosCount: oos.length, trainClass0: trainClasses.class0, trainClass1: trainClasses.class1, calibrationClass0: calibrationClasses.class0, calibrationClass1: calibrationClasses.class1, lineageValid: true, windowsValid: true, lockboxValid: true, requiredEvidencePresent: true, calibratedBrierSkill: skill(calibratedMetrics.brier, baselineMetrics.brier), calibratedLogLossSkill: skill(calibratedMetrics.logLoss, baselineMetrics.logLoss), oosPredictions: predictions, rawMetrics, calibratedMetrics, baselineMetrics, baselineProbability, retentionNumerator: oos.length, retentionDenominator: oosBase.allEligible.length, isolation: { train: train.counts, calibration: calibration.counts } } };
}

function aggregateCandidate(h: number, tau: number, folds: readonly InnerFoldEvidenceV1[], allValid: boolean): InnerCandidateEvidenceV1 {
  const numerator = folds.reduce((sum, fold) => sum + (fold.retentionNumerator ?? 0), 0);
  const denominator = folds.reduce((sum, fold) => sum + (fold.retentionDenominator ?? 0), 0);
  if (!allValid) return { h, tau, folds, aggregateRawMetrics: NAN_METRICS, aggregateCalibratedMetrics: NAN_METRICS, aggregateBaselineMetrics: NAN_METRICS, aggregateCalibratedBrierSkill: Number.NaN, aggregateCalibratedLogLossSkill: Number.NaN, aggregateInnerOOSRetentionRate: denominator > 0 ? numerator / denominator : Number.NaN };
  const predictions = folds.flatMap((fold) => [...fold.oosPredictions]);
  const y = predictions.map((prediction) => prediction.actualLabel);
  const raw = predictions.map((prediction) => prediction.rawProbability);
  const calibrated = predictions.map((prediction) => prediction.calibratedProbability);
  const baseline = predictions.map((prediction) => prediction.baselineProbability);
  const rawMetrics = calculateProbabilityMetricsV1(y, raw);
  const calibratedMetrics = calculateProbabilityMetricsV1(y, calibrated);
  const baselineMetrics = calculateProbabilityMetricsV1(y, baseline);
  return { h, tau, folds, aggregateRawMetrics: rawMetrics, aggregateCalibratedMetrics: calibratedMetrics, aggregateBaselineMetrics: baselineMetrics, aggregateCalibratedBrierSkill: skill(calibratedMetrics.brier, baselineMetrics.brier), aggregateCalibratedLogLossSkill: skill(calibratedMetrics.logLoss, baselineMetrics.logLoss), aggregateInnerOOSRetentionRate: denominator > 0 ? numerator / denominator : Number.NaN };
}
function makeWindows(start: number, trainMs: number, calibrationMs: number, oosMs: number): { train: FoldWindow; calibration: FoldWindow; oos: FoldWindow } {
  const train = { start, end: start + trainMs };
  const calibration = { start: train.end, end: train.end + calibrationMs };
  const oos = { start: calibration.end, end: calibration.end + oosMs };
  return { train, calibration, oos };
}

export function runNestedExperimentV1(candles: readonly Candle[], geometry: NestedGeometryV1): NestedExperimentResultV1 {
  const featureRows = extractFeatureRowsV1(candles);
  const featuresByDecisionTime = new Map(featureRows.map((row) => [row.decisionTime, row] as const));
  const outerTotal = geometry.outer.trainDevMs + geometry.outer.calibrationMs + geometry.outer.oosMs;
  const outerFolds = generateEndAlignedFolds(geometry.domainEnd, outerTotal, geometry.outer.stepMs, geometry.outer.count);
  const outerFoldGeometry: FoldGeometryEvidenceV1[] = [];
  const innerCandidateEvidence: { outerFoldId: string; candidates: InnerCandidateEvidenceV1[] }[] = [];
  const innerSelectionEvidence: { outerFoldId: string; selection: LabelSelectionEvidenceV1 }[] = [];
  const outerRefitEvidence: OuterRefitEvidenceV1[] = [];
  const outerOosPredictions: (OosPredictionV1 & { outerFoldId: string; selectedH: number; selectedTau: number })[] = [];
  const outerOosMetrics: OuterMetricsEvidenceV1[] = [];
  const nestedInput: OuterFoldEvidenceV1[] = [];
  let attemptedInnerEvaluations = 0;
  let completedInnerEvaluations = 0;
  let invalidInnerEvaluations = 0;

  for (let outerIndex = 0; outerIndex < outerFolds.length; outerIndex++) {
    const outer = outerFolds[outerIndex]!;
    const outerFoldId = `OF_${String(outerIndex + 1).padStart(2, '0')}`;
    const development = { start: outer.start, end: outer.start + geometry.outer.trainDevMs };
    const outerCalibration = { start: development.end, end: development.end + geometry.outer.calibrationMs };
    const outerOos = { start: outerCalibration.end, end: outer.end };
    const innerTotal = geometry.inner.trainMs + geometry.inner.calibrationMs + geometry.inner.oosMs;
    const innerFull = generateEndAlignedFolds(development.end, innerTotal, geometry.inner.stepMs, geometry.inner.count);
    if (innerFull.length !== geometry.inner.count || innerFull[0]!.start < development.start || innerFull[innerFull.length - 1]!.end > development.end) throw new Error('INNER_GEOMETRY_OUTSIDE_OUTER_DEVELOPMENT');
    const innerGeometry = innerFull.map((full, innerIndex) => {
      const w = makeWindows(full.start, geometry.inner.trainMs, geometry.inner.calibrationMs, geometry.inner.oosMs);
      if (w.oos.end !== full.end) throw new Error('INNER_WINDOW_SUM_MISMATCH');
      return { innerFoldId: `IF_${String(outerIndex + 1).padStart(2, '0')}_${String(innerIndex + 1).padStart(2, '0')}`, full, ...w };
    });
    outerFoldGeometry.push({ outerFoldId, outer, development, calibration: outerCalibration, oos: outerOos, inner: innerGeometry });

    const candidates: InnerCandidateEvidenceV1[] = [];
    for (const h of FROZEN_H_GRID_V1) {
      for (const tau of FROZEN_TAU_GRID_V1) {
        const labels = generateLabelsV1(candles, h, tau);
        const foldEvidence: InnerFoldEvidenceV1[] = [];
        let allValid = true;
        for (const inner of innerGeometry) {
          attemptedInnerEvaluations++;
          const evaluated = evaluateInnerFold(labels, featuresByDecisionTime, inner.innerFoldId, inner.train, inner.calibration, inner.oos, geometry.embargoMs);
          foldEvidence.push(evaluated.evidence);
          if (evaluated.valid) completedInnerEvaluations++;
          else { invalidInnerEvaluations++; allValid = false; }
        }
        candidates.push(aggregateCandidate(h, tau, foldEvidence, allValid));
      }
    }
    if (candidates.length !== 16) throw new Error('CANDIDATE_GRID_SIZE_MISMATCH');
    innerCandidateEvidence.push({ outerFoldId, candidates });
    const selection = selectLabelCandidateV1(candidates);
    innerSelectionEvidence.push({ outerFoldId, selection });
    if (selection.status !== 'SELECTED') {
      outerRefitEvidence.push({ outerFoldId, status: 'NO_VALID_LABEL_SPEC_V1' });
      nestedInput.push({ outerFoldId, selectionStatus: 'NO_VALID_LABEL_SPEC_V1' });
      continue;
    }

    const selected = selection.selected!;
    const labels = generateLabelsV1(candles, selected.h, selected.tau);
    const trainBase = featureLabelPairs(labels, featuresByDecisionTime, development);
    const calibrationBase = featureLabelPairs(labels, featuresByDecisionTime, outerCalibration);
    const oosBase = featureLabelPairs(labels, featuresByDecisionTime, outerOos);
    const train = isolatePairs(trainBase.valid, outerCalibration.start, geometry.embargoMs);
    const calibration = isolatePairs(calibrationBase.valid, outerOos.start, geometry.embargoMs);
    const oos = oosBase.valid;
    const trainClasses = classCounts(train.pairs);
    const calibrationClasses = classCounts(calibration.pairs);
    const outerValid = train.pairs.length > 0 && calibration.pairs.length > 0 && oos.length > 0 && trainClasses.class0 > 0 && trainClasses.class1 > 0 && calibrationClasses.class0 > 0 && calibrationClasses.class1 > 0;
    if (!outerValid) {
      outerRefitEvidence.push({ outerFoldId, status: 'OUTER_INTEGRITY_FAIL', selected, counts: { train: train.counts, calibration: calibration.counts, oos: oos.length }, trainClass0: trainClasses.class0, trainClass1: trainClasses.class1, calibrationClass0: calibrationClasses.class0, calibrationClass1: calibrationClasses.class1 });
      nestedInput.push({ outerFoldId, selectionStatus: 'SELECTED', predictions: [] });
      continue;
    }
    const trainX = train.pairs.map((pair) => pair.feature.vector);
    const trainY = train.pairs.map((pair) => pair.sample.label);
    const calibrationX = calibration.pairs.map((pair) => pair.feature.vector);
    const calibrationY = calibration.pairs.map((pair) => pair.sample.label);
    const oosX = oos.map((pair) => pair.feature.vector);
    const oosY = oos.map((pair) => pair.sample.label);
    const baselineProbability = trainY.reduce<number>((sum, label) => sum + label, 0) / trainY.length;
    const model = fitLogisticV1(trainX, trainY);
    const calibrationRaw = predictLogisticV1(model, calibrationX);
    const calibrator = fitPlattV1(calibrationRaw, calibrationY);
    const raw = predictLogisticV1(model, oosX);
    const calibrated = calibrateV1(calibrator, raw);
    const predictions = buildPredictions(oos, raw, calibrated, baselineProbability);
    const decorated = predictions.map((prediction) => ({ ...prediction, outerFoldId, selectedH: selected.h, selectedTau: selected.tau }));
    outerOosPredictions.push(...decorated);
    const baselineArray = new Array<number>(oosY.length).fill(baselineProbability);
    const rawMetrics = calculateProbabilityMetricsV1(oosY, raw);
    const calibratedMetrics = calculateProbabilityMetricsV1(oosY, calibrated);
    const baselineMetrics = calculateProbabilityMetricsV1(oosY, baselineArray);
    const retentionRate = oosBase.allEligible.length > 0 ? oos.length / oosBase.allEligible.length : Number.NaN;
    outerOosMetrics.push({ outerFoldId, rawMetrics, calibratedMetrics, baselineMetrics, brierSkill: skill(calibratedMetrics.brier, baselineMetrics.brier), logLossSkill: skill(calibratedMetrics.logLoss, baselineMetrics.logLoss), retentionRate });
    outerRefitEvidence.push({ outerFoldId, status: 'REFIT_COMPLETED', selected, counts: { train: train.counts, calibration: calibration.counts, oos: oos.length }, baselineProbability, trainClass0: trainClasses.class0, trainClass1: trainClasses.class1, calibrationClass0: calibrationClasses.class0, calibrationClass1: calibrationClasses.class1, modelIterations: model.iterations, calibrationIterations: calibrator.iterations });
    nestedInput.push({ outerFoldId, selectionStatus: 'SELECTED', predictions, retentionRate });
  }

  const expectedAttempts = geometry.outer.count * FROZEN_H_GRID_V1.length * FROZEN_TAU_GRID_V1.length * geometry.inner.count;
  if (attemptedInnerEvaluations !== expectedAttempts) throw new Error(`INNER_ATTEMPT_COUNT_MISMATCH:${attemptedInnerEvaluations}:${expectedAttempts}`);
  if (attemptedInnerEvaluations !== completedInnerEvaluations + invalidInnerEvaluations) throw new Error('INNER_COUNTER_ACCOUNTING_MISMATCH');
  const nestedValidation = validateNestedProcedureV1(nestedInput);
  return { attemptedInnerEvaluations, completedInnerEvaluations, invalidInnerEvaluations, outerFoldGeometry, innerCandidateEvidence, innerSelectionEvidence, outerRefitEvidence, outerOosPredictions, outerOosMetrics, nestedValidation };
}
