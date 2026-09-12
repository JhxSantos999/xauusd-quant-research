import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMt5TabCsv } from '../data/mt5-parser.js';
import { auditCandles, enforceDatasetContract, M5_TIMEFRAME_MS } from '../data/contracts.js';
import { runNestedExperimentV1 } from '../engine/nested-experiment.js';
import {
  DEV_DATASET_BYTES_V1,
  DEV_DATASET_CANDLES_V1,
  DEV_DATASET_ID_V1,
  DEV_DATASET_SHA256_V1,
  DEV_INFORMATION_END_V1,
  DEV_FIRST_BAR_OPEN_TIME_V1,
  DEV_MAX_BAR_OPEN_TIME_V1,
  FROZEN_NESTED_GEOMETRY_V1,
  IMPLEMENTATION_FREEZE_IDENTITIES_V1,
  PREREGISTRATION_IDENTITIES_V1,
} from '../research/frozen-contracts.js';

export type ExecutionStatusV1 =
  | 'NESTED_EXECUTION_COMPLETED_VALIDATED_V1'
  | 'NESTED_EXECUTION_COMPLETED_NOT_VALIDATED_V1'
  | 'EXECUTION_INVALID_V1'
  | 'ABORTED_PREREGISTRATION_MISMATCH';

export type CliResultV1 =
  | { readonly kind: 'PREFLIGHT_ONLY'; readonly status: 'PREFLIGHT_PASS' }
  | { readonly kind: 'EXECUTION'; readonly status: ExecutionStatusV1; readonly outputDir?: string };

class PreregistrationMismatchError extends Error { override readonly name = 'PreregistrationMismatchError'; }
class OperationalExecutionError extends Error { override readonly name = 'OperationalExecutionError'; }

interface CliOptionsV1 { readonly dataset: string; readonly outputRoot?: string; readonly preflightOnly: boolean; }
interface FileIdentityV1 { readonly path: string; readonly bytes: number; readonly sha256: string }

function sha256Buffer(buffer: Buffer): string { return crypto.createHash('sha256').update(buffer).digest('hex'); }
export function parseArgsV1(args: readonly string[]): CliOptionsV1 {
  let dataset: string | undefined;
  let outputRoot: string | undefined;
  let preflightOnly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--dataset') { dataset = args[++i]; continue; }
    if (arg === '--output') { outputRoot = args[++i]; continue; }
    if (arg === '--preflight-only') { preflightOnly = true; continue; }
    throw new OperationalExecutionError(`UNKNOWN_ARGUMENT:${arg}`);
  }
  if (!dataset) throw new OperationalExecutionError('DATASET_PATH_REQUIRED');
  if (!preflightOnly && !outputRoot) throw new OperationalExecutionError('OUTPUT_ROOT_REQUIRED');
  return { dataset, ...(outputRoot ? { outputRoot } : {}), preflightOnly };
}

function verifyExactFile(root: string, identity: FileIdentityV1): { path: string; bytes: number; sha256: string } {
  const absolute = path.resolve(root, identity.path);
  if (!fs.existsSync(absolute)) throw new PreregistrationMismatchError(`PREREG_FILE_MISSING:${identity.path}`);
  const raw = fs.readFileSync(absolute);
  const sha256 = sha256Buffer(raw);
  if (raw.length !== identity.bytes || sha256 !== identity.sha256) throw new PreregistrationMismatchError(`PREREG_FILE_IDENTITY_MISMATCH:${identity.path}:${raw.length}:${sha256}`);
  return { path: identity.path, bytes: raw.length, sha256 };
}
function verifyManifestDependencies(root: string): void {
  const manifestPath = path.resolve(root, PREREGISTRATION_IDENTITIES_V1.manifest.path);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  if (manifest.dataset_sha256 !== DEV_DATASET_SHA256_V1) throw new PreregistrationMismatchError('MANIFEST_DATASET_HASH_MISMATCH');
  if (manifest.label_selection_rule_hash !== PREREGISTRATION_IDENTITIES_V1.selection.sha256) throw new PreregistrationMismatchError('MANIFEST_SELECTION_HASH_MISMATCH');
  if (manifest.walkforward_geometry_hash !== PREREGISTRATION_IDENTITIES_V1.geometry.sha256) throw new PreregistrationMismatchError('MANIFEST_GEOMETRY_HASH_MISMATCH');
  if (manifest.nested_validation_hash !== PREREGISTRATION_IDENTITIES_V1.nested.sha256) throw new PreregistrationMismatchError('MANIFEST_NESTED_HASH_MISMATCH');
}
function repositoryRoot(): string { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'); }
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
  for (const target of ['quant-core', 'research-reference']) { const absolute = path.resolve(root, target); if (fs.existsSync(absolute)) walk(absolute); }
  return files.sort();
}
function sourceManifest(root: string): { files: Record<string, { bytes: number; sha256: string }>; sha256: string } {
  const files: Record<string, { bytes: number; sha256: string }> = {};
  for (const relative of walkSourceFiles(root)) { const raw = fs.readFileSync(path.resolve(root, relative)); files[relative] = { bytes: raw.length, sha256: sha256Buffer(raw) }; }
  const canonical = JSON.stringify(files);
  return { files, sha256: sha256Buffer(Buffer.from(canonical)) };
}

