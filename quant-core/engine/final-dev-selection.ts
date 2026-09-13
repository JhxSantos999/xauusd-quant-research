import type { Candle } from '../data/contracts.js';
import { extractFeatureRowsV1, type FeatureRowV1 } from '../features/extractor.js';
import { generateLabelsV1, type LabeledSampleV1 } from '../ml/labeling.js';
import { isolatePrecedingPartition, generateEndAlignedFolds, inWindow, type FoldWindow, type IsolationCounts } from '../walkforward/orchestrator.js';
import { fitLogisticV1, predictLogisticV1 } from '../models/logistic.js';
import { fitPlattV1, calibrateV1 } from '../calibration/platt.js';
import { calculateProbabilityMetricsV1, type ProbabilityMetricsV1 } from '../metrics/calculator.js';
import { selectLabelCandidateForExpectedFoldCountV1 } from '../selection/selector-fold-count.js';
import { FROZEN_H_GRID_V1, FROZEN_TAU_GRID_V1 } from '../research/frozen-contracts.js';
import type { InnerCandidateEvidenceV1, InnerFoldEvidenceV1, LabelSelectionEvidenceV1, OosPredictionV1 } from '../evidence/types.js';

export interface FinalDevGeometryV1 {
  readonly domainEnd: number;
  readonly embargoMs: number;
  readonly trainMs: number;
  readonly calibrationMs: number;
  readonly oosMs: number;
  readonly stepMs: number;
  readonly count: number;
}

export interface FinalDevFoldGeometryEvidenceV1 {
  readonly finalDevFoldId: string;
  readonly full: FoldWindow;
  readonly train: FoldWindow;
  readonly calibration: FoldWindow;
  readonly oos: FoldWindow;
}

export interface FinalDevSelectionResultV1 {
  readonly attemptedEvaluations: number;
  readonly completedEvaluations: number;
  readonly invalidEvaluations: number;
  readonly finalDevFoldGeometry: readonly FinalDevFoldGeometryEvidenceV1[];
  readonly candidateEvidence: readonly InnerCandidateEvidenceV1[];
  readonly selectionEvidence: LabelSelectionEvidenceV1;
}

interface FeatureLabelPairV1 {
  readonly sample: LabeledSampleV1 & { readonly status: 'VALID'; readonly label: 0 | 1 };
  readonly feature: FeatureRowV1;
}

const NAN_METRICS: ProbabilityMetricsV1 = { brier: Number.NaN, logLoss: Number.NaN, ece: Number.NaN, auc: null };

function classCounts(samples: readonly FeatureLabelPairV1[]): { class0: number; class1: number } {
  let class0 = 0;
  let class1 = 0;
  for (const pair of samples) pair.sample.label === 0 ? class0++ : class1++;
  return { class0, class1 };
}

function skill(model: number, baseline: number): number {
  return baseline > 0 ? 1 - model / baseline : Number.NaN;
}

