import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AUDITED_FINAL_SIGNAL_V1R1,
  AUDITED_RISK_ENGINE_V1,
  EXECUTION_ENGINE_V1_IMPLEMENTATION_BINDING,
  EXECUTION_ENGINE_V1_SPEC_IDENTITY,
  FROZEN_EXECUTION_BROKER_METADATA_V1,
} from '../research/execution-engine-contracts.js';

interface FileIdentityV1 { readonly path: string; readonly bytes: number; readonly sha256: string }
class ExecutionPreflightError extends Error { override readonly name = 'ExecutionPreflightError'; }

function sha256Buffer(buffer: Buffer): string { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function repositoryRoot(): string { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'); }
function verifyExactFile(baseDir: string, identity: FileIdentityV1, prefix: string): { path: string; bytes: number; sha256: string } {
  const absolute = path.resolve(baseDir, identity.path);
  if (!fs.existsSync(absolute)) throw new ExecutionPreflightError(`${prefix}_MISSING:${identity.path}`);
  const raw = fs.readFileSync(absolute);
  const sha256 = sha256Buffer(raw);
  if (raw.length !== identity.bytes || sha256 !== identity.sha256) throw new ExecutionPreflightError(`${prefix}_IDENTITY_MISMATCH:${identity.path}:${raw.length}:${sha256}`);
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
  const verified = verifyExactFile(root, EXECUTION_ENGINE_V1_IMPLEMENTATION_BINDING, 'EXECUTION_ENGINE_IMPLEMENTATION_BINDING');
  const binding = JSON.parse(fs.readFileSync(path.resolve(root, EXECUTION_ENGINE_V1_IMPLEMENTATION_BINDING.path), 'utf8')) as {
    semantic_spec?: FileIdentityV1;
    source_files?: Record<string, { bytes?: number; sha256?: string }>;
    created_before_any_execution_pnl_evaluation?: boolean;
    future_lockbox_accessed_at_freeze?: boolean;
  };
  if (binding.semantic_spec?.path !== EXECUTION_ENGINE_V1_SPEC_IDENTITY.path || binding.semantic_spec?.bytes !== EXECUTION_ENGINE_V1_SPEC_IDENTITY.bytes || binding.semantic_spec?.sha256 !== EXECUTION_ENGINE_V1_SPEC_IDENTITY.sha256) throw new ExecutionPreflightError('EXECUTION_ENGINE_BINDING_SPEC_MISMATCH');
  if (binding.created_before_any_execution_pnl_evaluation !== true || binding.future_lockbox_accessed_at_freeze !== false) throw new ExecutionPreflightError('EXECUTION_ENGINE_BINDING_GOVERNANCE_MISMATCH');
  for (const [relative, expected] of Object.entries(binding.source_files ?? {})) {
    const raw = fs.readFileSync(path.resolve(root, relative));
    if (raw.length !== expected.bytes || sha256Buffer(raw) !== expected.sha256) throw new ExecutionPreflightError(`EXECUTION_ENGINE_SOURCE_IDENTITY_MISMATCH:${relative}`);
  }
  return verified;
}

function verifyRiskLineage(root: string): unknown {
  const spec = verifyExactFile(root, AUDITED_RISK_ENGINE_V1.spec, 'AUDITED_RISK_ENGINE_SPEC');
  const implementationBinding = verifyExactFile(root, AUDITED_RISK_ENGINE_V1.implementationBinding, 'AUDITED_RISK_ENGINE_IMPLEMENTATION_BINDING');
  return { sourceCommit: AUDITED_RISK_ENGINE_V1.sourceCommit, spec, implementationBinding };
}

function verifyFinalSignalArtifacts(finalSignalArtifacts: string): unknown {
  const dir = path.resolve(finalSignalArtifacts);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new ExecutionPreflightError(`FINAL_SIGNAL_ARTIFACT_DIRECTORY_NOT_FOUND:${dir}`);
  const manifestPath = path.join(dir, 'final_signal_artifact_manifest.json');
  const modelPath = path.join(dir, 'final_signal_model.json');
  const calibratorPath = path.join(dir, 'final_signal_calibrator.json');
  for (const required of [manifestPath, modelPath, calibratorPath]) if (!fs.existsSync(required)) throw new ExecutionPreflightError(`FINAL_SIGNAL_REQUIRED_FILE_MISSING:${required}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { manifest_sha256?: string; files?: Record<string, { sha256?: string }> };
  const modelSha256 = sha256Buffer(fs.readFileSync(modelPath));
  const calibratorSha256 = sha256Buffer(fs.readFileSync(calibratorPath));
  if (manifest.manifest_sha256 !== AUDITED_FINAL_SIGNAL_V1R1.artifactManifestSemanticSha256) throw new ExecutionPreflightError('FINAL_SIGNAL_MANIFEST_MISMATCH');
  if (modelSha256 !== AUDITED_FINAL_SIGNAL_V1R1.modelSha256 || calibratorSha256 !== AUDITED_FINAL_SIGNAL_V1R1.calibratorSha256) throw new ExecutionPreflightError('FINAL_SIGNAL_MODEL_CALIBRATOR_MISMATCH');
  return { executionId: AUDITED_FINAL_SIGNAL_V1R1.executionId, artifactManifestSemanticSha256: manifest.manifest_sha256, modelSha256, calibratorSha256 };
}

function parseArgs(args: readonly string[]): { finalSignalArtifacts: string } {
  let finalSignalArtifacts: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--final-signal-artifacts') { finalSignalArtifacts = args[++i]; continue; }
    throw new ExecutionPreflightError(`UNKNOWN_ARGUMENT:${arg}`);
  }
  if (!finalSignalArtifacts) throw new ExecutionPreflightError('FINAL_SIGNAL_ARTIFACT_DIRECTORY_REQUIRED');
  return { finalSignalArtifacts };
}

export function executionEnginePreflightV1(root: string, finalSignalArtifacts: string): unknown {
  const executionEngineSpec = verifyExactFile(root, EXECUTION_ENGINE_V1_SPEC_IDENTITY, 'EXECUTION_ENGINE_SPEC');
  const executionEngineImplementationBinding = verifyImplementationBinding(root);
  const riskLineage = verifyRiskLineage(root);
  const auditedFinalSignal = verifyFinalSignalArtifacts(finalSignalArtifacts);
  const git = gitInfo(root);
  if (!git.commit || git.dirty !== false) throw new ExecutionPreflightError(`SOURCE_SNAPSHOT_NOT_CLEAN:${git.commit ?? 'UNKNOWN'}:${String(git.dirty)}`);
  return {
    status: 'EXECUTION_ENGINE_PREFLIGHT_PASS',
    git,
    executionEngineSpec,
    executionEngineImplementationBinding,
    brokerMetadata: FROZEN_EXECUTION_BROKER_METADATA_V1,
    riskLineage,
    auditedFinalSignal,
    execution_pnl_evaluated: false,
    future_lockbox_accessed: false,
    live_deployment_metadata_pending: true,
  };
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2));
    console.log(JSON.stringify(executionEnginePreflightV1(repositoryRoot(), options.finalSignalArtifacts), null, 2));
  } catch (error) {
    console.error('EXECUTION_ENGINE_PREFLIGHT_INVALID');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedAsScript = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invokedAsScript) main();
