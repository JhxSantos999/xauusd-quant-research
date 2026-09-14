import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditCandles, M5_TIMEFRAME_MS, type Candle } from '../data/contracts.js';
import { parseMt5TabCsv } from '../data/mt5-parser.js';
import { evaluateEconomicLockboxV1R1 } from '../economic/economic-lockbox-evaluator-v1r1.js';
import type { PlattCalibratorV1 } from '../calibration/platt.js';
import type { TrainedLogisticV1 } from '../models/logistic.js';
import type { RiskEngineLineageV1 } from '../risk/risk-engine.js';
import {
  AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R1,
  ECONOMIC_EVALUATION_V1R1_LOCKBOX,
  ECONOMIC_EVALUATION_V1R1_PRIMARY_ACCOUNT,
  ECONOMIC_EVALUATION_V1R1_PRIMARY_GATES,
  ECONOMIC_EVALUATION_V1R1_SCENARIOS,
} from '../research/economic-evaluation-v1r1-contracts.js';
import {
  DEV_DATASET_BYTES_V1,
  DEV_DATASET_CANDLES_V1,
  DEV_DATASET_SHA256_V1,
  DEV_FIRST_BAR_OPEN_TIME_V1,
  DEV_MAX_BAR_OPEN_TIME_V1,
} from '../research/frozen-contracts.js';
import {
  ECONOMIC_LOCKBOX_RUNNER_V1R1_IMPLEMENTATION_IDENTITY,
  ECONOMIC_LOCKBOX_RUNNER_V1R1_SPEC_IDENTITY,
} from '../research/economic-lockbox-runner-v1r1-contracts.js';
import { economicEvaluationPreflightV1R1 } from './run-economic-preflight-v1r1.js';

export interface EconomicLockboxCliOptionsV1R1 {
  readonly devDataset: string;
  readonly lockboxDataset: string;
  readonly finalSignalArtifacts: string;
  readonly mt5MetadataCapture: string;
  readonly outputRoot: string;
}

interface FileIdentityV1R1 {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface LockboxDatasetIdentityV1R1 {
  readonly bytes: number;
  readonly sha256: string;
  readonly candles: number;
  readonly firstBarOpenTime: number;
  readonly lastBarOpenTime: number;
  readonly physicalGapEvents: number;
}

class EconomicLockboxRunnerError extends Error {
  override readonly name = 'EconomicLockboxRunnerError';
}

function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function repositoryRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

function gitInfo(root: string): { commit: string | null; dirty: boolean | null } {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { commit, dirty: status.trim().length > 0 };
  } catch {
    return { commit: null, dirty: null };
  }
}

function verifyExactFile(
  baseDir: string,
  identity: FileIdentityV1R1,
  prefix: string,
): { path: string; bytes: number; sha256: string } {
  const absolute = path.resolve(baseDir, identity.path);
  if (!fs.existsSync(absolute)) throw new EconomicLockboxRunnerError(`${prefix}_MISSING:${identity.path}`);
  const raw = fs.readFileSync(absolute);
  const sha256 = sha256Buffer(raw);
  if (raw.length !== identity.bytes || sha256 !== identity.sha256) {
    throw new EconomicLockboxRunnerError(`${prefix}_IDENTITY_MISMATCH:${identity.path}:${raw.length}:${sha256}`);
  }
  return { path: identity.path, bytes: raw.length, sha256 };
}

