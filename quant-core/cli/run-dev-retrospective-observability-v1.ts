import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFilePaperJournalV1 } from '../../adapters/paper/file-paper-journal-v1.js';
import { journalPaperMonitorMessageV1 } from '../../adapters/paper/paper-monitor-adapter-v1.js';
import { serializeSignalBridgeEnvelopeV1 } from '../bridge/signal-bridge-v1.js';
import type { PlattCalibratorV1 } from '../calibration/platt.js';
import { auditCandles, enforceDatasetContract, M5_TIMEFRAME_MS } from '../data/contracts.js';
import { parseMt5TabCsv } from '../data/mt5-parser.js';
import type { TrainedLogisticV1 } from '../models/logistic.js';
import {
  DEV_DATASET_CANDLES_V1,
  DEV_DATASET_ID_V1,
  DEV_DATASET_SHA256_V1,
  DEV_FIRST_BAR_OPEN_TIME_V1,
  DEV_INFORMATION_END_V1,
  DEV_MAX_BAR_OPEN_TIME_V1,
} from '../research/frozen-contracts.js';
import {
  buildDevRetrospectiveObservabilityV1,
  DEV_RETROSPECTIVE_OBSERVABILITY_V1_RECORD_COUNT,
} from '../replay/dev-retrospective-observability-v1.js';
import { frozenReplayLineageV1 } from '../replay/dev-signal-replay-v1.js';

const DEV_DATASET_BYTES = 6_285_976;
const FINAL_SIGNAL_FILES = Object.freeze({
  manifest: Object.freeze({
    path: 'final_signal_artifact_manifest.json',
    bytes: 3443,
    sha256: 'b6b169ae88d9feaf4060528f4c5e2b17d6ef79da500a6bd7096835fae4a680e0',
  }),
  model: Object.freeze({
    path: 'final_signal_model.json',
    bytes: 1073,
    sha256: 'f4869afd3cfeb681bca356ee08d80a63fb617a841427932a571ff2e2306f7655',
  }),
  calibrator: Object.freeze({
    path: 'final_signal_calibrator.json',
    bytes: 684,
    sha256: '6d851a2eaa61deaa00bc2bc7899ad40fabc5b8758cd58ed933782709996ac17c',
  }),
  provenance: Object.freeze({
    path: 'execution_provenance.json',
    bytes: 3553,
    sha256: '1d6b8a538aa821afb7ae8fc1e8213f83d1aba949f35ecf14a3ab601a27dfe370',
  }),
  lineage: Object.freeze({
    path: 'experiment_lineage.json',
    bytes: 1285,
    sha256: '952d5ff0e7d3915398bf4ca4f914978bd0c556e745df9e9379fa0a476087d5b1',
  }),
});

class DevRetrospectiveObservabilityCliError extends Error {
  override readonly name = 'DevRetrospectiveObservabilityCliError';
}

function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function verifyExactFile(filePath: string, bytes: number, sha256: string, prefix: string): Buffer {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new DevRetrospectiveObservabilityCliError(`${prefix}_NOT_FOUND:${absolute}`);
  }
  const raw = fs.readFileSync(absolute);
  const actualSha256 = sha256Buffer(raw);
  if (raw.length !== bytes || actualSha256 !== sha256) {
    throw new DevRetrospectiveObservabilityCliError(`${prefix}_IDENTITY_MISMATCH:${raw.length}:${actualSha256}`);
  }
  return raw;
}

function verifyFinalSignalArtifacts(finalSignalDir: string): {
  model: TrainedLogisticV1;
  calibrator: PlattCalibratorV1;
} {
  const dir = path.resolve(finalSignalDir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new DevRetrospectiveObservabilityCliError(`FINAL_SIGNAL_ARTIFACT_DIRECTORY_NOT_FOUND:${dir}`);
  }
  for (const identity of Object.values(FINAL_SIGNAL_FILES)) {
    verifyExactFile(path.join(dir, identity.path), identity.bytes, identity.sha256, 'FINAL_SIGNAL_FILE');
  }
  const modelWrapper = JSON.parse(fs.readFileSync(path.join(dir, FINAL_SIGNAL_FILES.model.path), 'utf8')) as {
    artifact_role?: string;
    schema_version?: string;
    model?: TrainedLogisticV1;
  };
  const calibratorWrapper = JSON.parse(fs.readFileSync(path.join(dir, FINAL_SIGNAL_FILES.calibrator.path), 'utf8')) as {
    artifact_role?: string;
    schema_version?: string;
    calibrator?: PlattCalibratorV1;
  };
  if (modelWrapper.artifact_role !== 'final_signal_model'
    || modelWrapper.schema_version !== 'final_signal_model_v1r1'
    || !modelWrapper.model) {
    throw new DevRetrospectiveObservabilityCliError('FINAL_SIGNAL_MODEL_WRAPPER_MISMATCH');
  }
  if (calibratorWrapper.artifact_role !== 'final_signal_calibrator'
    || calibratorWrapper.schema_version !== 'final_signal_calibrator_v1r1'
    || !calibratorWrapper.calibrator) {
    throw new DevRetrospectiveObservabilityCliError('FINAL_SIGNAL_CALIBRATOR_WRAPPER_MISMATCH');
  }
  return { model: modelWrapper.model, calibrator: calibratorWrapper.calibrator };
}