export function preflightV1(root: string, datasetPath: string): {
  readonly dataset: { readonly path: string; readonly bytes: number; readonly sha256: string; readonly candles: number; readonly firstBarOpenTime: number; readonly lastBarOpenTime: number };
  readonly preregistration: readonly { path: string; bytes: number; sha256: string }[];
  readonly implementationFreeze: readonly { path: string; bytes: number; sha256: string }[];
} {
  const absoluteDataset = path.resolve(datasetPath);
  if (!fs.existsSync(absoluteDataset)) throw new OperationalExecutionError(`DATASET_NOT_FOUND:${absoluteDataset}`);
  const rawDataset = fs.readFileSync(absoluteDataset);
  const datasetSha256 = sha256Buffer(rawDataset);
  if (rawDataset.length !== DEV_DATASET_BYTES_V1 || datasetSha256 !== DEV_DATASET_SHA256_V1) throw new PreregistrationMismatchError(`DATASET_IDENTITY_MISMATCH:${rawDataset.length}:${datasetSha256}`);
  const preregistration = Object.values(PREREGISTRATION_IDENTITIES_V1).map((identity) => verifyExactFile(root, identity));
  verifyManifestDependencies(root);
  const implementationFreeze = Object.values(IMPLEMENTATION_FREEZE_IDENTITIES_V1).map((identity) => {
    const absolute = path.resolve(root, identity.path);
    if (!fs.existsSync(absolute)) throw new OperationalExecutionError(`IMPLEMENTATION_FREEZE_MISSING:${identity.path}`);
    const raw = fs.readFileSync(absolute);
    const sha256 = sha256Buffer(raw);
    if (raw.length !== identity.bytes || sha256 !== identity.sha256) throw new OperationalExecutionError(`IMPLEMENTATION_FREEZE_IDENTITY_MISMATCH:${identity.path}:${raw.length}:${sha256}`);
    return { path: identity.path, bytes: raw.length, sha256 };
  });
  let candles;
  try { candles = parseMt5TabCsv(rawDataset.toString('utf8')); }
  catch (error) { throw new OperationalExecutionError(`DATASET_PARSE_FAILED:${error instanceof Error ? error.message : String(error)}`); }
  const audit = auditCandles(candles);
  if (audit.candles !== DEV_DATASET_CANDLES_V1) throw new OperationalExecutionError(`DATASET_CANDLE_COUNT_MISMATCH:${audit.candles}`);
  if (audit.duplicateTimestamps !== 0 || audit.nonIncreasingTimestamps !== 0 || audit.invalidGeometry !== 0 || audit.nonFiniteValues !== 0) throw new OperationalExecutionError(`DATASET_AUDIT_FAILED:${JSON.stringify(audit)}`);
  try { enforceDatasetContract(candles, { datasetId: DEV_DATASET_ID_V1, datasetSha256, timeframeMs: M5_TIMEFRAME_MS, maxCandleOpenTime: DEV_MAX_BAR_OPEN_TIME_V1, maxInformationTime: DEV_INFORMATION_END_V1 }); }
  catch (error) { throw new OperationalExecutionError(`DATASET_CONTRACT_FAILED:${error instanceof Error ? error.message : String(error)}`); }
  if (audit.firstBarOpenTime !== DEV_FIRST_BAR_OPEN_TIME_V1) throw new OperationalExecutionError('DATASET_FIRST_BAR_MISMATCH');
  if (audit.lastBarOpenTime !== DEV_MAX_BAR_OPEN_TIME_V1) throw new OperationalExecutionError('DATASET_LAST_BAR_MISMATCH');
  return { dataset: { path: absoluteDataset, bytes: rawDataset.length, sha256: datasetSha256, candles: audit.candles, firstBarOpenTime: audit.firstBarOpenTime, lastBarOpenTime: audit.lastBarOpenTime }, preregistration, implementationFreeze };
}

