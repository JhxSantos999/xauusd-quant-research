import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMt5TabCsv } from '../data/mt5-parser.js';
import { auditCandles, enforceDatasetContract, M5_TIMEFRAME_MS, type Candle } from '../data/contracts.js';
import { fitFinalSignalModelV1R1 } from '../engine/final-signal-model.js';
import { preflightV1, assertExecutionSnapshotIdentityV1 } from './run-nested-v1.js';
import {
  DEV_DATASET_CANDLES_V1,
  DEV_DATASET_ID_V1,
  DEV_DATASET_SHA256_V1,
  DEV_INFORMATION_END_V1,
  DEV_FIRST_BAR_OPEN_TIME_V1,
  DEV_MAX_BAR_OPEN_TIME_V1,
  IMPLEMENTATION_FREEZE_IDENTITIES_V1,
  PREREGISTRATION_IDENTITIES_V1,
} from '../research/frozen-contracts.js';
import {
  AUDITED_FINAL_DEV_EXECUTION_V1R1,
  FINAL_SIGNAL_IMPLEMENTATION_BINDING_V1R1,
  FROZEN_FINAL_SIGNAL_FIT_V1R1,
} from '../research/final-signal-contracts.js';

export type FinalSignalExecutionStatusV1R1 =
  | 'FINAL_SIGNAL_MODEL_FIT_COMPLETED_V1'
  | 'FINAL_SIGNAL_EXECUTION_INVALID_V1'
  | 'ABORTED_FINAL_SIGNAL_PREFLIGHT_MISMATCH';

interface CliOptionsV1R1 {
  readonly dataset: string;
  readonly finalDevArtifacts: string;
  readonly outputRoot?: string;
  readonly preflightOnly: boolean;
}

interface FileIdentityV1 { readonly path: string; readonly bytes: number; readonly sha256: string }

class FinalSignalPreflightMismatchError extends Error { override readonly name = 'FinalSignalPreflightMismatchError'; }
class FinalSignalOperationalError extends Error { override readonly name = 'FinalSignalOperationalError'; }

