export const ECONOMIC_LOCKBOX_RUNNER_V1R1_VERSION = 'economic_lockbox_runner_v1r1' as const;

export const ECONOMIC_LOCKBOX_RUNNER_V1R1_SPEC_IDENTITY = {
  path: 'quant-core/research/economic_lockbox_runner_v1r1.spec.json',
  bytes: 4216,
  sha256: 'c6b5d9278dac57bb7f5364132433b1d348fc80767fc57ecdae42db42656aca90',
} as const;

export const ECONOMIC_LOCKBOX_RUNNER_V1R1_IMPLEMENTATION_IDENTITY = {
  path: 'quant-core/research/economic_lockbox_runner_v1r1.implementation.json',
  bytes: 1067,
  sha256: '5ca897158e21c233850951da2e19cd554b34e3d11c9f97f6599f0859b80c2b78',
} as const;

export const ECONOMIC_LOCKBOX_RUNNER_V1R1_SOURCE_IDENTITIES = {
  evaluator: {
    path: 'quant-core/economic/economic-lockbox-evaluator-v1r1.ts',
    bytes: 18221,
    sha256: 'f6b5246f1729f22718d1dc05dd0c2cfb90f3c59788377597bb749542de506917',
  },
  cli: {
    path: 'quant-core/cli/run-economic-lockbox-v1r1.ts',
    bytes: 21835,
    sha256: 'ac7074292139d477d559af0dad9c0e871b62b70ee38ebcdc5b79930e1987c951',
  },
} as const;

export const ECONOMIC_LOCKBOX_RUNNER_V1R1_INFORMATION_END = 1_796_707_800_000;

export function assertFrozenEconomicLockboxRunnerV1R1(): void {
  if (ECONOMIC_LOCKBOX_RUNNER_V1R1_SPEC_IDENTITY.bytes !== 4216
    || ECONOMIC_LOCKBOX_RUNNER_V1R1_SPEC_IDENTITY.sha256 !== 'c6b5d9278dac57bb7f5364132433b1d348fc80767fc57ecdae42db42656aca90') {
    throw new Error('ECONOMIC_LOCKBOX_RUNNER_V1R1_SPEC_CHANGED');
  }
  if (ECONOMIC_LOCKBOX_RUNNER_V1R1_IMPLEMENTATION_IDENTITY.bytes !== 1067
    || ECONOMIC_LOCKBOX_RUNNER_V1R1_IMPLEMENTATION_IDENTITY.sha256 !== '5ca897158e21c233850951da2e19cd554b34e3d11c9f97f6599f0859b80c2b78') {
    throw new Error('ECONOMIC_LOCKBOX_RUNNER_V1R1_IMPLEMENTATION_CHANGED');
  }
  if (ECONOMIC_LOCKBOX_RUNNER_V1R1_SOURCE_IDENTITIES.evaluator.sha256 !== 'f6b5246f1729f22718d1dc05dd0c2cfb90f3c59788377597bb749542de506917'
    || ECONOMIC_LOCKBOX_RUNNER_V1R1_SOURCE_IDENTITIES.cli.sha256 !== 'ac7074292139d477d559af0dad9c0e871b62b70ee38ebcdc5b79930e1987c951') {
    throw new Error('ECONOMIC_LOCKBOX_RUNNER_V1R1_SOURCE_CHANGED');
  }
  if (ECONOMIC_LOCKBOX_RUNNER_V1R1_INFORMATION_END !== 1_796_707_800_000) {
    throw new Error('ECONOMIC_LOCKBOX_RUNNER_V1R1_INFORMATION_END_CHANGED');
  }
}

assertFrozenEconomicLockboxRunnerV1R1();
