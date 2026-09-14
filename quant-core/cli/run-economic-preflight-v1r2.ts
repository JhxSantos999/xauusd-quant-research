import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R2,
  ECONOMIC_EVALUATION_V1R2_LOCKBOX,
  ECONOMIC_EVALUATION_V1R2_PRIMARY_ACCOUNT,
  ECONOMIC_EVALUATION_V1R2_PRIMARY_GATES,
  ECONOMIC_EVALUATION_V1R2_SCENARIOS,
  ECONOMIC_EVALUATION_V1R2_SPEC_IDENTITY,
  EXECUTION_ENGINE_V1R2_IMPLEMENTATION_IDENTITY_FOR_ECONOMIC,
  EXECUTION_ENGINE_V1R2_SOURCE_IDENTITY_FOR_ECONOMIC,
  EXECUTION_ENGINE_V1R2_SPEC_IDENTITY_FOR_ECONOMIC,
  INFINOX_STP_COMMISSION_EVIDENCE_V1_IDENTITY,
  INFINOX_XAUUSD_MT5_METADATA_V1_IDENTITY_FOR_V1R2,
} from '../research/economic-evaluation-v1r2-contracts.js';
import { economicEvaluationPreflightV1R1 } from './run-economic-preflight-v1r1.js';

interface FileIdentityV1R2 { readonly path: string; readonly bytes: number; readonly sha256: string }
class EconomicV1R2PreflightError extends Error { override readonly name = 'EconomicV1R2PreflightError'; }