function sha256Buffer(buffer: Buffer): string { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function repositoryRoot(): string { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'); }

export function parseFinalSignalArgsV1R1(args: readonly string[]): CliOptionsV1R1 {
  let dataset: string | undefined;
  let finalDevArtifacts: string | undefined;
  let outputRoot: string | undefined;
  let preflightOnly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--dataset') { dataset = args[++i]; continue; }
    if (arg === '--final-dev-artifacts') { finalDevArtifacts = args[++i]; continue; }
    if (arg === '--output') { outputRoot = args[++i]; continue; }
    if (arg === '--preflight-only') { preflightOnly = true; continue; }
    throw new FinalSignalOperationalError(`UNKNOWN_ARGUMENT:${arg}`);
  }
  if (!dataset) throw new FinalSignalOperationalError('DATASET_PATH_REQUIRED');
  if (!finalDevArtifacts) throw new FinalSignalOperationalError('FINAL_DEV_ARTIFACT_DIRECTORY_REQUIRED');
  if (!preflightOnly && !outputRoot) throw new FinalSignalOperationalError('OUTPUT_ROOT_REQUIRED');
  return { dataset, finalDevArtifacts, ...(outputRoot ? { outputRoot } : {}), preflightOnly };
}

function verifyExactFile(baseDir: string, identity: FileIdentityV1, errorPrefix: string): { path: string; bytes: number; sha256: string } {
  const absolute = path.resolve(baseDir, identity.path);
  if (!fs.existsSync(absolute)) throw new FinalSignalPreflightMismatchError(`${errorPrefix}_MISSING:${identity.path}`);
  const raw = fs.readFileSync(absolute);
  const sha256 = sha256Buffer(raw);
  if (raw.length !== identity.bytes || sha256 !== identity.sha256) throw new FinalSignalPreflightMismatchError(`${errorPrefix}_IDENTITY_MISMATCH:${identity.path}:${raw.length}:${sha256}`);
  return { path: identity.path, bytes: raw.length, sha256 };
}

export function verifyAuditedFinalDevGateV1R1(finalDevArtifactsDir: string): {
  readonly executionId: string;
  readonly artifactManifestSemanticSha256: string;
  readonly selected: { readonly h: number; readonly tau: number };
  readonly verifiedFiles: readonly { path: string; bytes: number; sha256: string }[];
} {
  const absoluteDir = path.resolve(finalDevArtifactsDir);
  if (!fs.existsSync(absoluteDir) || !fs.statSync(absoluteDir).isDirectory()) throw new FinalSignalPreflightMismatchError(`FINAL_DEV_ARTIFACT_DIRECTORY_NOT_FOUND:${absoluteDir}`);
  const identities = AUDITED_FINAL_DEV_EXECUTION_V1R1.files;
  const verifiedFiles = Object.values(identities).map((identity) => verifyExactFile(absoluteDir, identity, 'AUDITED_FINAL_DEV_FILE'));

  const artifactManifest = JSON.parse(fs.readFileSync(path.join(absoluteDir, identities.artifactManifest.path), 'utf8')) as {
    files?: Record<string, { byte_length?: number; sha256?: string }>;
    manifest_sha256?: string;
  };
  if (artifactManifest.manifest_sha256 !== AUDITED_FINAL_DEV_EXECUTION_V1R1.artifactManifestSemanticSha256) throw new FinalSignalPreflightMismatchError('AUDITED_FINAL_DEV_MANIFEST_SEMANTIC_HASH_MISMATCH');
  for (const identity of Object.values(identities)) {
    if (identity.path === identities.artifactManifest.path) continue;
    const entry = artifactManifest.files?.[identity.path];
    if (!entry || entry.byte_length !== identity.bytes || entry.sha256 !== identity.sha256) throw new FinalSignalPreflightMismatchError(`AUDITED_FINAL_DEV_MANIFEST_ENTRY_MISMATCH:${identity.path}`);
  }

  const selection = JSON.parse(fs.readFileSync(path.join(absoluteDir, identities.selectionEvidence.path), 'utf8')) as {
    status?: string;
    selected?: { h?: number; tau?: number };
  };
  if (selection.status !== 'SELECTED' || selection.selected?.h !== AUDITED_FINAL_DEV_EXECUTION_V1R1.selected.h || selection.selected?.tau !== AUDITED_FINAL_DEV_EXECUTION_V1R1.selected.tau) throw new FinalSignalPreflightMismatchError('AUDITED_FINAL_DEV_SELECTION_MISMATCH');

  const provenance = JSON.parse(fs.readFileSync(path.join(absoluteDir, identities.provenance.path), 'utf8')) as {
    execution_id?: string;
    git_commit?: string | null;
    git_dirty?: boolean | null;
    dataset?: { sha256?: string };
    final_dev_implementation_binding?: { sha256?: string };
    future_lockbox_accessed?: boolean;
  };
  if (provenance.execution_id !== AUDITED_FINAL_DEV_EXECUTION_V1R1.executionId) throw new FinalSignalPreflightMismatchError('AUDITED_FINAL_DEV_EXECUTION_ID_MISMATCH');
  if (provenance.git_commit !== AUDITED_FINAL_DEV_EXECUTION_V1R1.sourceCommit || provenance.git_dirty !== false) throw new FinalSignalPreflightMismatchError('AUDITED_FINAL_DEV_SOURCE_SNAPSHOT_MISMATCH');
  if (provenance.dataset?.sha256 !== DEV_DATASET_SHA256_V1) throw new FinalSignalPreflightMismatchError('AUDITED_FINAL_DEV_DATASET_MISMATCH');
  if (provenance.final_dev_implementation_binding?.sha256 !== identities.implementationBinding.sha256) throw new FinalSignalPreflightMismatchError('AUDITED_FINAL_DEV_IMPLEMENTATION_BINDING_MISMATCH');
  if (provenance.future_lockbox_accessed !== false) throw new FinalSignalPreflightMismatchError('AUDITED_FINAL_DEV_PROVENANCE_LOCKBOX_VIOLATION');

  const lineage = JSON.parse(fs.readFileSync(path.join(absoluteDir, identities.lineage.path), 'utf8')) as Record<string, unknown>;
  if (lineage.dataset_sha256 !== DEV_DATASET_SHA256_V1) throw new FinalSignalPreflightMismatchError('AUDITED_FINAL_DEV_LINEAGE_DATASET_MISMATCH');
  if (lineage.final_dev_selection_executed !== true || lineage.future_lockbox_accessed !== false) throw new FinalSignalPreflightMismatchError('AUDITED_FINAL_DEV_LINEAGE_PHASE_VIOLATION');
  const selected = lineage.selected_label_spec as { h?: number; tau?: number } | undefined;
  if (selected?.h !== AUDITED_FINAL_DEV_EXECUTION_V1R1.selected.h || selected?.tau !== AUDITED_FINAL_DEV_EXECUTION_V1R1.selected.tau) throw new FinalSignalPreflightMismatchError('AUDITED_FINAL_DEV_LINEAGE_SELECTION_MISMATCH');

  return {
    executionId: AUDITED_FINAL_DEV_EXECUTION_V1R1.executionId,
    artifactManifestSemanticSha256: AUDITED_FINAL_DEV_EXECUTION_V1R1.artifactManifestSemanticSha256,
    selected: AUDITED_FINAL_DEV_EXECUTION_V1R1.selected,
    verifiedFiles,
  };
}

export function finalSignalPreflightV1R1(root: string, datasetPath: string, finalDevArtifactsDir: string): {
  readonly dataset: ReturnType<typeof preflightV1>['dataset'];
  readonly preregistration: ReturnType<typeof preflightV1>['preregistration'];
  readonly implementationFreeze: ReturnType<typeof preflightV1>['implementationFreeze'];
  readonly finalSignalImplementationBinding: { path: string; bytes: number; sha256: string };
  readonly auditedFinalDevGate: ReturnType<typeof verifyAuditedFinalDevGateV1R1>;
} {
  const base = preflightV1(root, datasetPath);
  const finalSignalImplementationBinding = verifyExactFile(root, FINAL_SIGNAL_IMPLEMENTATION_BINDING_V1R1, 'FINAL_SIGNAL_IMPLEMENTATION_BINDING');
  const auditedFinalDevGate = verifyAuditedFinalDevGateV1R1(finalDevArtifactsDir);
  return { ...base, finalSignalImplementationBinding, auditedFinalDevGate };
}

function validateExecutionDataset(candles: readonly Candle[], datasetSha256: string): void {
  const audit = auditCandles(candles);
  if (audit.candles !== DEV_DATASET_CANDLES_V1) throw new FinalSignalOperationalError(`DATASET_CANDLE_COUNT_MISMATCH:${audit.candles}`);
  if (audit.duplicateTimestamps !== 0 || audit.nonIncreasingTimestamps !== 0 || audit.invalidGeometry !== 0 || audit.nonFiniteValues !== 0) throw new FinalSignalOperationalError(`DATASET_AUDIT_FAILED:${JSON.stringify(audit)}`);
  enforceDatasetContract(candles, { datasetId: DEV_DATASET_ID_V1, datasetSha256, timeframeMs: M5_TIMEFRAME_MS, maxCandleOpenTime: DEV_MAX_BAR_OPEN_TIME_V1, maxInformationTime: DEV_INFORMATION_END_V1 });
  if (audit.firstBarOpenTime !== DEV_FIRST_BAR_OPEN_TIME_V1 || audit.lastBarOpenTime !== DEV_MAX_BAR_OPEN_TIME_V1) throw new FinalSignalOperationalError('DATASET_BOUNDARY_MISMATCH');
}

function gitInfo(root: string): { commit: string | null; dirty: boolean | null } {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { commit, dirty: status.trim().length > 0 };
  } catch { return { commit: null, dirty: null }; }
}

function walkSourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (absoluteDir: string): void => {
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      const absolute = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.json'))) files.push(path.relative(root, absolute).replaceAll('\\', '/'));
    }
  };
  for (const target of ['quant-core', 'research-reference']) {
    const absolute = path.resolve(root, target);
    if (fs.existsSync(absolute)) walk(absolute);
  }
  return files.sort();
}

function sourceManifest(root: string): { files: Record<string, { bytes: number; sha256: string }>; sha256: string } {
  const files: Record<string, { bytes: number; sha256: string }> = {};
  for (const relative of walkSourceFiles(root)) {
    const raw = fs.readFileSync(path.resolve(root, relative));
    files[relative] = { bytes: raw.length, sha256: sha256Buffer(raw) };
  }
  return { files, sha256: sha256Buffer(Buffer.from(JSON.stringify(files))) };
}

function uniqueExecutionDirectory(outputRoot: string): { executionId: string; outputDir: string } {
  const utc = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const executionId = `final_signal_v1r1_${utc}`;
  let outputDir = path.resolve(outputRoot, executionId);
  let suffix = 0;
  while (fs.existsSync(outputDir)) outputDir = path.resolve(outputRoot, `${executionId}_${++suffix}`);
  fs.mkdirSync(outputDir, { recursive: false });
  return { executionId: path.basename(outputDir), outputDir };
}

