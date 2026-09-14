import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LOCKBOX_REGISTRY_V1R2_DIR = '.xauusd-quant-research';
export const LOCKBOX_REGISTRY_V1R2_FILE = 'economic-lockbox-v1r2-attempt.json';

export type LockboxRegistryStateV1R2 =
  | 'EVALUATION_RESERVED'
  | 'PNL_EVALUATED'
  | 'COMPLETED'
  | 'FAILED_AFTER_RESERVATION';

export interface LockboxRegistryRecordV1R2 {
  readonly version: 'lockbox_registry_v1r2';
  readonly state: LockboxRegistryStateV1R2;
  readonly executionId: string;
  readonly lockboxDatasetSha256: string;
  readonly reservedAtUtc: string;
  readonly updatedAtUtc: string;
  readonly note?: string;
}

export function defaultLockboxRegistryPathV1R2(homeDir = os.homedir()): string {
  return path.join(homeDir, LOCKBOX_REGISTRY_V1R2_DIR, LOCKBOX_REGISTRY_V1R2_FILE);
}

export function assertNoPriorLockboxEvaluationV1R2(
  registryPath = defaultLockboxRegistryPathV1R2(),
): void {
  if (fs.existsSync(registryPath)) {
    throw new Error(`LOCKBOX_V1R2_PRIOR_EVALUATION_REGISTRY_EXISTS:${registryPath}`);
  }
}

function assertRecordIdentity(
  existing: LockboxRegistryRecordV1R2,
  executionId: string,
  lockboxDatasetSha256: string,
): void {
  if (existing.version !== 'lockbox_registry_v1r2'
    || existing.executionId !== executionId
    || existing.lockboxDatasetSha256 !== lockboxDatasetSha256) {
    throw new Error('LOCKBOX_V1R2_REGISTRY_IDENTITY_MISMATCH');
  }
}

export function reserveLockboxEvaluationV1R2(
  executionId: string,
  lockboxDatasetSha256: string,
  registryPath = defaultLockboxRegistryPathV1R2(),
): LockboxRegistryRecordV1R2 {
  if (!executionId) throw new Error('LOCKBOX_V1R2_REGISTRY_EXECUTION_ID_REQUIRED');
  if (!/^[0-9a-f]{64}$/i.test(lockboxDatasetSha256)) {
    throw new Error('LOCKBOX_V1R2_REGISTRY_DATASET_SHA256_INVALID');
  }
  assertNoPriorLockboxEvaluationV1R2(registryPath);
  const now = new Date().toISOString();
  const record: LockboxRegistryRecordV1R2 = {
    version: 'lockbox_registry_v1r2',
    state: 'EVALUATION_RESERVED',
    executionId,
    lockboxDatasetSha256: lockboxDatasetSha256.toLowerCase(),
    reservedAtUtc: now,
    updatedAtUtc: now,
  };
  const dir = path.dirname(registryPath);
  fs.mkdirSync(dir, { recursive: true });
  const fd = fs.openSync(registryPath, 'wx');
  try {
    fs.writeFileSync(fd, JSON.stringify(record, null, 2) + '\n');
  } finally {
    fs.closeSync(fd);
  }
  return record;
}

export function transitionLockboxRegistryV1R2(
  executionId: string,
  lockboxDatasetSha256: string,
  state: Exclude<LockboxRegistryStateV1R2, 'EVALUATION_RESERVED'>,
  note?: string,
  registryPath = defaultLockboxRegistryPathV1R2(),
): LockboxRegistryRecordV1R2 {
  if (!fs.existsSync(registryPath)) throw new Error('LOCKBOX_V1R2_REGISTRY_MISSING');
  const existing = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as LockboxRegistryRecordV1R2;
  assertRecordIdentity(existing, executionId, lockboxDatasetSha256.toLowerCase());
  const next: LockboxRegistryRecordV1R2 = {
    ...existing,
    state,
    updatedAtUtc: new Date().toISOString(),
    ...(note ? { note } : {}),
  };
  const temp = `${registryPath}.next-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(temp, registryPath);
  return next;
}