export function parseEconomicLockboxArgsV1R1(args: readonly string[]): EconomicLockboxCliOptionsV1R1 {
  let devDataset: string | undefined;
  let lockboxDataset: string | undefined;
  let finalSignalArtifacts: string | undefined;
  let mt5MetadataCapture: string | undefined;
  let outputRoot: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--dev-dataset') { devDataset = args[++i]; continue; }
    if (arg === '--lockbox-dataset') { lockboxDataset = args[++i]; continue; }
    if (arg === '--final-signal-artifacts') { finalSignalArtifacts = args[++i]; continue; }
    if (arg === '--mt5-metadata-capture') { mt5MetadataCapture = args[++i]; continue; }
    if (arg === '--output') { outputRoot = args[++i]; continue; }
    throw new EconomicLockboxRunnerError(`UNKNOWN_ARGUMENT:${arg}`);
  }

  if (!devDataset) throw new EconomicLockboxRunnerError('DEV_DATASET_REQUIRED');
  if (!lockboxDataset) throw new EconomicLockboxRunnerError('LOCKBOX_DATASET_REQUIRED');
  if (!finalSignalArtifacts) throw new EconomicLockboxRunnerError('FINAL_SIGNAL_ARTIFACTS_REQUIRED');
  if (!mt5MetadataCapture) throw new EconomicLockboxRunnerError('MT5_METADATA_CAPTURE_REQUIRED');
  if (!outputRoot) throw new EconomicLockboxRunnerError('OUTPUT_ROOT_REQUIRED');

  return { devDataset, lockboxDataset, finalSignalArtifacts, mt5MetadataCapture, outputRoot };
}

export function assertLockboxMatureV1R1(nowMs: number): void {
  if (!Number.isFinite(nowMs)) throw new EconomicLockboxRunnerError('INVALID_CURRENT_TIME');
  if (nowMs < ECONOMIC_EVALUATION_V1R1_LOCKBOX.informationEnd) {
    throw new EconomicLockboxRunnerError(
      `LOCKBOX_NOT_MATURE:${nowMs}:${ECONOMIC_EVALUATION_V1R1_LOCKBOX.informationEnd}`,
    );
  }
}

function verifyRunnerFreezeV1R1(root: string): {
  spec: { path: string; bytes: number; sha256: string };
  implementationBinding: { path: string; bytes: number; sha256: string };
  sourceFiles: readonly { path: string; bytes: number; sha256: string }[];
} {
  const spec = verifyExactFile(root, ECONOMIC_LOCKBOX_RUNNER_V1R1_SPEC_IDENTITY, 'LOCKBOX_RUNNER_SPEC');
  const implementationBinding = verifyExactFile(
    root,
    ECONOMIC_LOCKBOX_RUNNER_V1R1_IMPLEMENTATION_IDENTITY,
    'LOCKBOX_RUNNER_IMPLEMENTATION',
  );
  const binding = JSON.parse(
    fs.readFileSync(path.resolve(root, ECONOMIC_LOCKBOX_RUNNER_V1R1_IMPLEMENTATION_IDENTITY.path), 'utf8'),
  ) as { source_files?: Record<string, { bytes?: number; sha256?: string }> };
  if (!binding.source_files || Object.keys(binding.source_files).length !== 2) {
    throw new EconomicLockboxRunnerError('LOCKBOX_RUNNER_SOURCE_BINDING_INVALID');
  }
  const sourceFiles = Object.entries(binding.source_files).map(([sourcePath, identity]) => {
    if (typeof identity.bytes !== 'number' || typeof identity.sha256 !== 'string') {
      throw new EconomicLockboxRunnerError(`LOCKBOX_RUNNER_SOURCE_BINDING_INVALID:${sourcePath}`);
    }
    return verifyExactFile(root, {
      path: sourcePath,
      bytes: identity.bytes,
      sha256: identity.sha256,
    }, 'LOCKBOX_RUNNER_SOURCE');
  });
  return { spec, implementationBinding, sourceFiles };
}

function loadDevDatasetV1R1(devDatasetPath: string): {
  raw: Buffer;
  candles: Candle[];
  identity: { bytes: number; sha256: string; candles: number; firstBarOpenTime: number; lastBarOpenTime: number };
} {
  const absolute = path.resolve(devDatasetPath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new EconomicLockboxRunnerError(`DEV_DATASET_NOT_FOUND:${absolute}`);
  }
  const raw = fs.readFileSync(absolute);
  const sha256 = sha256Buffer(raw);
  if (raw.length !== DEV_DATASET_BYTES_V1 || sha256 !== DEV_DATASET_SHA256_V1) {
    throw new EconomicLockboxRunnerError(`DEV_DATASET_IDENTITY_MISMATCH:${raw.length}:${sha256}`);
  }
  const candles = parseMt5TabCsv(raw.toString('utf8'));
  const audit = auditCandles(candles);
  if (audit.candles !== DEV_DATASET_CANDLES_V1
    || audit.duplicateTimestamps !== 0
    || audit.nonIncreasingTimestamps !== 0
    || audit.invalidGeometry !== 0
    || audit.nonFiniteValues !== 0
    || audit.firstBarOpenTime !== DEV_FIRST_BAR_OPEN_TIME_V1
    || audit.lastBarOpenTime !== DEV_MAX_BAR_OPEN_TIME_V1) {
    throw new EconomicLockboxRunnerError(`DEV_DATASET_AUDIT_MISMATCH:${JSON.stringify(audit)}`);
  }
  return {
    raw,
    candles,
    identity: {
      bytes: raw.length,
      sha256,
      candles: audit.candles,
      firstBarOpenTime: audit.firstBarOpenTime,
      lastBarOpenTime: audit.lastBarOpenTime,
    },
  };
}

