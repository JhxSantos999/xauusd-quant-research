import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { economicEvaluationPreflightV1R2 } from './run-economic-preflight-v1r2.js';
import {
  parseEconomicLockboxArgsV1R2,
  runEconomicLockboxFromPathsV1R2,
} from './run-economic-lockbox-v1r2.js';
import {
  ECONOMIC_LOCKBOX_RUNNER_V1R2_IMPLEMENTATION_IDENTITY,
  ECONOMIC_LOCKBOX_RUNNER_V1R2_SOURCE_IDENTITIES,
  ECONOMIC_LOCKBOX_RUNNER_V1R2_SPEC_IDENTITY,
} from '../research/economic-lockbox-runner-v1r2-contracts.js';

interface ExactIdentityV1R2 {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

function repositoryRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

function sha256(raw: Buffer): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function verifyExact(root: string, identity: ExactIdentityV1R2, prefix: string): void {
  const absolute = path.resolve(root, identity.path);
  if (!fs.existsSync(absolute)) throw new Error(`${prefix}_MISSING:${identity.path}`);
  const raw = fs.readFileSync(absolute);
  const actual = sha256(raw);
  if (raw.length !== identity.bytes || actual !== identity.sha256) {
    throw new Error(`${prefix}_IDENTITY_MISMATCH:${identity.path}:${raw.length}:${actual}`);
  }
}

export function verifyEconomicLockboxRunnerFreezeV1R2(root: string): void {
  verifyExact(root, ECONOMIC_LOCKBOX_RUNNER_V1R2_SPEC_IDENTITY, 'LOCKBOX_RUNNER_V1R2_SPEC');
  verifyExact(root, ECONOMIC_LOCKBOX_RUNNER_V1R2_IMPLEMENTATION_IDENTITY, 'LOCKBOX_RUNNER_V1R2_IMPLEMENTATION');
  for (const identity of Object.values(ECONOMIC_LOCKBOX_RUNNER_V1R2_SOURCE_IDENTITIES)) {
    verifyExact(root, identity, 'LOCKBOX_RUNNER_V1R2_SOURCE');
  }
}

export function runEconomicLockboxProductionV1R2(args: readonly string[]): {
  executionId: string;
  outputDir: string;
  status: 'ECONOMIC_LOCKBOX_V1R2_PASS' | 'ECONOMIC_LOCKBOX_V1R2_FAIL';
} {
  const root = repositoryRoot();
  const options = parseEconomicLockboxArgsV1R2(args);
  verifyEconomicLockboxRunnerFreezeV1R2(root);
  economicEvaluationPreflightV1R2(
    root,
    options.finalSignalArtifacts,
    options.mt5MetadataCapture,
  );
  return runEconomicLockboxFromPathsV1R2(options);
}

function main(): void {
  try {
    const result = runEconomicLockboxProductionV1R2(process.argv.slice(2));
    console.log(JSON.stringify({
      status: result.status,
      executionId: result.executionId,
      outputDir: result.outputDir,
    }, null, 2));
  } catch (error) {
    console.error('ECONOMIC_LOCKBOX_V1R2_EXECUTION_INVALID');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) main();