function writeJson(filePath: string, value: unknown): void { fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n'); }

function artifactManifest(outputDir: string): { files: Record<string, { byte_length: number; sha256: string }>; manifest_sha256: string } {
  const files: Record<string, { byte_length: number; sha256: string }> = {};
  for (const name of fs.readdirSync(outputDir).sort()) {
    if (name === 'final_signal_artifact_manifest.json') continue;
    const absolute = path.join(outputDir, name);
    if (!fs.statSync(absolute).isFile()) continue;
    const raw = fs.readFileSync(absolute);
    files[name] = { byte_length: raw.length, sha256: sha256Buffer(raw) };
  }
  return { files, manifest_sha256: sha256Buffer(Buffer.from(JSON.stringify(files))) };
}

function copyVerifiedContracts(root: string, finalDevArtifactsDir: string, outputDir: string): void {
  for (const identity of Object.values(PREREGISTRATION_IDENTITIES_V1)) {
    const raw = fs.readFileSync(path.resolve(root, identity.path));
    if (raw.length !== identity.bytes || sha256Buffer(raw) !== identity.sha256) throw new FinalSignalOperationalError(`PREREG_CHANGED_AFTER_PREFLIGHT:${identity.path}`);
    fs.writeFileSync(path.join(outputDir, path.basename(identity.path)), raw);
  }
  for (const identity of Object.values(IMPLEMENTATION_FREEZE_IDENTITIES_V1)) {
    const raw = fs.readFileSync(path.resolve(root, identity.path));
    if (raw.length !== identity.bytes || sha256Buffer(raw) !== identity.sha256) throw new FinalSignalOperationalError(`IMPLEMENTATION_FREEZE_CHANGED_AFTER_PREFLIGHT:${identity.path}`);
    fs.writeFileSync(path.join(outputDir, path.basename(identity.path)), raw);
  }
  const bindingRaw = fs.readFileSync(path.resolve(root, FINAL_SIGNAL_IMPLEMENTATION_BINDING_V1R1.path));
  if (bindingRaw.length !== FINAL_SIGNAL_IMPLEMENTATION_BINDING_V1R1.bytes || sha256Buffer(bindingRaw) !== FINAL_SIGNAL_IMPLEMENTATION_BINDING_V1R1.sha256) throw new FinalSignalOperationalError('FINAL_SIGNAL_BINDING_CHANGED_AFTER_PREFLIGHT');
  fs.writeFileSync(path.join(outputDir, path.basename(FINAL_SIGNAL_IMPLEMENTATION_BINDING_V1R1.path)), bindingRaw);
  for (const identity of Object.values(AUDITED_FINAL_DEV_EXECUTION_V1R1.files)) {
    const raw = fs.readFileSync(path.resolve(finalDevArtifactsDir, identity.path));
    if (raw.length !== identity.bytes || sha256Buffer(raw) !== identity.sha256) throw new FinalSignalOperationalError(`AUDITED_FINAL_DEV_CHANGED_AFTER_PREFLIGHT:${identity.path}`);
    fs.writeFileSync(path.join(outputDir, `audited_final_dev_${identity.path}`), raw);
  }
}

function persistFailureSafely(outputDir: string | undefined, executionId: string | undefined, error: unknown): void {
  if (!outputDir || !executionId || !fs.existsSync(outputDir)) return;
  try {
    writeJson(path.join(outputDir, 'execution_error.json'), {
      execution_id: executionId,
      status: 'FINAL_SIGNAL_EXECUTION_INVALID_V1',
      utc_timestamp: new Date().toISOString(),
      error_name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      future_lockbox_accessed: false,
    });
    writeJson(path.join(outputDir, 'final_signal_artifact_manifest.json'), artifactManifest(outputDir));
  } catch (secondary) {
    console.error(`FAILURE_ARTIFACT_PERSISTENCE_FAILED:${secondary instanceof Error ? secondary.message : String(secondary)}`);
  }
}

export function executeFinalSignalV1R1(root: string, options: CliOptionsV1R1): FinalSignalExecutionStatusV1R1 | 'FINAL_SIGNAL_PREFLIGHT_PASS' {
  let preflight;
  try {
    preflight = finalSignalPreflightV1R1(root, options.dataset, options.finalDevArtifacts);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof FinalSignalPreflightMismatchError || (error instanceof Error && error.name === 'PreregistrationMismatchError')) {
      console.error('ABORTED_FINAL_SIGNAL_PREFLIGHT_MISMATCH');
      console.error(message);
      return 'ABORTED_FINAL_SIGNAL_PREFLIGHT_MISMATCH';
    }
    console.error('FINAL_SIGNAL_EXECUTION_INVALID_V1');
    console.error(message);
    return 'FINAL_SIGNAL_EXECUTION_INVALID_V1';
  }

  console.log(JSON.stringify({ status: 'FINAL_SIGNAL_PREFLIGHT_PASS', ...preflight }, null, 2));
  if (options.preflightOnly) return 'FINAL_SIGNAL_PREFLIGHT_PASS';

  let executionId: string | undefined;
  let outputDir: string | undefined;
  try {
    const git = gitInfo(root);
    if (!git.commit || git.dirty !== false) throw new FinalSignalOperationalError(`SOURCE_SNAPSHOT_NOT_CLEAN:${git.commit ?? 'UNKNOWN'}:${String(git.dirty)}`);

    const created = uniqueExecutionDirectory(options.outputRoot!);
    executionId = created.executionId;
    outputDir = created.outputDir;

    const rawDataset = assertExecutionSnapshotIdentityV1(preflight.dataset.path, preflight.dataset);
    const candles = parseMt5TabCsv(rawDataset.toString('utf8'));
    validateExecutionDataset(candles, preflight.dataset.sha256);
    verifyAuditedFinalDevGateV1R1(options.finalDevArtifacts);

    const source = sourceManifest(root);
    const provenance = {
      execution_id: executionId,
      phase: 'FINAL_SIGNAL_MODEL_FIT_V1R1',
      utc_timestamp: new Date().toISOString(),
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      git_commit: git.commit,
      git_dirty: git.dirty,
      quant_core_source_manifest_sha256: source.sha256,
      dataset: preflight.dataset,
      dataset_revalidated_before_fit: true,
      preregistration: preflight.preregistration,
      implementation_freeze: preflight.implementationFreeze,
      final_signal_implementation_binding: preflight.finalSignalImplementationBinding,
      audited_final_dev_gate: preflight.auditedFinalDevGate,
      future_lockbox_accessed: false,
    };
    writeJson(path.join(outputDir, 'execution_provenance.json'), provenance);
    writeJson(path.join(outputDir, 'quant_core_source_manifest.json'), source);
    copyVerifiedContracts(root, options.finalDevArtifacts, outputDir);

    const result = fitFinalSignalModelV1R1(candles, FROZEN_FINAL_SIGNAL_FIT_V1R1);
    const { model, calibrator, ...fitEvidence } = result;
    writeJson(path.join(outputDir, 'final_signal_fit_evidence.json'), fitEvidence);
    writeJson(path.join(outputDir, 'final_signal_model.json'), {
      artifact_role: 'final_signal_model',
      schema_version: 'final_signal_model_v1r1',
      asset: 'XAUUSD',
      timeframe: 'M5',
      dataset_id: DEV_DATASET_ID_V1,
      dataset_sha256: DEV_DATASET_SHA256_V1,
      feature_schema_version: 'feature_schema_v1',
      transformer_version: 'scaler_identity_v1',
      selected_label_spec: result.selectedLabelSpec,
      train_window: result.trainWindow,
      train_isolation: result.trainIsolation,
      train_count: result.trainCount,
      model,
    });
    writeJson(path.join(outputDir, 'final_signal_calibrator.json'), {
      artifact_role: 'final_signal_calibrator',
      schema_version: 'final_signal_calibrator_v1r1',
      calibration_version: 'platt_v1',
      selected_label_spec: result.selectedLabelSpec,
      calibration_window: result.calibrationWindow,
      calibration_isolation: result.calibrationIsolation,
      calibration_count: result.calibrationCount,
      calibrator,
    });
    writeJson(path.join(outputDir, 'experiment_lineage.json'), {
      dataset_id: DEV_DATASET_ID_V1,
      dataset_sha256: DEV_DATASET_SHA256_V1,
      feature_schema_version: 'feature_schema_v1',
      label_engine_version: 'label_engine_v1',
      transformer_version: 'scaler_identity_v1',
      model_version: 'logreg_v1',
      calibration_version: 'platt_v1',
      selection_spec_sha256: PREREGISTRATION_IDENTITIES_V1.selection.sha256,
      geometry_spec_sha256: PREREGISTRATION_IDENTITIES_V1.geometry.sha256,
      nested_validation_spec_sha256: PREREGISTRATION_IDENTITIES_V1.nested.sha256,
      preregistration_manifest_sha256: PREREGISTRATION_IDENTITIES_V1.manifest.sha256,
      final_signal_implementation_binding_sha256: FINAL_SIGNAL_IMPLEMENTATION_BINDING_V1R1.sha256,
      audited_final_dev_execution_id: AUDITED_FINAL_DEV_EXECUTION_V1R1.executionId,
      audited_final_dev_artifact_manifest_sha256: AUDITED_FINAL_DEV_EXECUTION_V1R1.artifactManifestSemanticSha256,
      final_dev_selection_executed: true,
      selected_label_spec: result.selectedLabelSpec,
      final_signal_model_fit_executed: true,
      risk_engine_executed: false,
      execution_engine_executed: false,
      future_lockbox_accessed: false,
    });

    const manifest = artifactManifest(outputDir);
    writeJson(path.join(outputDir, 'final_signal_artifact_manifest.json'), {
      ...manifest,
      final_signal_implementation_binding_sha256: FINAL_SIGNAL_IMPLEMENTATION_BINDING_V1R1.sha256,
      audited_final_dev_artifact_manifest_sha256: AUDITED_FINAL_DEV_EXECUTION_V1R1.artifactManifestSemanticSha256,
    });

    const modelRaw = fs.readFileSync(path.join(outputDir, 'final_signal_model.json'));
    const calibratorRaw = fs.readFileSync(path.join(outputDir, 'final_signal_calibrator.json'));
    console.log(JSON.stringify({
      status: 'FINAL_SIGNAL_MODEL_FIT_COMPLETED_V1',
      execution_id: executionId,
      selected: result.selectedLabelSpec,
      train_count: result.trainCount,
      calibration_count: result.calibrationCount,
      model_sha256: sha256Buffer(modelRaw),
      calibrator_sha256: sha256Buffer(calibratorRaw),
      artifact_manifest_sha256: manifest.manifest_sha256,
      output_dir: outputDir,
      future_lockbox_accessed: false,
    }, null, 2));
    return 'FINAL_SIGNAL_MODEL_FIT_COMPLETED_V1';
  } catch (error) {
    persistFailureSafely(outputDir, executionId, error);
    console.error('FINAL_SIGNAL_EXECUTION_INVALID_V1');
    console.error(error instanceof Error ? error.message : String(error));
    return 'FINAL_SIGNAL_EXECUTION_INVALID_V1';
  }
}

function main(): void {
  let options: CliOptionsV1R1;
  try { options = parseFinalSignalArgsV1R1(process.argv.slice(2)); }
  catch (error) {
    console.error('FINAL_SIGNAL_EXECUTION_INVALID_V1');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  const status = executeFinalSignalV1R1(repositoryRoot(), options);
  if (status === 'FINAL_SIGNAL_EXECUTION_INVALID_V1' || status === 'ABORTED_FINAL_SIGNAL_PREFLIGHT_MISMATCH') process.exitCode = 1;
}

const invokedAsScript = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invokedAsScript) main();