function validateLockboxDatasetV1R1(raw: Buffer): {
  candles: Candle[];
  identity: LockboxDatasetIdentityV1R1;
} {
  const sha256 = sha256Buffer(raw);
  const candles = parseMt5TabCsv(raw.toString('utf8'));
  const audit = auditCandles(candles);
  if (audit.candles === 0
    || audit.duplicateTimestamps !== 0
    || audit.nonIncreasingTimestamps !== 0
    || audit.invalidGeometry !== 0
    || audit.nonFiniteValues !== 0) {
    throw new EconomicLockboxRunnerError(`LOCKBOX_DATASET_AUDIT_FAILED:${JSON.stringify(audit)}`);
  }

  const expectedFirst = ECONOMIC_EVALUATION_V1R1_LOCKBOX.informationStart;
  const expectedLast = ECONOMIC_EVALUATION_V1R1_LOCKBOX.informationEnd - M5_TIMEFRAME_MS;
  if (audit.firstBarOpenTime !== expectedFirst || audit.lastBarOpenTime !== expectedLast) {
    throw new EconomicLockboxRunnerError(
      `LOCKBOX_BOUNDARY_MISMATCH:${audit.firstBarOpenTime}:${audit.lastBarOpenTime}:${expectedFirst}:${expectedLast}`,
    );
  }

  let physicalGapEvents = 0;
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;
    if (candle.time < expectedFirst || candle.time >= ECONOMIC_EVALUATION_V1R1_LOCKBOX.informationEnd) {
      throw new EconomicLockboxRunnerError(`LOCKBOX_BAR_OUTSIDE_CONTRACT:${candle.time}`);
    }
    if ((candle.time - expectedFirst) % M5_TIMEFRAME_MS !== 0) {
      throw new EconomicLockboxRunnerError(`LOCKBOX_BAR_OFF_M5_GRID:${candle.time}`);
    }
    if (candle.time + M5_TIMEFRAME_MS > ECONOMIC_EVALUATION_V1R1_LOCKBOX.informationEnd) {
      throw new EconomicLockboxRunnerError(`LOCKBOX_INFORMATION_END_VIOLATION:${candle.time}`);
    }
    if (candle.spread === undefined || !Number.isFinite(candle.spread) || candle.spread < 0) {
      throw new EconomicLockboxRunnerError(`LOCKBOX_SPREAD_REQUIRED:${candle.time}`);
    }
    if (i > 0) {
      const delta = candle.time - candles[i - 1]!.time;
      if (delta > M5_TIMEFRAME_MS) physicalGapEvents++;
    }
  }

  return {
    candles,
    identity: {
      bytes: raw.length,
      sha256,
      candles: candles.length,
      firstBarOpenTime: audit.firstBarOpenTime,
      lastBarOpenTime: audit.lastBarOpenTime,
      physicalGapEvents,
    },
  };
}

