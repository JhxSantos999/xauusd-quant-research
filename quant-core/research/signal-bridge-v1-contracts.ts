export const SIGNAL_BRIDGE_V1_SPEC_IDENTITY = {
  path: 'quant-core/research/signal_bridge_v1.spec.json',
  bytes: 2480,
  sha256: '93320a196c8f43d604d8fbe4333f5ef761e47db41fac7e3b151598e98fa20027',
} as const;

export const SIGNAL_BRIDGE_V1_IMPLEMENTATION_IDENTITY = {
  path: 'quant-core/research/signal_bridge_v1.implementation.json',
  bytes: 1230,
  sha256: '109563d16ed7faa4610149c00086893d5b0cf18dff61b0e0947fe869913f2c57',
} as const;

export const SIGNAL_BRIDGE_V1_SOURCE_IDENTITY = {
  path: 'quant-core/bridge/signal-bridge-v1.ts',
  bytes: 13649,
  sha256: '5a9be8586679831610fd18e045d5efdf8f947ff12e2b95d3f66c77b95f961626',
} as const;

export const SIGNAL_BRIDGE_V1_FROZEN_UPSTREAM = {
  baseFrozenCommit: 'fb27b8c7c20d15ffe28342bd2d87f920fa008261',
  riskEngineV1SpecSha256: '93dd6c9a5ba4d1049b92cbb009d3f844bd1841f9049950bc551c6c3167b3b233',
  riskEngineV1SourceSha256: '3bf4f7c079c2748e25e22fe670c829a302b539162dd757c42ffda3e4c21a9bf0',
  finalSignalExecutionId: 'final_signal_v1r1_20260913235306128',
  finalSignalModelSha256: 'f4869afd3cfeb681bca356ee08d80a63fb617a841427932a571ff2e2306f7655',
  finalSignalCalibratorSha256: '6d851a2eaa61deaa00bc2bc7899ad40fabc5b8758cd58ed933782709996ac17c',
} as const;

export function assertFrozenSignalBridgeV1(): void {
  if (SIGNAL_BRIDGE_V1_SPEC_IDENTITY.bytes !== 2480
    || SIGNAL_BRIDGE_V1_SPEC_IDENTITY.sha256 !== '93320a196c8f43d604d8fbe4333f5ef761e47db41fac7e3b151598e98fa20027') {
    throw new Error('SIGNAL_BRIDGE_V1_SPEC_CHANGED');
  }
  if (SIGNAL_BRIDGE_V1_IMPLEMENTATION_IDENTITY.bytes !== 1230
    || SIGNAL_BRIDGE_V1_IMPLEMENTATION_IDENTITY.sha256 !== '109563d16ed7faa4610149c00086893d5b0cf18dff61b0e0947fe869913f2c57') {
    throw new Error('SIGNAL_BRIDGE_V1_IMPLEMENTATION_CHANGED');
  }
  if (SIGNAL_BRIDGE_V1_SOURCE_IDENTITY.bytes !== 13649
    || SIGNAL_BRIDGE_V1_SOURCE_IDENTITY.sha256 !== '5a9be8586679831610fd18e045d5efdf8f947ff12e2b95d3f66c77b95f961626') {
    throw new Error('SIGNAL_BRIDGE_V1_SOURCE_CHANGED');
  }
}

assertFrozenSignalBridgeV1();
