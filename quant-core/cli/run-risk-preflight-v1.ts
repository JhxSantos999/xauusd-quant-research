import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AUDITED_FINAL_SIGNAL_EXECUTION_V1R1,
  RISK_ENGINE_V1_IMPLEMENTATION_BINDING,
  RISK_ENGINE_V1_SPEC_IDENTITY,
} from '../research/risk-engine-contracts.js';

interface FileIdentityV1 { readonly path: string; readonly bytes: number; readonly sha256: string }
class RiskPreflightError extends Error { override readonly name = 'RiskPreflightError'; }

function sha256Buffer(buffer: Buffer): string { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function repositoryRoot(): string { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'); }

function verifyExactFile(baseDir: string, identity: FileIdentityV1, prefix: string): { path: string; bytes: number; sha256: string } {
  const absolute = path.resolve(baseDir, identity.path);
  if (!fs.existsSync(absolute)) throw new RiskPreflightError(`${prefix}_MISSING:${identity.path}`);
  const raw = fs.readFileSync(absolute);
  const sha256 = sha256Buffer(raw);
  if (raw.length !== identity.bytes || sha256 !== identity.sha256) throw new RiskPreflightError(`${prefix}_IDENTITY_MISMATCH:${identity.path}:${raw.length}:${sha256}`);
  return { path: identity.path, bytes: raw.length, sha256 };
}

function gitInfo(root: string): { commit: string | null; dirty: boolean | null } {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { commit, dirty: status.trim().length > 0 };
  } catch { return { commit: null, dirty: null }; }
}

function verifyImplementationBinding(root: string): { path: string; bytes: number; sha256: string } {
  const verified = verifyExactFile(root, RISK_ENGINE_V1_IMPLEMENTATION_BINDING, 'RISK_ENGINE_IMPLEMENTATION_BINDING');
  const binding = JSON.parse(fs.readFileSync(path.resolve(root, RISK_ENGINE_V1_IMPLEMENTATION_BINDING.path), 'utf8')) as {
    semantic_spec?: FileIdentityV1;
    source_files?: Record<string, { bytes?: number; sha256?: string }>;
    created_before_any_risk_pnl_evaluation?: boolean;
    future_lockbox_accessed_at_freeze?: boolean;
  };
  if (binding.semantic_spec?.path !== RISK_ENGINE_V1_SPEC_IDENTITY.path
    || binding.semantic_spec?.bytes !== RISK_ENGINE_V1_SPEC_IDENTITY.bytes
    || binding.semantic_spec?.sha256 !== RISK_ENGINE_V1_SPEC_IDENTITY.sha256) throw new RiskPreflightError('RISK_ENGINE_BINDING_SPEC_MISMATCH');
  if (binding.created_before_any_risk_pnl_evaluation !== true || binding.future_lockbox_accessed_at_freeze !== false) throw new RiskPreflightError('RISK_ENGINE_BINDING_GOVERNANCE_MISMATCH');
  for (const [relative, expected] of Object.entries(binding.source_files ?? {})) {
    const raw = fs.readFileSync(path.resolve(root, relative));
    const sha256 = sha256Buffer(raw);
    if (raw.length !== expected.bytes || sha256 !== expected.sha256) throw new RiskPreflightError(`RISK_ENGINE_SOURCE_IDENTITY_MISMATCH:${relative}:${raw.length}:${sha256}`);
  }
  return verified;
}

function verifyAuditedFinalSignal(finalSignalDir: string): {
  executionId: string;
  artifactManifestSemanticSha256: string;
  selected: { h: number; tau: number };
  verifiedFiles: readonly { path: string; bytes: number; sha256: string }[];
} {
  const dir = path.resolve(finalSignalDir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new RiskPreflightError(`FINAL_SIGNAL_ARTIFACT_DIRECTORY_NOT_FOUND:${dir}`);
  const identities = AUDITED_FINAL_SIGNAL_EXECUTION_V1R1.files;
  const verifiedFiles = Object.values(identities).map((identity) => verifyExactFile(dir, identity, 'AUDITED_FINAL_SIGNAL_FILE'));

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, identities.artifactManifest.path), 'utf8')) as { files?: Record<string, { byte_length?: number; sha256?: string }>; manifest_sha256?: string };
  if (manifest.manifest_sha256 !== AUDITED_FINAL_SIGNAL_EXECUTION_V1R1.artifactManifestSemanticSha256) throw new RiskPreflightError('AUDITED_FINAL_SIGNAL_MANIFEST_SEMANTIC_HASH_MISMATCH');
  for (const identity of Object.values(identities)) {
    if (identity.path === identities.artifactManifest.path) continue;
    const entry = manifest.files?.[identity.path];
    if (!entry || entry.byte_length !== identity.bytes || entry.sha256 !== identity.sha256) throw new RiskPreflightError(`AUDITED_FINAL_SIGNAL_MANIFEST_ENTRY_MISMATCH:${identity.path}`);
  }

  const model = JSON.parse(fs.readFileSync(path.join(dir, identities.model.path), 'utf8')) as { artifact_role?: string; selected_label_spec?: { h?: number; tau?: number }; model?: { version?: string; featureCount?: number } };
  if (model.artifact_role !== 'final_signal_model' || model.selected_label_spec?.h !== 3 || model.selected_label_spec?.tau !== 0 || model.model?.version !== 'logreg_v1' || model.model?.featureCount !== 10) throw new RiskPreflightError('AUDITED_FINAL_SIGNAL_MODEL_SEMANTIC_MISMATCH');

  const calibrator = JSON.parse(fs.readFileSync(path.join(dir, identities.calibrator.path), 'utf8')) as { artifact_role?: string; selected_label_spec?: { h?: number; tau?: number }; calibrator?: { version?: string } };
  if (calibrator.artifact_role !== 'final_signal_calibrator' || calibrator.selected_label_spec?.h !== 3 || calibrator.selected_label_spec?.tau !== 0 || calibrator.calibrator?.version !== 'platt_v1') throw new RiskPreflightError('AUDITED_FINAL_SIGNAL_CALIBRATOR_SEMANTIC_MISMATCH');

  const provenance = JSON.parse(fs.readFileSync(path.join(dir, identities.provenance.path), 'utf8')) as { execution_id?: string; git_commit?: string | null; git_dirty?: boolean | null; future_lockbox_accessed?: boolean };
  if (provenance.execution_id !== AUDITED_FINAL_SIGNAL_EXECUTION_V1R1.executionId || provenance.git_commit !== AUDITED_FINAL_SIGNAL_EXECUTION_V1R1.sourceCommit || provenance.git_dirty !== false || provenance.future_lockbox_accessed !== false) throw new RiskPreflightError('AUDITED_FINAL_SIGNAL_PROVENANCE_MISMATCH');

  const lineage = JSON.parse(fs.readFileSync(path.join(dir, identities.lineage.path), 'utf8')) as Record<string, unknown>;
  const selected = lineage.selected_label_spec as { h?: number; tau?: number } | undefined;
  if (lineage.final_signal_model_fit_executed !== true || lineage.risk_engine_executed !== false || lineage.execution_engine_executed !== false || lineage.future_lockbox_accessed !== false || selected?.h !== 3 || selected?.tau !== 0) throw new RiskPreflightError('AUDITED_FINAL_SIGNAL_LINEAGE_MISMATCH');

  return { executionId: AUDITED_FINAL_SIGNAL_EXECUTION_V1R1.executionId, artifactManifestSemanticSha256: AUDITED_FINAL_SIGNAL_EXECUTION_V1R1.artifactManifestSemanticSha256, selected: AUDITED_FINAL_SIGNAL_EXECUTION_V1R1.selected, verifiedFiles };
}