function loadFinalSignalModelV1R1(finalSignalArtifacts: string): {
  model: TrainedLogisticV1;
  calibrator: PlattCalibratorV1;
} {
  const dir = path.resolve(finalSignalArtifacts);
  const modelArtifact = JSON.parse(fs.readFileSync(path.join(dir, 'final_signal_model.json'), 'utf8')) as {
    artifact_role?: string;
    schema_version?: string;
    model?: TrainedLogisticV1;
  };
  const calibratorArtifact = JSON.parse(fs.readFileSync(path.join(dir, 'final_signal_calibrator.json'), 'utf8')) as {
    artifact_role?: string;
    schema_version?: string;
    calibrator?: PlattCalibratorV1;
  };
  if (modelArtifact.artifact_role !== 'final_signal_model'
    || modelArtifact.schema_version !== 'final_signal_model_v1r1'
    || !modelArtifact.model) {
    throw new EconomicLockboxRunnerError('FINAL_SIGNAL_MODEL_ARTIFACT_SCHEMA_MISMATCH');
  }
  if (calibratorArtifact.artifact_role !== 'final_signal_calibrator'
    || calibratorArtifact.schema_version !== 'final_signal_calibrator_v1r1'
    || !calibratorArtifact.calibrator) {
    throw new EconomicLockboxRunnerError('FINAL_SIGNAL_CALIBRATOR_ARTIFACT_SCHEMA_MISMATCH');
  }
  return { model: modelArtifact.model, calibrator: calibratorArtifact.calibrator };
}

function assertNoPriorCompletedRunV1R1(outputRoot: string): void {
  const root = path.resolve(outputRoot);
  const sentinel = path.join(root, 'ECONOMIC_LOCKBOX_V1R1_COMPLETED.json');
  if (fs.existsSync(sentinel)) throw new EconomicLockboxRunnerError(`LOCKBOX_RUN_ALREADY_COMPLETED:${sentinel}`);
}

