import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R1,
  ECONOMIC_EVALUATION_V1R1_LOCKBOX,
  ECONOMIC_EVALUATION_V1R1_PRIMARY_ACCOUNT,
  ECONOMIC_EVALUATION_V1R1_PRIMARY_GATES,
  ECONOMIC_EVALUATION_V1R1_SCENARIOS,
  ECONOMIC_EVALUATION_V1R1_SPEC_IDENTITY,
  EXECUTION_ENGINE_V1R1_IMPLEMENTATION_IDENTITY_FOR_ECONOMIC,
  EXECUTION_ENGINE_V1R1_SPEC_IDENTITY_FOR_ECONOMIC,
  INFINOX_XAUUSD_MT5_METADATA_V1_IDENTITY,
  INFINOX_XAUUSD_RAW_CAPTURE_V1_IDENTITY,
} from '../research/economic-evaluation-v1r1-contracts.js';

interface FileIdentityV1 { readonly path: string; readonly bytes: number; readonly sha256: string }
class EconomicV1R1PreflightError extends Error { override readonly name = 'EconomicV1R1PreflightError'; }

function sha256Buffer(buffer: Buffer): string { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function repositoryRoot(): string { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'); }

function verifyExactFile(baseDir: string, identity: FileIdentityV1, prefix: string): { path: string; bytes: number; sha256: string } {
  const absolute = path.resolve(baseDir, identity.path);
  if (!fs.existsSync(absolute)) throw new EconomicV1R1PreflightError(`${prefix}_MISSING:${identity.path}`);
  const raw = fs.readFileSync(absolute);
  const sha256 = sha256Buffer(raw);
  if (raw.length !== identity.bytes || sha256 !== identity.sha256) {
    throw new EconomicV1R1PreflightError(`${prefix}_IDENTITY_MISMATCH:${identity.path}:${raw.length}:${sha256}`);
  }
  return { path: identity.path, bytes: raw.length, sha256 };
}

function gitInfo(root: string): { commit: string | null; dirty: boolean | null } {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { commit, dirty: status.trim().length > 0 };
  } catch { return { commit: null, dirty: null }; }
}

function parseKeyValueCapture(raw: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const i = line.indexOf('=');
    if (i <= 0) throw new EconomicV1R1PreflightError(`MT5_CAPTURE_INVALID_LINE:${line}`);
    const key = line.slice(0, i);
    const value = line.slice(i + 1);
    if (values.has(key)) throw new EconomicV1R1PreflightError(`MT5_CAPTURE_DUPLICATE_KEY:${key}`);
    values.set(key, value);
  }
  return values;
}

