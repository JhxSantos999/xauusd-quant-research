import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMt5TabCsv } from '../data/mt5-parser.js';
import { auditCandles, enforceDatasetContract, M5_TIMEFRAME_MS, type Candle } from '../data/contracts.js';
import { runFinalDevSelectionV1 } from '../engine/final-dev-selection.js';
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
  AUDITED_NESTED_EXECUTION_V1R1,
  FINAL_DEV_IMPLEMENTATION_BINDING_V1R1,
  FROZEN_FINAL_DEV_GEOMETRY_V1,
} from '../research/final-dev-contracts.js';

export type FinalDevExecutionStatusV1 =
  | 'FINAL_DEV_SELECTION_COMPLETED_SELECTED_V1'
  | 'FINAL_DEV_SELECTION_COMPLETED_NO_VALID_LABEL_SPEC_V1'
  | 'FINAL_DEV_EXECUTION_INVALID_V1'
  | 'ABORTED_FINAL_DEV_PREFLIGHT_MISMATCH';

interface CliOptionsV1 {
  readonly dataset: string;
  readonly nestedArtifacts: string;
  readonly outputRoot?: string;
  readonly preflightOnly: boolean;
}

interface FileIdentityV1 { readonly path: string; readonly bytes: number; readonly sha256: string }

class FinalDevPreflightMismatchError extends Error { override readonly name = 'FinalDevPreflightMismatchError'; }
class FinalDevOperationalError extends Error { override readonly name = 'FinalDevOperationalError'; }