function parseArgs(args: readonly string[]): { finalSignalArtifacts: string } {
  let finalSignalArtifacts: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--final-signal-artifacts') { finalSignalArtifacts = args[++i]; continue; }
    throw new RiskPreflightError(`UNKNOWN_ARGUMENT:${arg}`);
  }
  if (!finalSignalArtifacts) throw new RiskPreflightError('FINAL_SIGNAL_ARTIFACT_DIRECTORY_REQUIRED');
  return { finalSignalArtifacts };
}

export function riskEnginePreflightV1(root: string, finalSignalArtifacts: string): unknown {
  const spec = verifyExactFile(root, RISK_ENGINE_V1_SPEC_IDENTITY, 'RISK_ENGINE_SPEC');
  const implementationBinding = verifyImplementationBinding(root);
  const auditedFinalSignal = verifyAuditedFinalSignal(finalSignalArtifacts);
  const git = gitInfo(root);
  if (!git.commit || git.dirty !== false) throw new RiskPreflightError(`SOURCE_SNAPSHOT_NOT_CLEAN:${git.commit ?? 'UNKNOWN'}:${String(git.dirty)}`);
  return { status: 'RISK_ENGINE_PREFLIGHT_PASS', git, riskEngineSpec: spec, riskEngineImplementationBinding: implementationBinding, auditedFinalSignal, future_lockbox_accessed: false, risk_pnl_evaluated: false };
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2));
    console.log(JSON.stringify(riskEnginePreflightV1(repositoryRoot(), options.finalSignalArtifacts), null, 2));
  } catch (error) {
    console.error('RISK_ENGINE_PREFLIGHT_INVALID');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedAsScript = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invokedAsScript) main();