function verifyRawMt5Capture(capturePath: string): unknown {
  const absolute = path.resolve(capturePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new EconomicV1R1PreflightError(`MT5_CAPTURE_NOT_FOUND:${absolute}`);
  const raw = fs.readFileSync(absolute);
  const sha256 = sha256Buffer(raw);
  if (raw.length !== INFINOX_XAUUSD_RAW_CAPTURE_V1_IDENTITY.bytes || sha256 !== INFINOX_XAUUSD_RAW_CAPTURE_V1_IDENTITY.sha256) {
    throw new EconomicV1R1PreflightError(`MT5_CAPTURE_IDENTITY_MISMATCH:${raw.length}:${sha256}`);
  }
  const kv = parseKeyValueCapture(raw.toString('utf8'));
  const expected: Readonly<Record<string, string>> = {
    FORMAT_VERSION: 'mt5_symbol_metadata_capture_v1',
    SYMBOL: 'XAUUSD',
    TERMINAL_COMPANY: 'Infinox Limited',
    ACCOUNT_SERVER: 'InfinoxLimited-MT5Live',
    ACCOUNT_LEVERAGE: '1000',
    SYMBOL_DIGITS: '2',
    SYMBOL_POINT: '0.0100000000',
    SYMBOL_TRADE_CONTRACT_SIZE: '100.0000000000',
    SYMBOL_TRADE_TICK_SIZE: '0.0100000000',
    SYMBOL_TRADE_TICK_VALUE: '1.0000000000',
    SYMBOL_TRADE_TICK_VALUE_PROFIT: '1.0000000000',
    SYMBOL_TRADE_TICK_VALUE_LOSS: '1.0000000000',
    SYMBOL_VOLUME_MIN: '0.0100000000',
    SYMBOL_VOLUME_MAX: '20.0000000000',
    SYMBOL_VOLUME_STEP: '0.0100000000',
    SYMBOL_TRADE_STOPS_LEVEL: '20',
    SESSION_MONDAY_2_FROM: '01:01:00',
    SESSION_MONDAY_2_TO: '23:58:00',
    SESSION_TUESDAY_2_FROM: '01:01:00',
    SESSION_TUESDAY_2_TO: '23:58:00',
    SESSION_WEDNESDAY_2_FROM: '01:01:00',
    SESSION_WEDNESDAY_2_TO: '23:58:00',
    SESSION_THURSDAY_2_FROM: '01:01:00',
    SESSION_THURSDAY_2_TO: '23:58:00',
    SESSION_FRIDAY_2_FROM: '01:01:00',
    SESSION_FRIDAY_2_TO: '23:57:00',
    SYMBOL_TRADE_SESSIONS_COUNT: '15',
    SESSIONS_END: '1',
  };
  for (const [key, value] of Object.entries(expected)) {
    if (kv.get(key) !== value) throw new EconomicV1R1PreflightError(`MT5_CAPTURE_FIELD_MISMATCH:${key}:${kv.get(key) ?? 'MISSING'}:${value}`);
  }
  return {
    path: absolute,
    bytes: raw.length,
    sha256,
    captureTimeUtc: kv.get('CAPTURE_TIME_UTC'),
    broker: kv.get('TERMINAL_COMPANY'),
    server: kv.get('ACCOUNT_SERVER'),
    symbol: kv.get('SYMBOL'),
    tickSize: Number(kv.get('SYMBOL_TRADE_TICK_SIZE')),
    tickValue: Number(kv.get('SYMBOL_TRADE_TICK_VALUE')),
    tickValueProfit: Number(kv.get('SYMBOL_TRADE_TICK_VALUE_PROFIT')),
    tickValueLoss: Number(kv.get('SYMBOL_TRADE_TICK_VALUE_LOSS')),
    sessionRecords: Number(kv.get('SYMBOL_TRADE_SESSIONS_COUNT')),
  };
}

function verifyExecutionImplementationSource(root: string): unknown {
  const bindingPath = path.resolve(root, EXECUTION_ENGINE_V1R1_IMPLEMENTATION_IDENTITY_FOR_ECONOMIC.path);
  const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8')) as {
    source_files?: Record<string, { bytes?: number; sha256?: string }>;
  };
  const source = binding.source_files?.['quant-core/execution/execution-engine-v1r1.ts'];
  if (!source || typeof source.bytes !== 'number' || typeof source.sha256 !== 'string') throw new EconomicV1R1PreflightError('EXECUTION_V1R1_SOURCE_BINDING_MISSING');
  return verifyExactFile(root, { path: 'quant-core/execution/execution-engine-v1r1.ts', bytes: source.bytes, sha256: source.sha256 }, 'EXECUTION_V1R1_SOURCE');
}

function verifyFinalSignalArtifacts(finalSignalDir: string): unknown {
  const dir = path.resolve(finalSignalDir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new EconomicV1R1PreflightError(`FINAL_SIGNAL_ARTIFACT_DIRECTORY_NOT_FOUND:${dir}`);
  const files = {
    manifest: { path: 'final_signal_artifact_manifest.json', sha256: 'b6b169ae88d9feaf4060528f4c5e2b17d6ef79da500a6bd7096835fae4a680e0', bytes: 3443 },
    model: { path: 'final_signal_model.json', sha256: AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R1.modelSha256, bytes: 1073 },
    calibrator: { path: 'final_signal_calibrator.json', sha256: AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R1.calibratorSha256, bytes: 684 },
    provenance: { path: 'execution_provenance.json', sha256: '1d6b8a538aa821afb7ae8fc1e8213f83d1aba949f35ecf14a3ab601a27dfe370', bytes: 3553 },
    lineage: { path: 'experiment_lineage.json', sha256: '952d5ff0e7d3915398bf4ca4f914978bd0c556e745df9e9379fa0a476087d5b1', bytes: 1285 },
  } as const;
  const verified = Object.values(files).map((identity) => verifyExactFile(dir, identity, 'FINAL_SIGNAL_FILE'));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, files.manifest.path), 'utf8')) as { manifest_sha256?: string };
  if (manifest.manifest_sha256 !== AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R1.artifactManifestSemanticSha256) throw new EconomicV1R1PreflightError('FINAL_SIGNAL_MANIFEST_SEMANTIC_HASH_MISMATCH');
  const provenance = JSON.parse(fs.readFileSync(path.join(dir, files.provenance.path), 'utf8')) as { execution_id?: string; future_lockbox_accessed?: boolean };
  if (provenance.execution_id !== AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R1.executionId || provenance.future_lockbox_accessed !== false) throw new EconomicV1R1PreflightError('FINAL_SIGNAL_PROVENANCE_MISMATCH');
  return {
    executionId: AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R1.executionId,
    artifactManifestSemanticSha256: AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R1.artifactManifestSemanticSha256,
    modelSha256: AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R1.modelSha256,
    calibratorSha256: AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R1.calibratorSha256,
    verifiedFiles: verified,
  };
}

