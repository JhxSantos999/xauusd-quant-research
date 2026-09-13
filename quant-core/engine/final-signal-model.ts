import type { Candle } from '../data/contracts.js';
import { extractFeatureRowsV1, type FeatureRowV1 } from '../features/extractor.js';
import { generateLabelsV1, type LabeledSampleV1 } from '../ml/labeling.js';
import { isolatePrecedingPartition, inWindow, type FoldWindow, type IsolationCounts } from '../walkforward/orchestrator.js';
import { fitLogisticV1, predictLogisticV1, type TrainedLogisticV1 } from '../models/logistic.js';
import { fitPlattV1, type PlattCalibratorV1 } from '../calibration/platt.js';
import type { FinalSignalFitGeometryV1R1 } from '../research/final-signal-contracts.js';

interface FeatureLabelPairV1 {
  readonly sample: LabeledSampleV1 & { readonly status: 'VALID'; readonly label: 0 | 1 };
  readonly feature: FeatureRowV1;
}

export interface FinalSignalFitEvidenceV1R1 {
  readonly status: 'FIT_COMPLETED';
  readonly selectedLabelSpec: { readonly h: number; readonly tau: number };
  readonly trainWindow: FoldWindow;
  readonly calibrationWindow: FoldWindow;
  readonly trainIsolation: IsolationCounts;
  readonly calibrationIsolation: IsolationCounts;
  readonly trainCount: number;
  readonly calibrationCount: number;
  readonly trainClass0: number;
  readonly trainClass1: number;
  readonly calibrationClass0: number;
  readonly calibrationClass1: number;
  readonly trainPositivePrevalence: number;
  readonly trainMaxLabelEnd: number;
  readonly calibrationMaxLabelEnd: number;
  readonly model: TrainedLogisticV1;
  readonly calibrator: PlattCalibratorV1;
}

function classCounts(samples: readonly FeatureLabelPairV1[]): { class0: number; class1: number } {
  let class0 = 0;
  let class1 = 0;
  for (const pair of samples) pair.sample.label === 0 ? class0++ : class1++;
  return { class0, class1 };
}

function featureLabelPairs(
  labels: readonly LabeledSampleV1[],
  featuresByDecisionTime: ReadonlyMap<number, FeatureRowV1>,
  window: FoldWindow,
): FeatureLabelPairV1[] {
  const valid: FeatureLabelPairV1[] = [];
  for (const sample of labels) {
    if (!inWindow(sample.decisionTime, window)) continue;
    const feature = featuresByDecisionTime.get(sample.decisionTime);
    if (!feature || sample.status !== 'VALID') continue;
    valid.push({ sample: sample as FeatureLabelPairV1['sample'], feature });
  }
  return valid;
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

function maxLabelEnd(pairs: readonly FeatureLabelPairV1[]): number {
  if (pairs.length === 0) throw new Error('EMPTY_FINAL_SIGNAL_PARTITION');
  let value = Number.NEGATIVE_INFINITY;
  for (const pair of pairs) if (pair.sample.labelEnd > value) value = pair.sample.labelEnd;
  return value;
}

export function fitFinalSignalModelV1R1(
  candles: readonly Candle[],
  geometry: FinalSignalFitGeometryV1R1,
): FinalSignalFitEvidenceV1R1 {
  if (![geometry.domainEnd, geometry.embargoMs, geometry.trainMs, geometry.calibrationMs, geometry.h, geometry.tau].every(Number.isFinite)) throw new Error('INVALID_FINAL_SIGNAL_GEOMETRY');
  if (geometry.trainMs <= 0 || geometry.calibrationMs <= 0 || geometry.embargoMs < 0) throw new Error('INVALID_FINAL_SIGNAL_GEOMETRY');
  if (!Number.isInteger(geometry.h) || geometry.h <= 0 || geometry.tau < 0) throw new Error('INVALID_FINAL_SIGNAL_LABEL_SPEC');

  const calibrationWindow: FoldWindow = {
    start: geometry.domainEnd - geometry.calibrationMs,
    end: geometry.domainEnd,
  };
  const trainWindow: FoldWindow = {
    start: calibrationWindow.start - geometry.trainMs,
    end: calibrationWindow.start,
  };

  const featureRows = extractFeatureRowsV1(candles);
  const featuresByDecisionTime = new Map(featureRows.map((row) => [row.decisionTime, row] as const));
  const labels = generateLabelsV1(candles, geometry.h, geometry.tau);

  const trainBase = featureLabelPairs(labels, featuresByDecisionTime, trainWindow);
  const calibrationBase = featureLabelPairs(labels, featuresByDecisionTime, calibrationWindow);
  const train = isolatePairs(trainBase, calibrationWindow.start, geometry.embargoMs);
  const calibration = isolatePairs(calibrationBase, geometry.domainEnd, geometry.embargoMs);
  if (train.pairs.length === 0) throw new Error('EMPTY_FINAL_SIGNAL_TRAIN');
  if (calibration.pairs.length === 0) throw new Error('EMPTY_FINAL_SIGNAL_CALIBRATION');

  const trainClasses = classCounts(train.pairs);
  const calibrationClasses = classCounts(calibration.pairs);
  if (trainClasses.class0 === 0 || trainClasses.class1 === 0) throw new Error('SINGLE_CLASS_FINAL_SIGNAL_TRAIN');
  if (calibrationClasses.class0 === 0 || calibrationClasses.class1 === 0) throw new Error('SINGLE_CLASS_FINAL_SIGNAL_CALIBRATION');

  const trainX = train.pairs.map((pair) => pair.feature.vector);
  const trainY = train.pairs.map((pair) => pair.sample.label);
  const calibrationX = calibration.pairs.map((pair) => pair.feature.vector);
  const calibrationY = calibration.pairs.map((pair) => pair.sample.label);
  const trainPositivePrevalence = trainY.reduce<number>((sum, label) => sum + label, 0) / trainY.length;

  const model = fitLogisticV1(trainX, trainY);
  const calibrationRaw = predictLogisticV1(model, calibrationX);
  const calibrator = fitPlattV1(calibrationRaw, calibrationY);

  const trainMaxLabelEnd = maxLabelEnd(train.pairs);
  const calibrationMaxLabelEnd = maxLabelEnd(calibration.pairs);
  if (trainMaxLabelEnd > calibrationWindow.start - geometry.embargoMs) throw new Error('FINAL_SIGNAL_TRAIN_ISOLATION_VIOLATION');
  if (calibrationMaxLabelEnd > geometry.domainEnd - geometry.embargoMs) throw new Error('FINAL_SIGNAL_CALIBRATION_ISOLATION_VIOLATION');

  return {
    status: 'FIT_COMPLETED',
    selectedLabelSpec: { h: geometry.h, tau: geometry.tau },
    trainWindow,
    calibrationWindow,
    trainIsolation: train.counts,
    calibrationIsolation: calibration.counts,
    trainCount: train.pairs.length,
    calibrationCount: calibration.pairs.length,
    trainClass0: trainClasses.class0,
    trainClass1: trainClasses.class1,
    calibrationClass0: calibrationClasses.class0,
    calibrationClass1: calibrationClasses.class1,
    trainPositivePrevalence,
    trainMaxLabelEnd,
    calibrationMaxLabelEnd,
    model,
    calibrator,
  };
}