function uniqueExecutionDirectory(outputRoot: string): { executionId: string; outputDir: string } {
  const root = path.resolve(outputRoot);
  fs.mkdirSync(root, { recursive: true });
  const utc = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const base = `economic_lockbox_v1r1_${utc}`;
  let executionId = base;
  let outputDir = path.join(root, executionId);
  let suffix = 0;
  while (fs.existsSync(outputDir)) {
    executionId = `${base}_${++suffix}`;
    outputDir = path.join(root, executionId);
  }
  fs.mkdirSync(outputDir, { recursive: false });
  return { executionId, outputDir };
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeEquityCurveCsv(
  filePath: string,
  initialEquity: number,
  trades: readonly { tradeIndex: number; exitTime: number; equityAfter: number }[],
): void {
  const rows = ['trade_index,exit_time,equity'];
  rows.push(`0,,${initialEquity}`);
  for (const trade of trades) rows.push(`${trade.tradeIndex},${trade.exitTime},${trade.equityAfter}`);
  fs.writeFileSync(filePath, rows.join('\n') + '\n');
}

function artifactManifest(outputDir: string): {
  files: Record<string, { byte_length: number; sha256: string }>;
  manifest_sha256: string;
} {
  const files: Record<string, { byte_length: number; sha256: string }> = {};
  for (const name of fs.readdirSync(outputDir).sort()) {
    if (name === 'economic_lockbox_artifact_manifest.json') continue;
    const absolute = path.join(outputDir, name);
    if (!fs.statSync(absolute).isFile()) continue;
    const raw = fs.readFileSync(absolute);
    files[name] = { byte_length: raw.length, sha256: sha256Buffer(raw) };
  }
  return { files, manifest_sha256: sha256Buffer(Buffer.from(JSON.stringify(files))) };
}

function copyEvidenceFilesV1R1(
  root: string,
  finalSignalArtifacts: string,
  mt5MetadataCapture: string,
  outputDir: string,
): void {
  const repoFiles = [
    ECONOMIC_LOCKBOX_RUNNER_V1R1_SPEC_IDENTITY.path,
    ECONOMIC_LOCKBOX_RUNNER_V1R1_IMPLEMENTATION_IDENTITY.path,
    'quant-core/research/economic_evaluation_v1r1.spec.json',
    'quant-core/research/execution_engine_v1r1.spec.json',
    'quant-core/research/execution_engine_v1r1.implementation.json',
    'quant-core/research/infinox_xauusd_mt5_metadata_v1.json',
    'quant-core/research/risk_engine_v1.spec.json',
    'quant-core/research/risk_engine_v1.implementation.json',
  ] as const;
  for (const relative of repoFiles) {
    fs.copyFileSync(path.resolve(root, relative), path.join(outputDir, path.basename(relative)));
  }
  for (const name of [
    'final_signal_artifact_manifest.json',
    'final_signal_model.json',
    'final_signal_calibrator.json',
    'execution_provenance.json',
    'experiment_lineage.json',
  ] as const) {
    fs.copyFileSync(path.resolve(finalSignalArtifacts, name), path.join(outputDir, `audited_final_signal_${name}`));
  }
  fs.copyFileSync(path.resolve(mt5MetadataCapture), path.join(outputDir, 'infinox_xauusd_mt5_raw_capture_v1.txt'));
}

function persistFailureSafely(
  outputDir: string | undefined,
  executionId: string | undefined,
  error: unknown,
  lockboxAccessed: boolean,
  pnlEvaluated: boolean,
): void {
  if (!outputDir || !executionId || !fs.existsSync(outputDir)) return;
  try {
    writeJson(path.join(outputDir, 'execution_error.json'), {
      execution_id: executionId,
      status: 'ECONOMIC_LOCKBOX_V1R1_EXECUTION_INVALID',
      utc_timestamp: new Date().toISOString(),
      error_name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
      lockbox_accessed: lockboxAccessed,
      pnl_evaluated: pnlEvaluated,
    });
    writeJson(path.join(outputDir, 'economic_lockbox_artifact_manifest.json'), artifactManifest(outputDir));
  } catch (secondary) {
    console.error(`LOCKBOX_FAILURE_ARTIFACT_PERSISTENCE_FAILED:${secondary instanceof Error ? secondary.message : String(secondary)}`);
  }
}

export function runEconomicLockboxFromPathsV1R1(
  options: EconomicLockboxCliOptionsV1R1,
  nowMs: number,
): {
  executionId: string;
  outputDir: string;
  status: 'ECONOMIC_LOCKBOX_V1R1_PASS' | 'ECONOMIC_LOCKBOX_V1R1_FAIL';
} {
  const root = repositoryRoot();
  let outputDir: string | undefined;
  let executionId: string | undefined;
  let lockboxAccessed = false;
  let pnlEvaluated = false;

  try {
    const runnerFreeze = verifyRunnerFreezeV1R1(root);

    // Critical one-shot guard: this executes before any filesystem access to the lockbox path.
    assertLockboxMatureV1R1(nowMs);

    const git = gitInfo(root);
    if (!git.commit || git.dirty !== false) {
      throw new EconomicLockboxRunnerError(`SOURCE_SNAPSHOT_NOT_CLEAN:${git.commit ?? 'UNKNOWN'}:${String(git.dirty)}`);
    }

    assertNoPriorCompletedRunV1R1(options.outputRoot);
    const created = uniqueExecutionDirectory(options.outputRoot);
    outputDir = created.outputDir;
    executionId = created.executionId;

    const frozenPreflight = economicEvaluationPreflightV1R1(
      root,
      options.finalSignalArtifacts,
      options.mt5MetadataCapture,
    );
    const dev = loadDevDatasetV1R1(options.devDataset);

    // No stat/exists/read of options.lockboxDataset is allowed above this line.
    const lockboxAbsolute = path.resolve(options.lockboxDataset);
    const lockboxRaw = fs.readFileSync(lockboxAbsolute);
    lockboxAccessed = true;
    const lockbox = validateLockboxDatasetV1R1(lockboxRaw);

    if (dev.candles[dev.candles.length - 1]!.time + M5_TIMEFRAME_MS !== lockbox.candles[0]!.time) {
      throw new EconomicLockboxRunnerError('DEV_LOCKBOX_BOUNDARY_NOT_CONTIGUOUS');
    }

    const { model, calibrator } = loadFinalSignalModelV1R1(options.finalSignalArtifacts);
    const combinedCandles = [...dev.candles, ...lockbox.candles];
    const lineage: RiskEngineLineageV1 = {
      finalSignalExecutionId: AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R1.executionId,
      finalSignalModelSha256: AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R1.modelSha256,
      finalSignalCalibratorSha256: AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R1.calibratorSha256,
    };

    const evaluation = evaluateEconomicLockboxV1R1(
      combinedCandles,
      model,
      calibrator,
      lineage,
      ECONOMIC_EVALUATION_V1R1_LOCKBOX.firstPotentialDecisionTime,
      ECONOMIC_EVALUATION_V1R1_LOCKBOX.informationEnd,
      ECONOMIC_EVALUATION_V1R1_PRIMARY_ACCOUNT.initialEquity,
      ECONOMIC_EVALUATION_V1R1_SCENARIOS,
      { minimumFilledTrades: ECONOMIC_EVALUATION_V1R1_PRIMARY_GATES.minimumFilledTrades },
    );
    pnlEvaluated = true;

    const summary = {
      execution_id: executionId,
      status: evaluation.status,
      runner_version: evaluation.version,
      utc_timestamp: new Date().toISOString(),
      lockbox_contract: ECONOMIC_EVALUATION_V1R1_LOCKBOX,
      primary_account: ECONOMIC_EVALUATION_V1R1_PRIMARY_ACCOUNT,
      primary_gates: ECONOMIC_EVALUATION_V1R1_PRIMARY_GATES,
      gate_results: evaluation.gates,
      scenario_summaries: evaluation.scenarioResults.map((result) => result.summary),
      no_parameter_selection_from_lockbox_results: true,
    };
    writeJson(path.join(outputDir, 'economic_lockbox_summary.json'), summary);
    writeJson(path.join(outputDir, 'lockbox_dataset_identity.json'), lockbox.identity);
    writeJson(path.join(outputDir, 'dev_dataset_identity.json'), dev.identity);

    for (const scenarioResult of evaluation.scenarioResults) {
      writeJson(
        path.join(outputDir, `trades_${scenarioResult.summary.scenario}.json`),
        scenarioResult.trades,
      );
      writeEquityCurveCsv(
        path.join(outputDir, `equity_curve_${scenarioResult.summary.scenario}.csv`),
        ECONOMIC_EVALUATION_V1R1_PRIMARY_ACCOUNT.initialEquity,
        scenarioResult.trades,
      );
    }

    copyEvidenceFilesV1R1(root, options.finalSignalArtifacts, options.mt5MetadataCapture, outputDir);
    writeJson(path.join(outputDir, 'execution_provenance.json'), {
      execution_id: executionId,
      status: evaluation.status,
      git_commit: git.commit,
      git_dirty: git.dirty,
      runner_freeze: runnerFreeze,
      frozen_preflight: frozenPreflight,
      dev_dataset: dev.identity,
      lockbox_dataset: lockbox.identity,
      final_signal_execution_id: AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R1.executionId,
      final_signal_model_sha256: AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R1.modelSha256,
      final_signal_calibrator_sha256: AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R1.calibratorSha256,
      lockbox_accessed: true,
      pnl_evaluated: true,
      repeated_peeking_allowed: false,
      training_or_calibration_on_lockbox: false,
    });

    const manifest = artifactManifest(outputDir);
    writeJson(path.join(outputDir, 'economic_lockbox_artifact_manifest.json'), manifest);
    writeJson(path.join(path.resolve(options.outputRoot), 'ECONOMIC_LOCKBOX_V1R1_COMPLETED.json'), {
      execution_id: executionId,
      status: evaluation.status,
      artifact_manifest_sha256: manifest.manifest_sha256,
      completed_at_utc: new Date().toISOString(),
      lockbox_dataset_sha256: lockbox.identity.sha256,
    });

    return { executionId, outputDir, status: evaluation.status };
  } catch (error) {
    persistFailureSafely(outputDir, executionId, error, lockboxAccessed, pnlEvaluated);
    throw error;
  }
}

function main(): void {
  try {
    const options = parseEconomicLockboxArgsV1R1(process.argv.slice(2));
    const result = runEconomicLockboxFromPathsV1R1(options, Date.now());
    console.log(JSON.stringify({
      status: result.status,
      executionId: result.executionId,
      outputDir: result.outputDir,
    }, null, 2));
  } catch (error) {
    console.error('ECONOMIC_LOCKBOX_V1R1_EXECUTION_INVALID');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) main();