function parseArgs(args: readonly string[]): { finalSignalArtifacts: string; mt5MetadataCapture: string } {
  let finalSignalArtifacts: string | undefined;
  let mt5MetadataCapture: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--final-signal-artifacts') { finalSignalArtifacts = args[++i]; continue; }
    if (arg === '--mt5-metadata-capture') { mt5MetadataCapture = args[++i]; continue; }
    throw new EconomicV1R1PreflightError(`UNKNOWN_ARGUMENT:${arg}`);
  }
  if (!finalSignalArtifacts) throw new EconomicV1R1PreflightError('FINAL_SIGNAL_ARTIFACT_DIRECTORY_REQUIRED');
  if (!mt5MetadataCapture) throw new EconomicV1R1PreflightError('MT5_METADATA_CAPTURE_REQUIRED');
  return { finalSignalArtifacts, mt5MetadataCapture };
}

export function economicEvaluationPreflightV1R1(root: string, finalSignalArtifacts: string, mt5MetadataCapture: string): unknown {
  const economicSpec = verifyExactFile(root, ECONOMIC_EVALUATION_V1R1_SPEC_IDENTITY, 'ECONOMIC_V1R1_SPEC');
  const executionSpec = verifyExactFile(root, EXECUTION_ENGINE_V1R1_SPEC_IDENTITY_FOR_ECONOMIC, 'EXECUTION_V1R1_SPEC');
  const executionBinding = verifyExactFile(root, EXECUTION_ENGINE_V1R1_IMPLEMENTATION_IDENTITY_FOR_ECONOMIC, 'EXECUTION_V1R1_IMPLEMENTATION');
  const metadataBinding = verifyExactFile(root, INFINOX_XAUUSD_MT5_METADATA_V1_IDENTITY, 'MT5_METADATA_BINDING');
  const executionSource = verifyExecutionImplementationSource(root);
  const rawMetadataCapture = verifyRawMt5Capture(mt5MetadataCapture);
  const auditedFinalSignal = verifyFinalSignalArtifacts(finalSignalArtifacts);
  const git = gitInfo(root);
  if (!git.commit || git.dirty !== false) throw new EconomicV1R1PreflightError(`SOURCE_SNAPSHOT_NOT_CLEAN:${git.commit ?? 'UNKNOWN'}:${String(git.dirty)}`);
  return {
    status: 'ECONOMIC_EVALUATION_V1R1_PREFLIGHT_PASS',
    git,
    economicEvaluationSpec: economicSpec,
    executionV1R1: { spec: executionSpec, implementationBinding: executionBinding, source: executionSource },
    mt5Metadata: { binding: metadataBinding, rawCapture: rawMetadataCapture },
    auditedFinalSignal,
    lockboxContract: {
      informationStart: ECONOMIC_EVALUATION_V1R1_LOCKBOX.informationStart,
      firstPotentialDecisionTime: ECONOMIC_EVALUATION_V1R1_LOCKBOX.firstPotentialDecisionTime,
      informationEnd: ECONOMIC_EVALUATION_V1R1_LOCKBOX.informationEnd,
      calendarDays: ECONOMIC_EVALUATION_V1R1_LOCKBOX.calendarDays,
      partialEvaluationAllowed: false,
      fullRunAllowedBeforeInformationEnd: false,
      fullRunAllowedNow: Date.now() >= ECONOMIC_EVALUATION_V1R1_LOCKBOX.informationEnd,
    },
    primaryAccount: ECONOMIC_EVALUATION_V1R1_PRIMARY_ACCOUNT,
    primaryGates: ECONOMIC_EVALUATION_V1R1_PRIMARY_GATES,
    scenarios: ECONOMIC_EVALUATION_V1R1_SCENARIOS,
    sessionExecutionPolicy: {
      observedM5ContiguityRequired: true,
      requiredOffsetsMs: [0, 300000, 600000, 900000],
      missingRequiredBar: 'NO_FILL_SESSION_WINDOW',
      lateExitAfterGapAllowed: false,
    },
    lockbox_accessed: false,
    pnl_evaluated: false,
    live_deployment_metadata_pending: false,
  };
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2));
    console.log(JSON.stringify(economicEvaluationPreflightV1R1(repositoryRoot(), options.finalSignalArtifacts, options.mt5MetadataCapture), null, 2));
  } catch (error) {
    console.error('ECONOMIC_EVALUATION_V1R1_PREFLIGHT_INVALID');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedAsScript = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invokedAsScript) main();