function parseArgs(args: readonly string[]): {
  dataset: string;
  finalSignalArtifacts: string;
  output: string;
} {
  let dataset: string | undefined;
  let finalSignalArtifacts: string | undefined;
  let output: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--dataset') { dataset = args[++i]; continue; }
    if (arg === '--final-signal-artifacts') { finalSignalArtifacts = args[++i]; continue; }
    if (arg === '--output') { output = args[++i]; continue; }
    throw new DevRetrospectiveObservabilityCliError(`UNKNOWN_ARGUMENT:${arg}`);
  }
  if (!dataset) throw new DevRetrospectiveObservabilityCliError('DATASET_PATH_REQUIRED');
  if (!finalSignalArtifacts) throw new DevRetrospectiveObservabilityCliError('FINAL_SIGNAL_ARTIFACT_DIRECTORY_REQUIRED');
  if (!output) throw new DevRetrospectiveObservabilityCliError('OUTPUT_PATH_REQUIRED');
  return { dataset, finalSignalArtifacts, output };
}

export async function runDevRetrospectiveObservabilityCliV1(
  datasetPath: string,
  finalSignalArtifacts: string,
  outputPath: string,
): Promise<unknown> {
  const output = path.resolve(outputPath);
  if (path.extname(output).toLowerCase() !== '.jsonl') {
    throw new DevRetrospectiveObservabilityCliError('OUTPUT_MUST_BE_JSONL');
  }
  if (fs.existsSync(output)) throw new DevRetrospectiveObservabilityCliError(`OUTPUT_EXISTS:${output}`);

  const datasetRaw = verifyExactFile(datasetPath, DEV_DATASET_BYTES, DEV_DATASET_SHA256_V1, 'DEV_DATASET');
  const candles = parseMt5TabCsv(datasetRaw.toString('utf8'));
  const audit = auditCandles(candles);
  if (audit.candles !== DEV_DATASET_CANDLES_V1
    || audit.firstBarOpenTime !== DEV_FIRST_BAR_OPEN_TIME_V1
    || audit.lastBarOpenTime !== DEV_MAX_BAR_OPEN_TIME_V1
    || audit.duplicateTimestamps !== 0
    || audit.nonIncreasingTimestamps !== 0
    || audit.invalidGeometry !== 0
    || audit.nonFiniteValues !== 0) {
    throw new DevRetrospectiveObservabilityCliError('DEV_DATASET_AUDIT_MISMATCH');
  }
  enforceDatasetContract(candles, {
    datasetId: DEV_DATASET_ID_V1,
    datasetSha256: DEV_DATASET_SHA256_V1,
    timeframeMs: M5_TIMEFRAME_MS,
    maxCandleOpenTime: DEV_MAX_BAR_OPEN_TIME_V1,
    maxInformationTime: DEV_INFORMATION_END_V1,
  });

  const artifacts = verifyFinalSignalArtifacts(finalSignalArtifacts);
  const scan = buildDevRetrospectiveObservabilityV1(candles, artifacts.model, artifacts.calibrator);
  const lineage = frozenReplayLineageV1();

  fs.mkdirSync(path.dirname(output), { recursive: true });
  const journal = createFilePaperJournalV1({ outputFilePath: output });
  let long = 0;
  let short = 0;
  let noTrade = 0;
  for (const observation of scan.observations) {
    const serialized = serializeSignalBridgeEnvelopeV1(observation.envelope);
    await journalPaperMonitorMessageV1(
      serialized,
      lineage,
      observation.signal.decisionTime,
      journal,
    );
    if (observation.riskDecision.action === 'NO_TRADE') noTrade++;
    else if (observation.riskDecision.side === 'LONG') long++;
    else short++;
  }

  const journalRaw = fs.readFileSync(output);
  const lines = journalRaw.toString('utf8').trimEnd().split('\n');
  if (lines.length !== DEV_RETROSPECTIVE_OBSERVABILITY_V1_RECORD_COUNT) {
    throw new DevRetrospectiveObservabilityCliError(`JOURNAL_RECORD_COUNT_MISMATCH:${lines.length}`);
  }

  return Object.freeze({
    status: 'DEV_RETROSPECTIVE_OBSERVABILITY_V1_PASS',
    mode: scan.mode,
    datasetScope: 'CANONICAL_DEV_ONLY',
    datasetSha256: DEV_DATASET_SHA256_V1,
    finalSignalExecutionId: lineage.finalSignalExecutionId,
    recordCount: scan.recordCount,
    firstDecisionTime: scan.firstDecisionTime,
    lastDecisionTime: scan.lastDecisionTime,
    decisions: { LONG: long, SHORT: short, NO_TRADE: noTrade },
    causalHistoricalPrediction: false,
    predictiveValidityClaimed: false,
    riskStateMode: scan.riskStateMode,
    outcomesRead: false,
    journaled: true,
    output,
    outputBytes: journalRaw.length,
    outputSha256: sha256Buffer(journalRaw),
    future_lockbox_accessed: false,
    pnl_evaluated: false,
    paper_fill_simulated: false,
    execution_engine_invoked: false,
    live_execution: false,
  });
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await runDevRetrospectiveObservabilityCliV1(
      options.dataset,
      options.finalSignalArtifacts,
      options.output,
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('DEV_RETROSPECTIVE_OBSERVABILITY_V1_INVALID');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) void main();