function sha256Buffer(buffer: Buffer): string { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function repositoryRoot(): string { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'); }

function verifyExactFile(baseDir: string, identity: FileIdentityV1R2, prefix: string): { path: string; bytes: number; sha256: string } {
  const absolute = path.resolve(baseDir, identity.path);
  if (!fs.existsSync(absolute)) throw new EconomicV1R2PreflightError(`${prefix}_MISSING:${identity.path}`);
  const raw = fs.readFileSync(absolute);
  const sha256 = sha256Buffer(raw);
  if (raw.length !== identity.bytes || sha256 !== identity.sha256) {
    throw new EconomicV1R2PreflightError(`${prefix}_IDENTITY_MISMATCH:${identity.path}:${raw.length}:${sha256}`);
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

function verifyCommissionEvidence(root: string): unknown {
  const verified = verifyExactFile(root, INFINOX_STP_COMMISSION_EVIDENCE_V1_IDENTITY, 'STP_COMMISSION_EVIDENCE');
  const value = JSON.parse(fs.readFileSync(path.resolve(root, INFINOX_STP_COMMISSION_EVIDENCE_V1_IDENTITY.path), 'utf8')) as {
    account_type?: string;
    broker?: string;
    status?: string;
    research_binding?: {
      commission_quote_per_lot_per_side?: number;
      future_lockbox_accessed_at_binding?: boolean;
      pnl_evaluated_at_binding?: boolean;
      scope?: string;
    };
    official_sources?: readonly { url?: string }[];
  };
  if (value.account_type !== 'STP' || value.broker !== 'INFINOX' || value.status !== 'BOUND_PRE_PNL_PRE_LOCKBOX') {
    throw new EconomicV1R2PreflightError('STP_COMMISSION_EVIDENCE_SEMANTIC_MISMATCH');
  }
  if (value.research_binding?.commission_quote_per_lot_per_side !== 0
    || value.research_binding.future_lockbox_accessed_at_binding !== false
    || value.research_binding.pnl_evaluated_at_binding !== false
    || value.research_binding.scope !== 'STP_RESEARCH_EXECUTION_MODEL') {
    throw new EconomicV1R2PreflightError('STP_COMMISSION_BINDING_MISMATCH');
  }
  if (!Array.isArray(value.official_sources) || value.official_sources.length < 2
    || value.official_sources.some((source) => typeof source.url !== 'string' || !source.url.startsWith('https://'))) {
    throw new EconomicV1R2PreflightError('STP_COMMISSION_SOURCE_EVIDENCE_MISSING');
  }
  return { ...verified, accountType: value.account_type, commissionQuotePerLotPerSide: 0, officialSources: value.official_sources.map((source) => source.url) };
}

function parseArgs(args: readonly string[]): { finalSignalArtifacts: string; mt5MetadataCapture: string } {
  let finalSignalArtifacts: string | undefined;
  let mt5MetadataCapture: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--final-signal-artifacts') { finalSignalArtifacts = args[++i]; continue; }
    if (arg === '--mt5-metadata-capture') { mt5MetadataCapture = args[++i]; continue; }
    throw new EconomicV1R2PreflightError(`UNKNOWN_ARGUMENT:${arg}`);
  }
  if (!finalSignalArtifacts) throw new EconomicV1R2PreflightError('FINAL_SIGNAL_ARTIFACT_DIRECTORY_REQUIRED');
  if (!mt5MetadataCapture) throw new EconomicV1R2PreflightError('MT5_METADATA_CAPTURE_REQUIRED');
  return { finalSignalArtifacts, mt5MetadataCapture };
}

export function economicEvaluationPreflightV1R2(root: string, finalSignalArtifacts: string, mt5MetadataCapture: string): unknown {
  const legacyV1R1Evidence = economicEvaluationPreflightV1R1(root, finalSignalArtifacts, mt5MetadataCapture);
  const economicSpec = verifyExactFile(root, ECONOMIC_EVALUATION_V1R2_SPEC_IDENTITY, 'ECONOMIC_V1R2_SPEC');
  const executionSpec = verifyExactFile(root, EXECUTION_ENGINE_V1R2_SPEC_IDENTITY_FOR_ECONOMIC, 'EXECUTION_V1R2_SPEC');
  const executionBinding = verifyExactFile(root, EXECUTION_ENGINE_V1R2_IMPLEMENTATION_IDENTITY_FOR_ECONOMIC, 'EXECUTION_V1R2_IMPLEMENTATION');
  const executionSource = verifyExactFile(root, EXECUTION_ENGINE_V1R2_SOURCE_IDENTITY_FOR_ECONOMIC, 'EXECUTION_V1R2_SOURCE');
  const metadataBinding = verifyExactFile(root, INFINOX_XAUUSD_MT5_METADATA_V1_IDENTITY_FOR_V1R2, 'MT5_METADATA_BINDING_V1R2');
  const commissionEvidence = verifyCommissionEvidence(root);
  const git = gitInfo(root);
  if (!git.commit || git.dirty !== false) throw new EconomicV1R2PreflightError(`SOURCE_SNAPSHOT_NOT_CLEAN:${git.commit ?? 'UNKNOWN'}:${String(git.dirty)}`);

  const legacy = legacyV1R1Evidence as { auditedFinalSignal?: { executionId?: string; modelSha256?: string; calibratorSha256?: string }; mt5Metadata?: unknown };
  if (legacy.auditedFinalSignal?.executionId !== AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R2.executionId
    || legacy.auditedFinalSignal.modelSha256 !== AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R2.modelSha256
    || legacy.auditedFinalSignal.calibratorSha256 !== AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_V1R2.calibratorSha256) {
    throw new EconomicV1R2PreflightError('FINAL_SIGNAL_LINEAGE_V1R2_MISMATCH');
  }

  return {
    status: 'ECONOMIC_EVALUATION_V1R2_PREFLIGHT_PASS',
    git,
    economicEvaluationSpec: economicSpec,
    executionV1R2: { spec: executionSpec, implementationBinding: executionBinding, source: executionSource },
    mt5Metadata: { binding: metadataBinding, legacyVerifiedRawCapture: legacy.mt5Metadata },
    commissionEvidence,
    auditedFinalSignal: legacy.auditedFinalSignal,
    lockboxContract: {
      informationStart: ECONOMIC_EVALUATION_V1R2_LOCKBOX.informationStart,
      firstPotentialDecisionTime: ECONOMIC_EVALUATION_V1R2_LOCKBOX.firstPotentialDecisionTime,
      informationEnd: ECONOMIC_EVALUATION_V1R2_LOCKBOX.informationEnd,
      calendarDays: ECONOMIC_EVALUATION_V1R2_LOCKBOX.calendarDays,
      partialEvaluationAllowed: false,
      fullRunAllowedBeforeInformationEnd: false,
      fullRunAllowedNow: Date.now() >= ECONOMIC_EVALUATION_V1R2_LOCKBOX.informationEnd,
    },
    primaryAccount: ECONOMIC_EVALUATION_V1R2_PRIMARY_ACCOUNT,
    primaryGates: ECONOMIC_EVALUATION_V1R2_PRIMARY_GATES,
    scenarios: ECONOMIC_EVALUATION_V1R2_SCENARIOS,
    executionPolicy: {
      exactRiskStopPreserved: true,
      brokerIncompatibleRiskStop: 'NO_FILL_BROKER_STOP_CONSTRAINT',
      observedM5ContiguityRequired: true,
      requiredOffsetsMs: [0, 300000, 600000, 900000],
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
    console.log(JSON.stringify(economicEvaluationPreflightV1R2(repositoryRoot(), options.finalSignalArtifacts, options.mt5MetadataCapture), null, 2));
  } catch (error) {
    console.error('ECONOMIC_EVALUATION_V1R2_PREFLIGHT_INVALID');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedAsScript = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invokedAsScript) main();
