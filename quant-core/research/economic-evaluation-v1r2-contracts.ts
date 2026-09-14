export const ECONOMIC_EVALUATION_V1R2_VERSION = 'economic_evaluation_v1r2' as const;

export const ECONOMIC_EVALUATION_V1R2_SPEC_IDENTITY = {
  path: 'quant-core/research/economic_evaluation_v1r2.spec.json',
  bytes: 3462,
  sha256: 'd9dd61a13a7ec3293582d89ce1aa91ed9bc6e134828c609230e8bb2422726b61',
} as const;

export const EXECUTION_ENGINE_V1R2_SPEC_IDENTITY_FOR_ECONOMIC = {
  path: 'quant-core/research/execution_engine_v1r2.spec.json',
  bytes: 2576,
  sha256: 'f1d5f63966557a71c8f3bb8f020711f85e01a80a6dd285b08e4c2e5671428a5d',
} as const;

export const EXECUTION_ENGINE_V1R2_IMPLEMENTATION_IDENTITY_FOR_ECONOMIC = {
  path: 'quant-core/research/execution_engine_v1r2.implementation.json',
  bytes: 834,
  sha256: 'e164324dd76a0a9f23994b0a56e72938d80bc84f2fe33ed7433fb0a84ec5c2f3',
} as const;

export const EXECUTION_ENGINE_V1R2_SOURCE_IDENTITY_FOR_ECONOMIC = {
  path: 'quant-core/execution/execution-engine-v1r2.ts',
  bytes: 6267,
  sha256: 'e6dd3e0b4521b18372149bd9d8980ff2aec33f115e311f459e96ecf61dd5077e',
} as const;

export const INFINOX_STP_COMMISSION_EVIDENCE_V1_IDENTITY = {
  path: 'quant-core/research/infinox_stp_commission_evidence_v1.json',
  bytes: 1129,
  sha256: '9e8ca7ad6a33396527de6e78b63e304f53e34cb0b72df373b7f345ebd05fa796',
} as const;

export const INFINOX_XAUUSD_MT5_METADATA_V1_IDENTITY_FOR_V1R2 = {
  path: 'quant-core/research/infinox_xauusd_mt5_metadata_v1.json',
  bytes: 1464,
  sha256: '17098ebb89f0cc71c621a070402892166cf5a31dc768732eec119d12b848cc8d',
} as const;

export const INFINOX_XAUUSD_RAW_CAPTURE_V1_IDENTITY_FOR_V1R2 = {
  bytes: 1877,
  sha256: '7b007014ee4ecaff8261f5ab3ef021b762ec990c41c0771dbf81a6330356bcb3',
} as const;

export const ECONOMIC_EVALUATION_V1R2_LOCKBOX = {
  informationStart: 1_788_931_800_000,
  firstPotentialDecisionTime: 1_788_932_100_000,
  informationEnd: 1_796_707_800_000,
  timeframeMs: 300_000,
  calendarDays: 90,
} as const;

export const ECONOMIC_EVALUATION_V1R2_PRIMARY_ACCOUNT = {
  currency: 'USD',
  initialEquity: 10_000,
  compounding: 'CURRENT_EQUITY_AFTER_EACH_CLOSED_TRADE',
} as const;

export const ECONOMIC_EVALUATION_V1R2_PRIMARY_GATES = {
  minimumFilledTrades: 500,
  baseRequiresPositiveFinalEquityDelta: true,
  baseRequiresProfitFactorAboveOne: true,
  baseRequiresPositiveMeanRealizedR: true,
  stressHalfSpreadRequiresPositiveFinalEquityDelta: true,
  stressHalfSpreadRequiresProfitFactorAboveOne: true,
} as const;

export const ECONOMIC_EVALUATION_V1R2_SCENARIOS = [
  { name: 'BASE', slippageMultiplierOfSpreadPerFill: 0 },
  { name: 'STRESS_0_5X', slippageMultiplierOfSpreadPerFill: 0.5 },
  { name: 'STRESS_1_0X', slippageMultiplierOfSpreadPerFill: 1 },
] as const;

export const AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R2 = {
  executionId: 'final_signal_v1r1_20260913235306128',
  artifactManifestSemanticSha256: 'a4ee4aa9ab1af075aacdefa68919e4e81f0992e5d7b6219089006090d57f3b60',
  modelSha256: 'f4869afd3cfeb681bca356ee08d80a63fb617a841427932a571ff2e2306f7655',
  calibratorSha256: '6d851a2eaa61deaa00bc2bc7899ad40fabc5b8758cd58ed933782709996ac17c',
} as const;

export function assertFrozenEconomicEvaluationV1R2(): void {
  const l = ECONOMIC_EVALUATION_V1R2_LOCKBOX;
  if (l.informationStart !== 1_788_931_800_000 || l.firstPotentialDecisionTime !== 1_788_932_100_000) throw new Error('ECONOMIC_V1R2_LOCKBOX_START_CHANGED');
  if (l.informationEnd !== 1_796_707_800_000 || l.calendarDays !== 90 || l.timeframeMs !== 300_000) throw new Error('ECONOMIC_V1R2_LOCKBOX_END_CHANGED');
  if (ECONOMIC_EVALUATION_V1R2_PRIMARY_ACCOUNT.initialEquity !== 10_000) throw new Error('ECONOMIC_V1R2_PRIMARY_EQUITY_CHANGED');
  if (ECONOMIC_EVALUATION_V1R2_PRIMARY_GATES.minimumFilledTrades !== 500) throw new Error('ECONOMIC_V1R2_MIN_TRADES_CHANGED');
  const scenarioSignature = ECONOMIC_EVALUATION_V1R2_SCENARIOS.map((s) => `${s.name}:${s.slippageMultiplierOfSpreadPerFill}`).join('|');
  if (scenarioSignature !== 'BASE:0|STRESS_0_5X:0.5|STRESS_1_0X:1') throw new Error('ECONOMIC_V1R2_SCENARIOS_CHANGED');
}

assertFrozenEconomicEvaluationV1R2();
