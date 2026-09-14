import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AUDITED_EXECUTION_ENGINE_V1,
  AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_EVAL,
  ECONOMIC_EVALUATION_V1_LOCKBOX,
  ECONOMIC_EVALUATION_V1_PRIMARY_ACCOUNT,
  ECONOMIC_EVALUATION_V1_PRIMARY_GATES,
  ECONOMIC_EVALUATION_V1_REQUIRED_MT5_FIELDS,
  ECONOMIC_EVALUATION_V1_SCENARIOS,
  ECONOMIC_EVALUATION_V1_SPEC_IDENTITY,
} from '../research/economic-evaluation-contracts.js';

interface FileIdentityV1 { readonly path: string; readonly bytes: number; readonly sha256: string }
class EconomicPreflightError extends Error { override readonly name = 'EconomicPreflightError'; }

function sha256Buffer(buffer: Buffer): string { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function repositoryRoot(): string { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'); }

function verifyExactFile(baseDir: string, identity: FileIdentityV1, prefix: string): { path: string; bytes: number; sha256: string } {
  const absolute = path.resolve(baseDir, identity.path);
  if (!fs.existsSync(absolute)) throw new EconomicPreflightError(`${prefix}_MISSING:${identity.path}`);
  const raw = fs.readFileSync(absolute);
  const sha256 = sha256Buffer(raw);
  if (raw.length !== identity.bytes || sha256 !== identity.sha256) {
    throw new EconomicPreflightError(`${prefix}_IDENTITY_MISMATCH:${identity.path}:${raw.length}:${sha256}`);
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

function verifyFinalSignalArtifacts(finalSignalDir: string): unknown {
  const dir = path.resolve(finalSignalDir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new EconomicPreflightError(`FINAL_SIGNAL_ARTIFACT_DIRECTORY_NOT_FOUND:${dir}`);
  }
  const files = {
    manifest: { path: 'final_signal_artifact_manifest.json', sha256: 'b6b169ae88d9feaf4060528f4c5e2b17d6ef79da500a6bd7096835fae4a680e0', bytes: 3443 },
    model: { path: 'final_signal_model.json', sha256: AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_EVAL.modelSha256, bytes: 1073 },
    calibrator: { path: 'final_signal_calibrator.json', sha256: AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_EVAL.calibratorSha256, bytes: 684 },
    provenance: { path: 'execution_provenance.json', sha256: '1d6b8a538aa821afb7ae8fc1e8213f83d1aba949f35ecf14a3ab601a27dfe370', bytes: 3553 },
    lineage: { path: 'experiment_lineage.json', sha256: '952d5ff0e7d3915398bf4ca4f914978bd0c556e745df9e9379fa0a476087d5b1', bytes: 1285 },
  } as const;
  const verified = Object.values(files).map((identity) => verifyExactFile(dir, identity, 'FINAL_SIGNAL_FILE'));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, files.manifest.path), 'utf8')) as { manifest_sha256?: string };
  if (manifest.manifest_sha256 !== AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_EVAL.artifactManifestSemanticSha256) {
    throw new EconomicPreflightError('FINAL_SIGNAL_MANIFEST_SEMANTIC_HASH_MISMATCH');
  }
  const provenance = JSON.parse(fs.readFileSync(path.join(dir, files.provenance.path), 'utf8')) as { execution_id?: string; future_lockbox_accessed?: boolean };
  if (provenance.execution_id !== AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_EVAL.executionId || provenance.future_lockbox_accessed !== false) {
    throw new EconomicPreflightError('FINAL_SIGNAL_PROVENANCE_MISMATCH');
  }
  return {
    executionId: AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_EVAL.executionId,
    artifactManifestSemanticSha256: AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_EVAL.artifactManifestSemanticSha256,
    modelSha256: AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_EVAL.modelSha256,
    calibratorSha256: AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_EVAL.calibratorSha256,
    verifiedFiles: verified,
  };
}

function parseArgs(args: readonly string[]): { finalSignalArtifacts: string } {
  let finalSignalArtifacts: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--final-signal-artifacts') { finalSignalArtifacts = args[++i]; continue; }
    throw new EconomicPreflightError(`UNKNOWN_ARGUMENT:${arg}`);
  }
  if (!finalSignalArtifacts) throw new EconomicPreflightError('FINAL_SIGNAL_ARTIFACT_DIRECTORY_REQUIRED');
  return { finalSignalArtifacts };
}

export function economicEvaluationPreflightV1(root: string, finalSignalArtifacts: string): unknown {
  const spec = verifyExactFile(root, ECONOMIC_EVALUATION_V1_SPEC_IDENTITY, 'ECONOMIC_EVALUATION_SPEC');
  const executionSpec = verifyExactFile(root, AUDITED_EXECUTION_ENGINE_V1.spec, 'EXECUTION_ENGINE_SPEC');
  const executionBinding = verifyExactFile(root, AUDITED_EXECUTION_ENGINE_V1.implementationBinding, 'EXECUTION_ENGINE_IMPLEMENTATION');
  const auditedFinalSignal = verifyFinalSignalArtifacts(finalSignalArtifacts);
  const git = gitInfo(root);
  if (!git.commit || git.dirty !== false) throw new EconomicPreflightError(`SOURCE_SNAPSHOT_NOT_CLEAN:${git.commit ?? 'UNKNOWN'}:${String(git.dirty)}`);
  return {
    status: 'ECONOMIC_EVALUATION_PREFLIGHT_PASS',
    git,
    economicEvaluationSpec: spec,
    executionLineage: { sourceCommit: AUDITED_EXECUTION_ENGINE_V1.sourceCommit, spec: executionSpec, implementationBinding: executionBinding },
    auditedFinalSignal,
    lockboxContract: {
      informationStart: ECONOMIC_EVALUATION_V1_LOCKBOX.informationStart,
      firstPotentialDecisionTime: ECONOMIC_EVALUATION_V1_LOCKBOX.firstPotentialDecisionTime,
      informationEnd: ECONOMIC_EVALUATION_V1_LOCKBOX.informationEnd,
      calendarDays: ECONOMIC_EVALUATION_V1_LOCKBOX.calendarDays,
      partialEvaluationAllowed: false,
      fullRunAllowedBeforeInformationEnd: false,
    },
    primaryAccount: ECONOMIC_EVALUATION_V1_PRIMARY_ACCOUNT,
    primaryGates: ECONOMIC_EVALUATION_V1_PRIMARY_GATES,
    scenarios: ECONOMIC_EVALUATION_V1_SCENARIOS,
    requiredMt5FieldsBeforeFullRun: ECONOMIC_EVALUATION_V1_REQUIRED_MT5_FIELDS,
    lockbox_accessed: false,
    pnl_evaluated: false,
    live_deployment_metadata_pending: true,
  };
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2));
    console.log(JSON.stringify(economicEvaluationPreflightV1(repositoryRoot(), options.finalSignalArtifacts), null, 2));
  } catch (error) {
    console.error('ECONOMIC_EVALUATION_PREFLIGHT_INVALID');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedAsScript = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invokedAsScript) main();
