import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { economicEvaluationPreflightV1R2 } from './run-economic-preflight-v1r2.js';
import {
  parseEconomicLockboxArgsV1R2,
  runEconomicLockboxFromPathsV1R2,
} from './run-economic-lockbox-v1r2.js';

function repositoryRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

export function runEconomicLockboxProductionV1R2(args: readonly string[]): {
  executionId: string;
  outputDir: string;
  status: 'ECONOMIC_LOCKBOX_V1R2_PASS' | 'ECONOMIC_LOCKBOX_V1R2_FAIL';
} {
  const options = parseEconomicLockboxArgsV1R2(args);
  economicEvaluationPreflightV1R2(
    repositoryRoot(),
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