function featureLabelPairs(
  labels: readonly LabeledSampleV1[],
  featuresByDecisionTime: ReadonlyMap<number, FeatureRowV1>,
  window: FoldWindow,
): { readonly allEligible: readonly LabeledSampleV1[]; readonly valid: readonly FeatureLabelPairV1[] } {
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

function isolatePairs(
  pairs: readonly FeatureLabelPairV1[],
  boundary: number,
  embargoMs: number,
): { readonly pairs: readonly FeatureLabelPairV1[]; readonly counts: IsolationCounts } {
  const isolated = isolatePrecedingPartition(
    pairs.map((pair) => ({ ...pair, decisionTime: pair.sample.decisionTime, labelEnd: pair.sample.labelEnd })),
    boundary,
    embargoMs,
  );
  return { pairs: isolated.samples, counts: isolated.counts };
}

function buildPredictions(
  samples: readonly FeatureLabelPairV1[],
  raw: readonly number[],
  calibrated: readonly number[],
  baselineProbability: number,
): OosPredictionV1[] {
  return samples.map((pair, index) => ({
    asset: 'XAUUSD',
    decisionTime: pair.sample.decisionTime,
    actualLabel: pair.sample.label,
    rawProbability: raw[index]!,
    calibratedProbability: calibrated[index]!,
    baselineProbability,
  }));
}

function evaluateFinalDevFold(
  labels: readonly LabeledSampleV1[],
  featuresByDecisionTime: ReadonlyMap<number, FeatureRowV1>,
  finalDevFoldId: string,
  trainWindow: FoldWindow,
  calibrationWindow: FoldWindow,
  oosWindow: FoldWindow,
  embargoMs: number,
): { readonly evidence: InnerFoldEvidenceV1; readonly valid: boolean } {
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
    return {
      valid: false,
      evidence: {
        innerFoldId: finalDevFoldId,
        trainCount: train.pairs.length,
        calibrationCount: calibration.pairs.length,
        oosCount: oos.length,
        trainClass0: trainClasses.class0,
        trainClass1: trainClasses.class1,
        calibrationClass0: calibrationClasses.class0,
        calibrationClass1: calibrationClasses.class1,
        lineageValid: true,
        windowsValid: true,
        lockboxValid: true,
        requiredEvidencePresent: true,
        calibratedBrierSkill: Number.NaN,
        calibratedLogLossSkill: Number.NaN,
        oosPredictions: [],
        retentionNumerator: oos.length,
        retentionDenominator: oosBase.allEligible.length,
        isolation: { train: train.counts, calibration: calibration.counts },
        integrityReasons,
      },
    };
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
  return {
    valid: true,
    evidence: {
      innerFoldId: finalDevFoldId,
      trainCount: train.pairs.length,
      calibrationCount: calibration.pairs.length,
      oosCount: oos.length,
      trainClass0: trainClasses.class0,
      trainClass1: trainClasses.class1,
      calibrationClass0: calibrationClasses.class0,
      calibrationClass1: calibrationClasses.class1,
      lineageValid: true,
      windowsValid: true,
      lockboxValid: true,
      requiredEvidencePresent: true,
      calibratedBrierSkill: skill(calibratedMetrics.brier, baselineMetrics.brier),
      calibratedLogLossSkill: skill(calibratedMetrics.logLoss, baselineMetrics.logLoss),
      oosPredictions: predictions,
      rawMetrics,
      calibratedMetrics,
      baselineMetrics,
      baselineProbability,
      retentionNumerator: oos.length,
      retentionDenominator: oosBase.allEligible.length,
      isolation: { train: train.counts, calibration: calibration.counts },
    },
  };
}

function aggregateCandidate(
  h: number,
  tau: number,
  folds: readonly InnerFoldEvidenceV1[],
  allValid: boolean,
): InnerCandidateEvidenceV1 {
  const numerator = folds.reduce((sum, fold) => sum + (fold.retentionNumerator ?? 0), 0);
  const denominator = folds.reduce((sum, fold) => sum + (fold.retentionDenominator ?? 0), 0);
  if (!allValid) {
    return {
      h,
      tau,
      folds,
      aggregateRawMetrics: NAN_METRICS,
      aggregateCalibratedMetrics: NAN_METRICS,
      aggregateBaselineMetrics: NAN_METRICS,
      aggregateCalibratedBrierSkill: Number.NaN,
      aggregateCalibratedLogLossSkill: Number.NaN,
      aggregateInnerOOSRetentionRate: denominator > 0 ? numerator / denominator : Number.NaN,
    };
  }
  const predictions = folds.flatMap((fold) => [...fold.oosPredictions]);
  const y = predictions.map((prediction) => prediction.actualLabel);
  const raw = predictions.map((prediction) => prediction.rawProbability);
  const calibrated = predictions.map((prediction) => prediction.calibratedProbability);
  const baseline = predictions.map((prediction) => prediction.baselineProbability);
  const rawMetrics = calculateProbabilityMetricsV1(y, raw);
  const calibratedMetrics = calculateProbabilityMetricsV1(y, calibrated);
  const baselineMetrics = calculateProbabilityMetricsV1(y, baseline);
  return {
    h,
    tau,
    folds,
    aggregateRawMetrics: rawMetrics,
    aggregateCalibratedMetrics: calibratedMetrics,
    aggregateBaselineMetrics: baselineMetrics,
    aggregateCalibratedBrierSkill: skill(calibratedMetrics.brier, baselineMetrics.brier),
    aggregateCalibratedLogLossSkill: skill(calibratedMetrics.logLoss, baselineMetrics.logLoss),
    aggregateInnerOOSRetentionRate: denominator > 0 ? numerator / denominator : Number.NaN,
  };
}

function makeWindows(
  start: number,
  trainMs: number,
  calibrationMs: number,
  oosMs: number,
): { train: FoldWindow; calibration: FoldWindow; oos: FoldWindow } {
  const train = { start, end: start + trainMs };
  const calibration = { start: train.end, end: train.end + calibrationMs };
  const oos = { start: calibration.end, end: calibration.end + oosMs };
  return { train, calibration, oos };
}

export function runFinalDevSelectionV1(
  candles: readonly Candle[],
  geometry: FinalDevGeometryV1,
): FinalDevSelectionResultV1 {
  if (!Number.isInteger(geometry.count) || geometry.count <= 0) throw new Error('INVALID_FINAL_DEV_FOLD_COUNT');
  if (![geometry.domainEnd, geometry.trainMs, geometry.calibrationMs, geometry.oosMs, geometry.stepMs, geometry.embargoMs]
    .every((value) => Number.isFinite(value))) throw new Error('INVALID_FINAL_DEV_GEOMETRY');
  if (geometry.trainMs <= 0 || geometry.calibrationMs <= 0 || geometry.oosMs <= 0 || geometry.stepMs <= 0 || geometry.embargoMs < 0) throw new Error('INVALID_FINAL_DEV_GEOMETRY');
  if (geometry.stepMs < geometry.oosMs) throw new Error('FINAL_DEV_OOS_OVERLAP_NOT_ALLOWED');

  const featureRows = extractFeatureRowsV1(candles);
  const featuresByDecisionTime = new Map(featureRows.map((row) => [row.decisionTime, row] as const));
  const total = geometry.trainMs + geometry.calibrationMs + geometry.oosMs;
  const fullFolds = generateEndAlignedFolds(geometry.domainEnd, total, geometry.stepMs, geometry.count);
  if (fullFolds.length !== geometry.count) throw new Error('FINAL_DEV_FOLD_COUNT_MISMATCH');

  const finalDevFoldGeometry = fullFolds.map((full, index) => {
    const windows = makeWindows(full.start, geometry.trainMs, geometry.calibrationMs, geometry.oosMs);
    if (windows.oos.end !== full.end) throw new Error('FINAL_DEV_WINDOW_SUM_MISMATCH');
    return { finalDevFoldId: `FD_${String(index + 1).padStart(2, '0')}`, full, ...windows };
  });

  const candidateEvidence: InnerCandidateEvidenceV1[] = [];
  let attemptedEvaluations = 0;
  let completedEvaluations = 0;
  let invalidEvaluations = 0;

  for (const h of FROZEN_H_GRID_V1) {
    for (const tau of FROZEN_TAU_GRID_V1) {
      const labels = generateLabelsV1(candles, h, tau);
      const folds: InnerFoldEvidenceV1[] = [];
      let allValid = true;
      for (const fold of finalDevFoldGeometry) {
        attemptedEvaluations++;
        const evaluated = evaluateFinalDevFold(
          labels,
          featuresByDecisionTime,
          fold.finalDevFoldId,
          fold.train,
          fold.calibration,
          fold.oos,
          geometry.embargoMs,
        );
        folds.push(evaluated.evidence);
        completedEvaluations++;
        if (!evaluated.valid) {
          invalidEvaluations++;
          allValid = false;
        }
      }
      candidateEvidence.push(aggregateCandidate(h, tau, folds, allValid));
    }
  }

  const expectedEvaluations = FROZEN_H_GRID_V1.length * FROZEN_TAU_GRID_V1.length * geometry.count;
  if (candidateEvidence.length !== FROZEN_H_GRID_V1.length * FROZEN_TAU_GRID_V1.length) throw new Error('FINAL_DEV_CANDIDATE_GRID_SIZE_MISMATCH');
  if (attemptedEvaluations !== expectedEvaluations || completedEvaluations !== expectedEvaluations) throw new Error('FINAL_DEV_EVALUATION_ACCOUNTING_MISMATCH');
  if (invalidEvaluations < 0 || invalidEvaluations > completedEvaluations) throw new Error('FINAL_DEV_INVALID_EVALUATION_ACCOUNTING');

  const selectionEvidence = selectLabelCandidateForExpectedFoldCountV1(candidateEvidence, geometry.count);
  return {
    attemptedEvaluations,
    completedEvaluations,
    invalidEvaluations,
    finalDevFoldGeometry,
    candidateEvidence,
    selectionEvidence,
  };
}
