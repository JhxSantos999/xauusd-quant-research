export const ECONOMIC_LOCKBOX_RUNNER_V1R2_VERSION = 'economic_lockbox_runner_v1r2' as const;

export const ECONOMIC_LOCKBOX_RUNNER_V1R2_SPEC_IDENTITY = {
  path: 'quant-core/research/economic_lockbox_runner_v1r2.spec.json',
  bytes: 3351,
  sha256: '2c1a7aeb1745fcde9373736254c69b91c8836a2beb7e97461041e8c9c0208dcd',
} as const;

export const ECONOMIC_LOCKBOX_RUNNER_V1R2_IMPLEMENTATION_IDENTITY = {
  path: 'quant-core/research/economic_lockbox_runner_v1r2.implementation.json',
  bytes: 2110,
  sha256: '5f176e22487b13f22921590786867a7c6f6d59e37f68620c73d22e2879a66724',
} as const;

export const ECONOMIC_LOCKBOX_RUNNER_V1R2_SOURCE_IDENTITIES = {
  execution: { path: 'quant-core/execution/execution-engine-v1r2.ts', bytes: 6267, sha256: 'e6dd3e0b4521b18372149bd9d8980ff2aec33f115e311f459e96ecf61dd5077e' },
  evaluator: { path: 'quant-core/economic/economic-lockbox-evaluator-v1r2.ts', bytes: 12690, sha256: '27dafaf7925986e16322d0d8cb8dc930b953463cee64b1620518e0a9f273bb72' },
  registry: { path: 'quant-core/lockbox/one-shot-registry-v1r2.ts', bytes: 3335, sha256: 'cbb959a178e03c7573ef43b2d335400cb6f01f0fbd0c03d8967e6a4606d38a0f' },
  preflight: { path: 'quant-core/cli/run-economic-preflight-v1r2.ts', bytes: 8564, sha256: 'ba97d9e748346ff95f06be875dd819f1e4ac05a9ac2a925182af3722628a6acf' },
  coreRunner: { path: 'quant-core/cli/run-economic-lockbox-v1r2.ts', bytes: 21273, sha256: '34189984c97fcc1a4179e25dc35d37d2abb348885b733f485558dcb4034a5e6e' },
  productionRunner: { path: 'quant-core/cli/run-economic-lockbox-v1r2-production.ts', bytes: 1427, sha256: 'f6807670d20595a6889daddb0ac7c80fe0e7b9a4e02bce05cbb4ed78bb2a599d' },
} as const;

export const ECONOMIC_LOCKBOX_RUNNER_V1R2_INFORMATION_END = 1_796_707_800_000;

export function assertFrozenEconomicLockboxRunnerV1R2(): void {
  if (ECONOMIC_LOCKBOX_RUNNER_V1R2_SPEC_IDENTITY.bytes !== 3351
    || ECONOMIC_LOCKBOX_RUNNER_V1R2_SPEC_IDENTITY.sha256 !== '2c1a7aeb1745fcde9373736254c69b91c8836a2beb7e97461041e8c9c0208dcd') {
    throw new Error('ECONOMIC_LOCKBOX_RUNNER_V1R2_SPEC_CHANGED');
  }
  if (ECONOMIC_LOCKBOX_RUNNER_V1R2_INFORMATION_END !== 1_796_707_800_000) {
    throw new Error('ECONOMIC_LOCKBOX_RUNNER_V1R2_INFORMATION_END_CHANGED');
  }
}

assertFrozenEconomicLockboxRunnerV1R2();