function uniqueExecutionDirectory(outputRoot: string): { executionId: string; outputDir: string } {
  const utc = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const executionId = `exec_v1_${utc}`;
  let outputDir = path.resolve(outputRoot, executionId);
  let suffix = 0;
  while (fs.existsSync(outputDir)) outputDir = path.resolve(outputRoot, `${executionId}_${++suffix}`);
  fs.mkdirSync(outputDir, { recursive: false });
  return { executionId: path.basename(outputDir), outputDir };
}
function writeJson(filePath: string, value: unknown): void { fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n'); }
function writeCsv(filePath: string, header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): void {
  const escape = (value: string | number | null | undefined): string => { const s = value === null || value === undefined ? '' : String(value); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  fs.writeFileSync(filePath, [header.join(','), ...rows.map((row) => row.map(escape).join(','))].join('\n') + '\n');
}
function artifactManifest(outputDir: string): { files: Record<string, { byte_length: number; sha256: string }>; manifest_sha256: string } {
  const files: Record<string, { byte_length: number; sha256: string }> = {};
  for (const name of fs.readdirSync(outputDir).sort()) {
    if (name === 'empirical_execution_artifact_manifest.json') continue;
    const absolute = path.join(outputDir, name);
    if (!fs.statSync(absolute).isFile()) continue;
    const raw = fs.readFileSync(absolute);
    files[name] = { byte_length: raw.length, sha256: sha256Buffer(raw) };
  }
  return { files, manifest_sha256: sha256Buffer(Buffer.from(JSON.stringify(files))) };
}
function copyPreregistration(root: string, outputDir: string): void { for (const identity of Object.values(PREREGISTRATION_IDENTITIES_V1)) fs.copyFileSync(path.resolve(root, identity.path), path.join(outputDir, path.basename(identity.path))); }

export function executeProductionV1(root: string, options: CliOptionsV1): CliResultV1 {
  let preflight;
  try { preflight = preflightV1(root, options.dataset); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof PreregistrationMismatchError) { console.error('ABORTED_PREREGISTRATION_MISMATCH'); console.error(message); return { kind: 'EXECUTION', status: 'ABORTED_PREREGISTRATION_MISMATCH' }; }
    console.error('EXECUTION_INVALID_V1'); console.error(message); return { kind: 'EXECUTION', status: 'EXECUTION_INVALID_V1' };
  }
  console.log(JSON.stringify({ status: 'PREFLIGHT_PASS', ...preflight }, null, 2));
  if (options.preflightOnly) return { kind: 'PREFLIGHT_ONLY', status: 'PREFLIGHT_PASS' };

  const { executionId, outputDir } = uniqueExecutionDirectory(options.outputRoot!);
  const source = sourceManifest(root);
  const git = gitInfo(root);
  const provenance = { execution_id: executionId, utc_timestamp: new Date().toISOString(), runtime: { node: process.version, platform: process.platform, arch: process.arch }, git_commit: git.commit, git_dirty: git.dirty, quant_core_source_manifest_sha256: source.sha256, implementation_freeze: preflight.implementationFreeze, preregistration: preflight.preregistration, dataset: preflight.dataset };
  writeJson(path.join(outputDir, 'execution_provenance.json'), provenance);
  writeJson(path.join(outputDir, 'quant_core_source_manifest.json'), source);
  copyPreregistration(root, outputDir);

  try {
    const candles = parseMt5TabCsv(fs.readFileSync(preflight.dataset.path, 'utf8'));
    const result = runNestedExperimentV1(candles, FROZEN_NESTED_GEOMETRY_V1);
    writeJson(path.join(outputDir, 'outer_fold_geometry.json'), result.outerFoldGeometry);
    writeJson(path.join(outputDir, 'inner_candidate_evidence.json'), result.innerCandidateEvidence);
    writeJson(path.join(outputDir, 'inner_selection_evidence.json'), result.innerSelectionEvidence);
    writeJson(path.join(outputDir, 'outer_refit_evidence.json'), result.outerRefitEvidence);
    writeJson(path.join(outputDir, 'outer_oos_predictions.json'), result.outerOosPredictions);
    writeJson(path.join(outputDir, 'outer_oos_metrics.json'), result.outerOosMetrics);
    writeJson(path.join(outputDir, 'nested_validation_evidence.json'), result.nestedValidation);
    writeJson(path.join(outputDir, 'experiment_lineage.json'), {
      dataset_id: DEV_DATASET_ID_V1, dataset_sha256: DEV_DATASET_SHA256_V1, feature_schema_version: 'feature_schema_v1', label_engine_version: 'label_engine_v1', transformer_version: 'scaler_identity_v1', model_version: 'logreg_v1', calibration_version: 'platt_v1', selection_spec_sha256: PREREGISTRATION_IDENTITIES_V1.selection.sha256, geometry_spec_sha256: PREREGISTRATION_IDENTITIES_V1.geometry.sha256, nested_validation_spec_sha256: PREREGISTRATION_IDENTITIES_V1.nested.sha256, preregistration_manifest_sha256: PREREGISTRATION_IDENTITIES_V1.manifest.sha256, logreg_implementation_sha256: IMPLEMENTATION_FREEZE_IDENTITIES_V1.logreg.sha256, platt_implementation_sha256: IMPLEMENTATION_FREEZE_IDENTITIES_V1.platt.sha256, final_dev_selection_executed: false, future_lockbox_accessed: false,
    });
    writeCsv(path.join(outputDir, 'outer_oos_predictions.csv'), ['outerFoldId','decisionTime','selectedH','selectedTau','actualLabel','baselineProbability','rawProbability','calibratedProbability'], result.outerOosPredictions.map((p) => [p.outerFoldId,p.decisionTime,p.selectedH,p.selectedTau,p.actualLabel,p.baselineProbability,p.rawProbability,p.calibratedProbability]));
    writeCsv(path.join(outputDir, 'outer_oos_metrics.csv'), ['outerFoldId','brierSkill','logLossSkill','rawAuc','calibratedAuc','retentionRate'], result.outerOosMetrics.map((m) => [m.outerFoldId,m.brierSkill,m.logLossSkill,m.rawMetrics.auc,m.calibratedMetrics.auc,m.retentionRate]));
    writeCsv(path.join(outputDir, 'inner_candidate_evidence.csv'), ['outerFoldId','h','tau','retentionRate','aggregateCalibratedBrierSkill','aggregateCalibratedLogLossSkill','aggregateRawAuc'], result.innerCandidateEvidence.flatMap((outer) => outer.candidates.map((c) => [outer.outerFoldId,c.h,c.tau,c.aggregateInnerOOSRetentionRate,c.aggregateCalibratedBrierSkill,c.aggregateCalibratedLogLossSkill,c.aggregateRawMetrics.auc])));
    const status: ExecutionStatusV1 = result.nestedValidation.status === 'VALIDATED_V1' ? 'NESTED_EXECUTION_COMPLETED_VALIDATED_V1' : 'NESTED_EXECUTION_COMPLETED_NOT_VALIDATED_V1';
    const manifest = artifactManifest(outputDir);
    writeJson(path.join(outputDir, 'empirical_execution_artifact_manifest.json'), { ...manifest, preregistration_manifest_sha256: PREREGISTRATION_IDENTITIES_V1.manifest.sha256 });
    console.log(JSON.stringify({ status, execution_id: executionId, attempted_inner_evaluations: result.attemptedInnerEvaluations, completed_inner_evaluations: result.completedInnerEvaluations, invalid_inner_evaluations: result.invalidInnerEvaluations, output_dir: outputDir, artifact_manifest_sha256: manifest.manifest_sha256 }, null, 2));
    return { kind: 'EXECUTION', status, outputDir };
  } catch (error) {
    const failure = { execution_id: executionId, status: 'EXECUTION_INVALID_V1', utc_timestamp: new Date().toISOString(), error_name: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
    writeJson(path.join(outputDir, 'execution_error.json'), failure);
    const manifest = artifactManifest(outputDir);
    writeJson(path.join(outputDir, 'empirical_execution_artifact_manifest.json'), { ...manifest, preregistration_manifest_sha256: PREREGISTRATION_IDENTITIES_V1.manifest.sha256 });
    console.error('EXECUTION_INVALID_V1'); console.error(failure.message);
    return { kind: 'EXECUTION', status: 'EXECUTION_INVALID_V1', outputDir };
  }
}

function main(): void {
  let options: CliOptionsV1;
  try { options = parseArgsV1(process.argv.slice(2)); }
  catch (error) { console.error('EXECUTION_INVALID_V1'); console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; return; }
  const result = executeProductionV1(repositoryRoot(), options);
  if (result.kind === 'EXECUTION' && (result.status === 'EXECUTION_INVALID_V1' || result.status === 'ABORTED_PREREGISTRATION_MISMATCH')) process.exitCode = 1;
}
const invoked = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invoked) main();