function sha256Buffer(buffer: Buffer): string { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function repositoryRoot(): string { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'); }

export function parseFinalDevArgsV1(args: readonly string[]): CliOptionsV1 {
  let dataset: string | undefined;
  let nestedArtifacts: string | undefined;
  let outputRoot: string | undefined;
  let preflightOnly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--dataset') { dataset = args[++i]; continue; }
    if (arg === '--nested-artifacts') { nestedArtifacts = args[++i]; continue; }
    if (arg === '--output') { outputRoot = args[++i]; continue; }
    if (arg === '--preflight-only') { preflightOnly = true; continue; }
    throw new FinalDevOperationalError(`UNKNOWN_ARGUMENT:${arg}`);
  }
  if (!dataset) throw new FinalDevOperationalError('DATASET_PATH_REQUIRED');
  if (!nestedArtifacts) throw new FinalDevOperationalError('NESTED_ARTIFACT_DIRECTORY_REQUIRED');
  if (!preflightOnly && !outputRoot) throw new FinalDevOperationalError('OUTPUT_ROOT_REQUIRED');
  return { dataset, nestedArtifacts, ...(outputRoot ? { outputRoot } : {}), preflightOnly };
}

function verifyExactFile(baseDir: string, identity: FileIdentityV1, errorPrefix: string): { path: string; bytes: number; sha256: string } {
  const absolute = path.resolve(baseDir, identity.path);
  if (!fs.existsSync(absolute)) throw new FinalDevPreflightMismatchError(`${errorPrefix}_MISSING:${identity.path}`);
  const raw = fs.readFileSync(absolute);
  const sha256 = sha256Buffer(raw);
  if (raw.length !== identity.bytes || sha256 !== identity.sha256) throw new FinalDevPreflightMismatchError(`${errorPrefix}_IDENTITY_MISMATCH:${identity.path}:${raw.length}:${sha256}`);
  return { path: identity.path, bytes: raw.length, sha256 };
}

export function verifyAuditedNestedGateV1R1(nestedArtifactsDir: string): {
  readonly executionId: string;
  readonly artifactManifestSemanticSha256: string;
  readonly verifiedFiles: readonly { path: string; bytes: number; sha256: string }[];
} {
  const absoluteDir = path.resolve(nestedArtifactsDir);
  if (!fs.existsSync(absoluteDir) || !fs.statSync(absoluteDir).isDirectory()) throw new FinalDevPreflightMismatchError(`NESTED_ARTIFACT_DIRECTORY_NOT_FOUND:${absoluteDir}`);
  const identities = AUDITED_NESTED_EXECUTION_V1R1.files;
  const verifiedFiles = Object.values(identities).map((identity) => verifyExactFile(absoluteDir, identity, 'AUDITED_NESTED_FILE'));

  const artifactManifest = JSON.parse(fs.readFileSync(path.join(absoluteDir, identities.artifactManifest.path), 'utf8')) as {
    files?: Record<string, { byte_length?: number; sha256?: string }>;
    manifest_sha256?: string;
    preregistration_manifest_sha256?: string;
  };
  if (artifactManifest.manifest_sha256 !== AUDITED_NESTED_EXECUTION_V1R1.artifactManifestSemanticSha256) throw new FinalDevPreflightMismatchError('AUDITED_NESTED_MANIFEST_SEMANTIC_HASH_MISMATCH');
  for (const identity of Object.values(identities)) {
    if (identity.path === identities.artifactManifest.path) continue;
    const entry = artifactManifest.files?.[identity.path];
    if (!entry || entry.byte_length !== identity.bytes || entry.sha256 !== identity.sha256) throw new FinalDevPreflightMismatchError(`AUDITED_NESTED_MANIFEST_ENTRY_MISMATCH:${identity.path}`);
  }

  const nestedValidation = JSON.parse(fs.readFileSync(path.join(absoluteDir, identities.nestedValidation.path), 'utf8')) as { status?: string; rejectionReasons?: unknown[] };
  if (nestedValidation.status !== 'VALIDATED_V1' || !Array.isArray(nestedValidation.rejectionReasons) || nestedValidation.rejectionReasons.length !== 0) throw new FinalDevPreflightMismatchError('AUDITED_NESTED_VALIDATION_NOT_VALIDATED');

  const provenance = JSON.parse(fs.readFileSync(path.join(absoluteDir, identities.provenance.path), 'utf8')) as {
    execution_id?: string;
    git_commit?: string | null;
    git_dirty?: boolean | null;
    dataset?: { sha256?: string };
    preregistration?: { path?: string; sha256?: string }[];
  };
  if (provenance.execution_id !== AUDITED_NESTED_EXECUTION_V1R1.executionId) throw new FinalDevPreflightMismatchError('AUDITED_NESTED_EXECUTION_ID_MISMATCH');
  if (provenance.git_commit !== AUDITED_NESTED_EXECUTION_V1R1.sourceCommit || provenance.git_dirty !== false) throw new FinalDevPreflightMismatchError('AUDITED_NESTED_SOURCE_SNAPSHOT_MISMATCH');
  if (provenance.dataset?.sha256 !== DEV_DATASET_SHA256_V1) throw new FinalDevPreflightMismatchError('AUDITED_NESTED_DATASET_MISMATCH');

  const lineage = JSON.parse(fs.readFileSync(path.join(absoluteDir, identities.lineage.path), 'utf8')) as Record<string, unknown>;
  if (lineage.dataset_sha256 !== DEV_DATASET_SHA256_V1) throw new FinalDevPreflightMismatchError('AUDITED_NESTED_LINEAGE_DATASET_MISMATCH');
  if (lineage.selection_spec_sha256 !== PREREGISTRATION_IDENTITIES_V1.selection.sha256) throw new FinalDevPreflightMismatchError('AUDITED_NESTED_LINEAGE_SELECTION_MISMATCH');
  if (lineage.geometry_spec_sha256 !== PREREGISTRATION_IDENTITIES_V1.geometry.sha256) throw new FinalDevPreflightMismatchError('AUDITED_NESTED_LINEAGE_GEOMETRY_MISMATCH');
  if (lineage.nested_validation_spec_sha256 !== PREREGISTRATION_IDENTITIES_V1.nested.sha256) throw new FinalDevPreflightMismatchError('AUDITED_NESTED_LINEAGE_VALIDATION_MISMATCH');
  if (lineage.preregistration_manifest_sha256 !== PREREGISTRATION_IDENTITIES_V1.manifest.sha256) throw new FinalDevPreflightMismatchError('AUDITED_NESTED_LINEAGE_MANIFEST_MISMATCH');
  if (lineage.logreg_implementation_sha256 !== IMPLEMENTATION_FREEZE_IDENTITIES_V1.logreg.sha256 || lineage.platt_implementation_sha256 !== IMPLEMENTATION_FREEZE_IDENTITIES_V1.platt.sha256) throw new FinalDevPreflightMismatchError('AUDITED_NESTED_LINEAGE_IMPLEMENTATION_MISMATCH');
  if (lineage.final_dev_selection_executed !== false || lineage.future_lockbox_accessed !== false) throw new FinalDevPreflightMismatchError('AUDITED_NESTED_LINEAGE_PHASE_VIOLATION');

  return {
    executionId: AUDITED_NESTED_EXECUTION_V1R1.executionId,
    artifactManifestSemanticSha256: AUDITED_NESTED_EXECUTION_V1R1.artifactManifestSemanticSha256,
    verifiedFiles,
  };
}

function validateExecutionDataset(candles: readonly Candle[], datasetSha256: string): void {
  const audit = auditCandles(candles);
  if (audit.candles !== DEV_DATASET_CANDLES_V1) throw new FinalDevOperationalError(`DATASET_CANDLE_COUNT_MISMATCH:${audit.candles}`);
  if (audit.duplicateTimestamps !== 0 || audit.nonIncreasingTimestamps !== 0 || audit.invalidGeometry !== 0 || audit.nonFiniteValues !== 0) throw new FinalDevOperationalError(`DATASET_AUDIT_FAILED:${JSON.stringify(audit)}`);
  enforceDatasetContract(candles, { datasetId: DEV_DATASET_ID_V1, datasetSha256, timeframeMs: M5_TIMEFRAME_MS, maxCandleOpenTime: DEV_MAX_BAR_OPEN_TIME_V1, maxInformationTime: DEV_INFORMATION_END_V1 });
  if (audit.firstBarOpenTime !== DEV_FIRST_BAR_OPEN_TIME_V1 || audit.lastBarOpenTime !== DEV_MAX_BAR_OPEN_TIME_V1) throw new FinalDevOperationalError('DATASET_BOUNDARY_MISMATCH');
}

export function finalDevPreflightV1R1(root: string, datasetPath: string, nestedArtifactsDir: string): {
  readonly dataset: ReturnType<typeof preflightV1>['dataset'];
  readonly preregistration: ReturnType<typeof preflightV1>['preregistration'];
  readonly implementationFreeze: ReturnType<typeof preflightV1>['implementationFreeze'];
  readonly finalDevImplementationBinding: { path: string; bytes: number; sha256: string };
  readonly auditedNestedGate: ReturnType<typeof verifyAuditedNestedGateV1R1>;
} {
  const base = preflightV1(root, datasetPath);
  const finalDevImplementationBinding = verifyExactFile(root, FINAL_DEV_IMPLEMENTATION_BINDING_V1R1, 'FINAL_DEV_IMPLEMENTATION_BINDING');
  const auditedNestedGate = verifyAuditedNestedGateV1R1(nestedArtifactsDir);
  return { ...base, finalDevImplementationBinding, auditedNestedGate };
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
  const canonical = JSON.stringify(files);
  return { files, sha256: sha256Buffer(Buffer.from(canonical)) };
}

function uniqueExecutionDirectory(outputRoot: string): { executionId: string; outputDir: string } {
  const utc = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const executionId = `final_dev_v1r1_${utc}`;
  let outputDir = path.resolve(outputRoot, executionId);
  let suffix = 0;
  while (fs.existsSync(outputDir)) outputDir = path.resolve(outputRoot, `${executionId}_${++suffix}`);
  fs.mkdirSync(outputDir, { recursive: false });
  return { executionId: path.basename(outputDir), outputDir };
}

function writeJson(filePath: string, value: unknown): void { fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n'); }
function writeCsv(filePath: string, header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): void {
  const escape = (value: string | number | null | undefined): string => {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  fs.writeFileSync(filePath, [header.join(','), ...rows.map((row) => row.map(escape).join(','))].join('\n') + '\n');
}

function artifactManifest(outputDir: string): { files: Record<string, { byte_length: number; sha256: string }>; manifest_sha256: string } {
  const files: Record<string, { byte_length: number; sha256: string }> = {};
  for (const name of fs.readdirSync(outputDir).sort()) {
    if (name === 'final_dev_artifact_manifest.json') continue;
    const absolute = path.join(outputDir, name);
    if (!fs.statSync(absolute).isFile()) continue;
    const raw = fs.readFileSync(absolute);
    files[name] = { byte_length: raw.length, sha256: sha256Buffer(raw) };
  }
  return { files, manifest_sha256: sha256Buffer(Buffer.from(JSON.stringify(files))) };
}

function copyVerifiedContracts(root: string, nestedArtifactsDir: string, outputDir: string): void {
  for (const identity of Object.values(PREREGISTRATION_IDENTITIES_V1)) {
    const source = path.resolve(root, identity.path);
    const raw = fs.readFileSync(source);
    if (raw.length !== identity.bytes || sha256Buffer(raw) !== identity.sha256) throw new FinalDevOperationalError(`PREREG_CHANGED_AFTER_PREFLIGHT:${identity.path}`);
    fs.writeFileSync(path.join(outputDir, path.basename(identity.path)), raw);
  }
  const binding = path.resolve(root, FINAL_DEV_IMPLEMENTATION_BINDING_V1R1.path);
  const bindingRaw = fs.readFileSync(binding);
  if (bindingRaw.length !== FINAL_DEV_IMPLEMENTATION_BINDING_V1R1.bytes || sha256Buffer(bindingRaw) !== FINAL_DEV_IMPLEMENTATION_BINDING_V1R1.sha256) throw new FinalDevOperationalError('FINAL_DEV_BINDING_CHANGED_AFTER_PREFLIGHT');
  fs.writeFileSync(path.join(outputDir, path.basename(FINAL_DEV_IMPLEMENTATION_BINDING_V1R1.path)), bindingRaw);
  for (const key of ['artifactManifest', 'nestedValidation', 'provenance', 'lineage'] as const) {
    const identity = AUDITED_NESTED_EXECUTION_V1R1.files[key];
    const raw = fs.readFileSync(path.resolve(nestedArtifactsDir, identity.path));
    if (raw.length !== identity.bytes || sha256Buffer(raw) !== identity.sha256) throw new FinalDevOperationalError(`AUDITED_NESTED_CHANGED_AFTER_PREFLIGHT:${identity.path}`);
    fs.writeFileSync(path.join(outputDir, `audited_nested_${identity.path}`), raw);
  }
}

function persistFailureSafely(outputDir: string | undefined, executionId: string | undefined, error: unknown): void {
  if (!outputDir || !executionId || !fs.existsSync(outputDir)) return;
  try {
    writeJson(path.join(outputDir, 'execution_error.json'), {
      execution_id: executionId,
      status: 'FINAL_DEV_EXECUTION_INVALID_V1',
      utc_timestamp: new Date().toISOString(),
      error_name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      future_lockbox_accessed: false,
    });
    const manifest = artifactManifest(outputDir);
    writeJson(path.join(outputDir, 'final_dev_artifact_manifest.json'), { ...manifest, final_dev_implementation_binding_sha256: FINAL_DEV_IMPLEMENTATION_BINDING_V1R1.sha256 });
  } catch (secondary) {
    console.error(`FAILURE_ARTIFACT_PERSISTENCE_FAILED:${secondary instanceof Error ? secondary.message : String(secondary)}`);
  }
}

export function executeFinalDevV1R1(root: string, options: CliOptionsV1): { status: FinalDevExecutionStatusV1 | 'FINAL_DEV_PREFLIGHT_PASS'; outputDir?: string } {
  let preflight;
  try {
    preflight = finalDevPreflightV1R1(root, options.dataset, options.nestedArtifacts);
  } catch (error) {
    console.error('ABORTED_FINAL_DEV_PREFLIGHT_MISMATCH');
    console.error(error instanceof Error ? error.message : String(error));
    return { status: 'ABORTED_FINAL_DEV_PREFLIGHT_MISMATCH' };
  }

  console.log(JSON.stringify({ status: 'FINAL_DEV_PREFLIGHT_PASS', ...preflight }, null, 2));
  if (options.preflightOnly) return { status: 'FINAL_DEV_PREFLIGHT_PASS' };

  let executionId: string | undefined;
  let outputDir: string | undefined;
  try {
    const created = uniqueExecutionDirectory(options.outputRoot!);
    executionId = created.executionId;
    outputDir = created.outputDir;

    const rawDataset = assertExecutionSnapshotIdentityV1(preflight.dataset.path, preflight.dataset);
    const candles = parseMt5TabCsv(rawDataset.toString('utf8'));
    validateExecutionDataset(candles, preflight.dataset.sha256);
    verifyAuditedNestedGateV1R1(options.nestedArtifacts);

    const source = sourceManifest(root);
    const git = gitInfo(root);
    writeJson(path.join(outputDir, 'execution_provenance.json'), {
      execution_id: executionId,
      phase: 'FINAL_DEV_SELECTION_V1R1',
      utc_timestamp: new Date().toISOString(),
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      git_commit: git.commit,
      git_dirty: git.dirty,
      quant_core_source_manifest_sha256: source.sha256,
      dataset: preflight.dataset,
      dataset_revalidated_before_fit: true,
      preregistration: preflight.preregistration,
      implementation_freeze: preflight.implementationFreeze,
      final_dev_implementation_binding: preflight.finalDevImplementationBinding,
      audited_nested_gate: preflight.auditedNestedGate,
      future_lockbox_accessed: false,
    });
    writeJson(path.join(outputDir, 'quant_core_source_manifest.json'), source);
    copyVerifiedContracts(root, options.nestedArtifacts, outputDir);

    const result = runFinalDevSelectionV1(candles, FROZEN_FINAL_DEV_GEOMETRY_V1);
    writeJson(path.join(outputDir, 'final_dev_fold_geometry.json'), result.finalDevFoldGeometry);
    writeJson(path.join(outputDir, 'final_dev_candidate_evidence.json'), result.candidateEvidence);
    writeJson(path.join(outputDir, 'final_dev_selection_evidence.json'), result.selectionEvidence);
    writeCsv(
      path.join(outputDir, 'final_dev_candidate_evidence.csv'),
      ['h','tau','foldCount','aggregateCalibratedBrierSkill','aggregateCalibratedLogLossSkill','aggregateRawAuc','retentionRate'],
      result.candidateEvidence.map((candidate) => [candidate.h,candidate.tau,candidate.folds.length,candidate.aggregateCalibratedBrierSkill,candidate.aggregateCalibratedLogLossSkill,candidate.aggregateRawMetrics.auc,candidate.aggregateInnerOOSRetentionRate]),
    );
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
      final_dev_implementation_binding_sha256: FINAL_DEV_IMPLEMENTATION_BINDING_V1R1.sha256,
      audited_nested_execution_id: AUDITED_NESTED_EXECUTION_V1R1.executionId,
      audited_nested_artifact_manifest_sha256: AUDITED_NESTED_EXECUTION_V1R1.artifactManifestSemanticSha256,
      final_dev_selection_executed: true,
      selected_label_spec: result.selectionEvidence.status === 'SELECTED' ? result.selectionEvidence.selected : null,
      future_lockbox_accessed: false,
    });

    const status: FinalDevExecutionStatusV1 = result.selectionEvidence.status === 'SELECTED'
      ? 'FINAL_DEV_SELECTION_COMPLETED_SELECTED_V1'
      : 'FINAL_DEV_SELECTION_COMPLETED_NO_VALID_LABEL_SPEC_V1';
    const manifest = artifactManifest(outputDir);
    writeJson(path.join(outputDir, 'final_dev_artifact_manifest.json'), { ...manifest, final_dev_implementation_binding_sha256: FINAL_DEV_IMPLEMENTATION_BINDING_V1R1.sha256 });
    console.log(JSON.stringify({
      status,
      execution_id: executionId,
      attempted_evaluations: result.attemptedEvaluations,
      completed_evaluations: result.completedEvaluations,
      invalid_evaluations: result.invalidEvaluations,
      selected: result.selectionEvidence.status === 'SELECTED' ? result.selectionEvidence.selected : null,
      output_dir: outputDir,
      artifact_manifest_sha256: manifest.manifest_sha256,
      future_lockbox_accessed: false,
    }, null, 2));
    return { status, outputDir };
  } catch (error) {
    persistFailureSafely(outputDir, executionId, error);
    console.error('FINAL_DEV_EXECUTION_INVALID_V1');
    console.error(error instanceof Error ? error.message : String(error));
    return { status: 'FINAL_DEV_EXECUTION_INVALID_V1', ...(outputDir ? { outputDir } : {}) };
  }
}

function main(): void {
  let options: CliOptionsV1;
  try {
    options = parseFinalDevArgsV1(process.argv.slice(2));
  } catch (error) {
    console.error('FINAL_DEV_EXECUTION_INVALID_V1');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  const result = executeFinalDevV1R1(repositoryRoot(), options);
  if (result.status === 'FINAL_DEV_EXECUTION_INVALID_V1' || result.status === 'ABORTED_FINAL_DEV_PREFLIGHT_MISMATCH') process.exitCode = 1;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invoked) main();
