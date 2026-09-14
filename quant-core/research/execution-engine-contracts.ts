export const EXECUTION_ENGINE_V1_SPEC_IDENTITY = {
  path: 'quant-core/research/execution_engine_v1.spec.json',
  bytes: 3520,
  sha256: 'PLACEHOLDER_SPEC_SHA256',
} as const;

export const EXECUTION_ENGINE_V1_IMPLEMENTATION_BINDING = {
  path: 'quant-core/research/execution_engine_v1.implementation.json',
  bytes: 0,
  sha256: 'PLACEHOLDER_BINDING_SHA256',
} as const;

export const FROZEN_EXECUTION_BROKER_METADATA_V1 = {
  broker: 'INFINOX',
  platform: 'MT5',
  accountType: 'STP',
  digits: 2,
  point: 0.01,
  contractSize: 100,
  stopsLevelPoints: 20,
  volumeMin: 0.01,
  volumeMax: 20,
  volumeStep: 0.01,
  commissionQuotePerLotPerSide: 0,
  fillPolicy: 'IOC',
  executionMode: 'MARKET',
  chartPriceSide: 'BID',
} as const;

export const AUDITED_RISK_ENGINE_V1 = {
  sourceCommit: 'a28aedd9f160581871d911240e94dc755281ddb6',
  spec: {
    path: 'quant-core/research/risk_engine_v1.spec.json',
    bytes: 1999,
    sha256: '93dd6c9a5ba4d1049b92cbb009d3f844bd1841f9049950bc551c6c3167b3b233',
  },
  implementationBinding: {
    path: 'quant-core/research/risk_engine_v1.implementation.json',
    bytes: 441,
    sha256: '6944ea3595bc680c08aaed019113195b6b7eca492da7f3b557cdb9c78857e1ff',
  },
} as const;

export const AUDITED_FINAL_SIGNAL_V1R1 = {
  executionId: 'final_signal_v1r1_20260913235306128',
  artifactManifestSemanticSha256: 'a4ee4aa9ab1af075aacdefa68919e4e81f0992e5d7b6219089006090d57f3b60',
  modelSha256: 'f4869afd3cfeb681bca356ee08d80a63fb617a841427932a571ff2e2306f7655',
  calibratorSha256: '6d851a2eaa61deaa00bc2bc7899ad40fabc5b8758cd58ed933782709996ac17c',
} as const;

export function assertFrozenExecutionBrokerMetadataV1(): void {
  const m = FROZEN_EXECUTION_BROKER_METADATA_V1;
  if (m.digits !== 2 || m.point !== 0.01 || m.contractSize !== 100) throw new Error('EXECUTION_V1_PRICE_CONTRACT_METADATA_CHANGED');
  if (m.stopsLevelPoints !== 20) throw new Error('EXECUTION_V1_STOPS_LEVEL_CHANGED');
  if (m.volumeMin !== 0.01 || m.volumeMax !== 20 || m.volumeStep !== 0.01) throw new Error('EXECUTION_V1_VOLUME_METADATA_CHANGED');
  if (m.commissionQuotePerLotPerSide !== 0) throw new Error('EXECUTION_V1_COMMISSION_CHANGED');
  if (m.fillPolicy !== 'IOC' || m.executionMode !== 'MARKET' || m.chartPriceSide !== 'BID') throw new Error('EXECUTION_V1_MARKET_MICROSTRUCTURE_CHANGED');
}

assertFrozenExecutionBrokerMetadataV1();
