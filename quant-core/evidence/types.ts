import type { ProbabilityMetricsV1 } from '../metrics/calculator.js';

export interface OosPredictionV1 {
  readonly decisionTime: number;
  readonly actualLabel: 0 | 1;
  readonly rawProbability: number;
  readonly calibratedProbability: number;
  readonly baselineProbability: number;
  readonly asset?: string;
}

export interface InnerFoldEvidenceV1 {
  readonly innerFoldId: string;
  readonly trainCount: number;
  readonly calibrationCount: number;
  readonly oosCount: number;
  readonly trainClass0: number;
  readonly trainClass1: number;
  readonly calibrationClass0: number;
  readonly calibrationClass1: number;
  readonly lineageValid: boolean;
  readonly windowsValid: boolean;
  readonly lockboxValid: boolean;
  readonly requiredEvidencePresent: boolean;
  readonly calibratedBrierSkill: number;
  readonly calibratedLogLossSkill: number;
  readonly oosPredictions: readonly OosPredictionV1[];
}

export interface InnerCandidateEvidenceV1 {
  readonly h: number;
  readonly tau: number;
  readonly folds: readonly InnerFoldEvidenceV1[];
  readonly aggregateRawMetrics: ProbabilityMetricsV1;
  readonly aggregateCalibratedMetrics: ProbabilityMetricsV1;
  readonly aggregateBaselineMetrics: ProbabilityMetricsV1;
  readonly aggregateCalibratedBrierSkill: number;
  readonly aggregateCalibratedLogLossSkill: number;
  readonly aggregateInnerOOSRetentionRate: number;
}

export interface Gate0ResultV1 {
  readonly pass: boolean;
  readonly reasons: readonly string[];
}

export interface CandidateGateTraceV1 {
  readonly h: number;
  readonly tau: number;
  readonly gate0: Gate0ResultV1;
  readonly gate1Pass: boolean;
  readonly gate2Pass: boolean;
  readonly gate3Pass: boolean;
}

export interface CommonSupportDiagnosticV1 {
  readonly h: number;
  readonly candidateTau: number;
  readonly challengerTau: number;
  readonly commonCount: number;
  readonly candidateDominated: boolean;
}

export interface LabelSelectionEvidenceV1 {
  readonly status: 'SELECTED' | 'NO_VALID_LABEL_SPEC_V1';
  readonly selected?: { readonly h: number; readonly tau: number };
  readonly candidateTrace: readonly CandidateGateTraceV1[];
  readonly gate3Survivors: readonly { readonly h: number; readonly tau: number }[];
  readonly paretoFrontier: readonly { readonly h: number; readonly tau: number }[];
  readonly postCommonSupportFrontier: readonly { readonly h: number; readonly tau: number }[];
  readonly commonSupportDiagnostics: readonly CommonSupportDiagnosticV1[];
}

export interface OuterFoldEvidenceV1 {
  readonly outerFoldId: string;
  readonly selectionStatus: 'SELECTED' | 'NO_VALID_LABEL_SPEC_V1';
  readonly predictions?: readonly OosPredictionV1[];
  readonly retentionRate?: number;
}

export interface NestedValidationEvidenceV1 {
  readonly status: 'VALIDATED_V1' | 'NOT_VALIDATED_V1';
  readonly rejectionReasons: readonly string[];
  readonly globalCalibratedMetrics?: ProbabilityMetricsV1;
  readonly globalBaselineMetrics?: ProbabilityMetricsV1;
  readonly globalBrierSkill?: number;
  readonly globalLogLossSkill?: number;
  readonly medianOuterBrierSkill?: number;
  readonly medianOuterLogLossSkill?: number;
  readonly diagnosticGlobalRawAuc?: number | null;
  readonly diagnosticGlobalCalibratedAuc?: number | null;
  readonly diagnosticMeanRetention?: number;
  readonly perOuterFold?: readonly {
    readonly outerFoldId: string;
    readonly brierSkill: number;
    readonly logLossSkill: number;
  }[];
}
