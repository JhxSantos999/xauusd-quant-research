export const ECONOMIC_EVALUATION_V1_VERSION = 'economic_evaluation_v1' as const;

export const ECONOMIC_EVALUATION_V1_SPEC_IDENTITY = {
  path: 'quant-core/research/economic_evaluation_v1.spec.json',
  bytes: 3816,
  sha256: '2c750ec8532a5b137f08318ae066a83dda64f4616a09560f29a0662a44e7a9bd',
} as const;

export const ECONOMIC_EVALUATION_V1_LOCKBOX = {
  informationStart: 1_788_931_800_000,
  firstPotentialDecisionTime: 1_788_932_100_000,
  informationEnd: 1_796_707_800_000,
  timeframeMs: 300_000,
  calendarDays: 90,
} as const;

export const ECONOMIC_EVALUATION_V1_PRIMARY_ACCOUNT = {
  currency: 'USD',
  initialEquity: 10_000,
  compounding: 'CURRENT_EQUITY_AFTER_EACH_CLOSED_TRADE',
} as const;

export const ECONOMIC_EVALUATION_V1_PRIMARY_GATES = {
  minimumFilledTrades: 500,
  baseRequiresPositiveFinalEquityDelta: true,
  baseRequiresProfitFactorAboveOne: true,
  baseRequiresPositiveMeanRealizedR: true,
  stressHalfSpreadRequiresPositiveFinalEquityDelta: true,
  stressHalfSpreadRequiresProfitFactorAboveOne: true,
} as const;

export const ECONOMIC_EVALUATION_V1_SCENARIOS = [
  { name: 'BASE', slippageMultiplierOfSpreadPerFill: 0 },
  { name: 'STRESS_0_5X', slippageMultiplierOfSpreadPerFill: 0.5 },
  { name: 'STRESS_1_0X', slippageMultiplierOfSpreadPerFill: 1 },
] as const;

export const ECONOMIC_EVALUATION_V1_REQUIRED_MT5_FIELDS = [
  'SYMBOL_TRADE_TICK_SIZE',
  'SYMBOL_TRADE_TICK_VALUE',
  'SYMBOL_TRADE_TICK_VALUE_PROFIT',
  'SYMBOL_TRADE_TICK_VALUE_LOSS',
  'SYMBOL_TRADE_SESSIONS',
] as const;

export const AUDITED_EXECUTION_ENGINE_V1 = {
  sourceCommit: '288d16f0e00bbc39d21b4fe32b1322bc62195399',
  spec: {
    path: 'quant-core/research/execution_engine_v1.spec.json',
    bytes: 3200,
    sha256: '36222916f96cc5e1459281838199fbe6aac8b109e3a5a92e8115c08e5bf67f3d',
  },
  implementationBinding: {
    path: 'quant-core/research/execution_engine_v1.implementation.json',
    bytes: 657,
    sha256: '819c6deac5a21426c3db85e496215633031c9fa5d8e3382dacc68d33d0c29e86',
  },
} as const;

export const AUDITED_RISK_ENGINE_V1_FOR_ECONOMIC_EVAL = {
  sourceCommit: 'a28aedd9f160581871d911240e94dc755281ddb6',
  specSha256: '93dd6c9a5ba4d1049b92cbb009d3f844bd1841f9049950bc551c6c3167b3b233',
  implementationSha256: '6944ea3595bc680c08aaed019113195b6b7eca492da7f3b557cdb9c78857e1ff',
} as const;

export const AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_EVAL = {
  executionId: 'final_signal_v1r1_20260913235306128',
  artifactManifestSemanticSha256: 'a4ee4aa9ab1af075aacdefa68919e4e81f0992e5d7b6219089006090d57f3b60',
  modelSha256: 'f4869afd3cfeb681bca356ee08d80a63fb617a841427932a571ff2e2306f7655',
  calibratorSha256: '6d851a2eaa61deaa00bc2bc7899ad40fabc5b8758cd58ed933782709996ac17c',
} as const;

export function assertFrozenEconomicEvaluationV1(): void {
  const l = ECONOMIC_EVALUATION_V1_LOCKBOX;
  if (l.informationStart !== 1_788_931_800_000 || l.firstPotentialDecisionTime !== 1_788_932_100_000) {
    throw new Error('ECONOMIC_V1_LOCKBOX_START_CHANGED');
  }
  if (l.informationEnd !== 1_796_707_800_000 || l.calendarDays !== 90 || l.timeframeMs !== 300_000) {
    throw new Error('ECONOMIC_V1_LOCKBOX_END_CHANGED');
  }
  if (ECONOMIC_EVALUATION_V1_PRIMARY_ACCOUNT.initialEquity !== 10_000) {
    throw new Error('ECONOMIC_V1_PRIMARY_EQUITY_CHANGED');
  }
  if (ECONOMIC_EVALUATION_V1_PRIMARY_GATES.minimumFilledTrades !== 500) {
    throw new Error('ECONOMIC_V1_MIN_TRADES_CHANGED');
  }
  const scenarioSignature = ECONOMIC_EVALUATION_V1_SCENARIOS.map((s) => `${s.name}:${s.slippageMultiplierOfSpreadPerFill}`).join('|');
  if (scenarioSignature !== 'BASE:0|STRESS_0_5X:0.5|STRESS_1_0X:1') {
    throw new Error('ECONOMIC_V1_SCENARIOS_CHANGED');
  }
}

assertFrozenEconomicEvaluationV1();
