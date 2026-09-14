export const ECONOMIC_EVALUATION_V1R1_VERSION = 'economic_evaluation_v1r1' as const;

export const ECONOMIC_EVALUATION_V1R1_SPEC_IDENTITY = {
  path: 'quant-core/research/economic_evaluation_v1r1.spec.json',
  bytes: 3008,
  sha256: 'bfd8cd9ac3d92ef1a9b9156df059e08287e6fac602763b4bc8ed0ac491203dc2',
} as const;

export const EXECUTION_ENGINE_V1R1_SPEC_IDENTITY_FOR_ECONOMIC = {
  path: 'quant-core/research/execution_engine_v1r1.spec.json',
  bytes: 2629,
  sha256: '67599e377311717db43f5431da0188a4608d3d7e0c11e5419140b6691fc86539',
} as const;

export const EXECUTION_ENGINE_V1R1_IMPLEMENTATION_IDENTITY_FOR_ECONOMIC = {
  path: 'quant-core/research/execution_engine_v1r1.implementation.json',
  bytes: 969,
  sha256: '869b2ed49afa35919fc6c140f77cca40bf1d209395a11ce743c156385f41bddb',
} as const;

export const INFINOX_XAUUSD_MT5_METADATA_V1_IDENTITY = {
  path: 'quant-core/research/infinox_xauusd_mt5_metadata_v1.json',
  bytes: 1464,
  sha256: '17098ebb89f0cc71c621a070402892166cf5a31dc768732eec119d12b848cc8d',
} as const;

export const INFINOX_XAUUSD_RAW_CAPTURE_V1_IDENTITY = {
  bytes: 1877,
  sha256: '7b007014ee4ecaff8261f5ab3ef021b762ec990c41c0771dbf81a6330356bcb3',
} as const;

export const ECONOMIC_EVALUATION_V1R1_LOCKBOX = {
  informationStart: 1_788_931_800_000,
  firstPotentialDecisionTime: 1_788_932_100_000,
  informationEnd: 1_796_707_800_000,
  timeframeMs: 300_000,
  calendarDays: 90,
} as const;

export const ECONOMIC_EVALUATION_V1R1_PRIMARY_ACCOUNT = {
  currency: 'USD',
  initialEquity: 10_000,
  compounding: 'CURRENT_EQUITY_AFTER_EACH_CLOSED_TRADE',
} as const;

export const ECONOMIC_EVALUATION_V1R1_PRIMARY_GATES = {
  minimumFilledTrades: 500,
  baseRequiresPositiveFinalEquityDelta: true,
  baseRequiresProfitFactorAboveOne: true,
  baseRequiresPositiveMeanRealizedR: true,
  stressHalfSpreadRequiresPositiveFinalEquityDelta: true,
  stressHalfSpreadRequiresProfitFactorAboveOne: true,
} as const;

export const ECONOMIC_EVALUATION_V1R1_SCENARIOS = [
  { name: 'BASE', slippageMultiplierOfSpreadPerFill: 0 },
  { name: 'STRESS_0_5X', slippageMultiplierOfSpreadPerFill: 0.5 },
  { name: 'STRESS_1_0X', slippageMultiplierOfSpreadPerFill: 1 },
] as const;

export const AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R1 = {
  executionId: 'final_signal_v1r1_20260913235306128',
  artifactManifestSemanticSha256: 'a4ee4aa9ab1af075aacdefa68919e4e81f0992e5d7b6219089006090d57f3b60',
  modelSha256: 'f4869afd3cfeb681bca356ee08d80a63fb617a841427932a571ff2e2306f7655',
  calibratorSha256: '6d851a2eaa61deaa00bc2bc7899ad40fabc5b8758cd58ed933782709996ac17c',
} as const;

export function assertFrozenEconomicEvaluationV1R1(): void {
  const l = ECONOMIC_EVALUATION_V1R1_LOCKBOX;
  if (l.informationStart !== 1_788_931_800_000 || l.firstPotentialDecisionTime !== 1_788_932_100_000) throw new Error('ECONOMIC_V1R1_LOCKBOX_START_CHANGED');
  if (l.informationEnd !== 1_796_707_800_000 || l.calendarDays !== 90 || l.timeframeMs !== 300_000) throw new Error('ECONOMIC_V1R1_LOCKBOX_END_CHANGED');
  if (ECONOMIC_EVALUATION_V1R1_PRIMARY_ACCOUNT.initialEquity !== 10_000) throw new Error('ECONOMIC_V1R1_PRIMARY_EQUITY_CHANGED');
  if (ECONOMIC_EVALUATION_V1R1_PRIMARY_GATES.minimumFilledTrades !== 500) throw new Error('ECONOMIC_V1R1_MIN_TRADES_CHANGED');
  const scenarioSignature = ECONOMIC_EVALUATION_V1R1_SCENARIOS.map((s) => `${s.name}:${s.slippageMultiplierOfSpreadPerFill}`).join('|');
  if (scenarioSignature !== 'BASE:0|STRESS_0_5X:0.5|STRESS_1_0X:1') throw new Error('ECONOMIC_V1R1_SCENARIOS_CHANGED');
}

assertFrozenEconomicEvaluationV1R1();
