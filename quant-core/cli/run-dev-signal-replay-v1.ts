import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFilePaperJournalV1 } from '../../adapters/paper/file-paper-journal-v1.js';
import { journalPaperMonitorMessageV1 } from '../../adapters/paper/paper-monitor-adapter-v1.js';
import { serializeSignalBridgeEnvelopeV1 } from '../bridge/signal-bridge-v1.js';
import { parseMt5TabCsv } from '../data/mt5-parser.js';
import type { PlattCalibratorV1 } from '../calibration/platt.js';
import type { TrainedLogisticV1 } from '../models/logistic.js';
import {
  buildDevSignalReplayV1,
  frozenReplayLineageV1,
} from '../replay/dev-signal-replay-v1.js';

const DEV_DATASET_BYTES = 6_285_976;
const DEV_DATASET_SHA256 = 'a34f2d5469782fccd1e8479ceea5c81b633aa5301b7ed47447049323850de8f5';
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

class DevSignalReplayCliError extends Error {
  override readonly name = 'DevSignalReplayCliError';
}

function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function verifyExactFile(filePath: string, bytes: number, sha256: string, prefix: string): Buffer {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new DevSignalReplayCliError(`${prefix}_NOT_FOUND:${absolute}`);
  }
  const raw = fs.readFileSync(absolute);
  const actualSha256 = sha256Buffer(raw);
  if (raw.length !== bytes || actualSha256 !== sha256) {
    throw new DevSignalReplayCliError(`${prefix}_IDENTITY_MISMATCH:${raw.length}:${actualSha256}`);
  }
  return raw;
}

function verifyFinalSignalArtifacts(finalSignalDir: string): {
  model: TrainedLogisticV1;
  calibrator: PlattCalibratorV1;
} {
  const dir = path.resolve(finalSignalDir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new DevSignalReplayCliError(`FINAL_SIGNAL_ARTIFACT_DIRECTORY_NOT_FOUND:${dir}`);
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
    throw new DevSignalReplayCliError('FINAL_SIGNAL_MODEL_WRAPPER_MISMATCH');
  }
  if (calibratorWrapper.artifact_role !== 'final_signal_calibrator'
    || calibratorWrapper.schema_version !== 'final_signal_calibrator_v1r1'
    || !calibratorWrapper.calibrator) {
    throw new DevSignalReplayCliError('FINAL_SIGNAL_CALIBRATOR_WRAPPER_MISMATCH');
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
    throw new DevSignalReplayCliError(`UNKNOWN_ARGUMENT:${arg}`);
  }
  if (!dataset) throw new DevSignalReplayCliError('DATASET_PATH_REQUIRED');
  if (!finalSignalArtifacts) throw new DevSignalReplayCliError('FINAL_SIGNAL_ARTIFACT_DIRECTORY_REQUIRED');
  if (!output) throw new DevSignalReplayCliError('OUTPUT_PATH_REQUIRED');
  return { dataset, finalSignalArtifacts, output };
}

export async function runDevSignalReplayCliV1(
  datasetPath: string,
  finalSignalArtifacts: string,
  outputPath: string,
): Promise<unknown> {
  const output = path.resolve(outputPath);
  if (path.extname(output).toLowerCase() !== '.jsonl') {
    throw new DevSignalReplayCliError('OUTPUT_MUST_BE_JSONL');
  }
  if (fs.existsSync(output)) throw new DevSignalReplayCliError(`OUTPUT_EXISTS:${output}`);

  const datasetRaw = verifyExactFile(datasetPath, DEV_DATASET_BYTES, DEV_DATASET_SHA256, 'DEV_DATASET');
  const candles = parseMt5TabCsv(datasetRaw.toString('utf8'));
  const artifacts = verifyFinalSignalArtifacts(finalSignalArtifacts);
  const replay = buildDevSignalReplayV1(candles, artifacts.model, artifacts.calibrator);

  fs.mkdirSync(path.dirname(output), { recursive: true });
  const journal = createFilePaperJournalV1({ outputFilePath: output });
  const lineage = frozenReplayLineageV1();
  const serializedBridgeMessage = serializeSignalBridgeEnvelopeV1(replay.envelope);
  const receipt = await journalPaperMonitorMessageV1(
    serializedBridgeMessage,
    lineage,
    replay.decisionTime,
    journal,
  );

  const journalRaw = fs.readFileSync(output);
  const decision = replay.riskDecision.action === 'TRADE_INTENT' ? replay.riskDecision.side : 'NO_TRADE';
  return Object.freeze({
    status: 'DEV_SIGNAL_REPLAY_V1_PASS',
    mode: replay.mode,
    datasetScope: 'CANONICAL_DEV_ONLY',
    datasetSha256: DEV_DATASET_SHA256,
    finalSignalExecutionId: lineage.finalSignalExecutionId,
    decisionTime: replay.decisionTime,
    rawProbability: replay.signal.rawProbability,
    calibratedProbability: replay.signal.calibratedProbability,
    decision,
    eventId: replay.envelope.eventId,
    journaled: receipt.journaled,
    output,
    outputBytes: journalRaw.length,
    outputSha256: sha256Buffer(journalRaw),
    future_lockbox_accessed: false,
    pnl_evaluated: false,
    paper_fill_simulated: false,
    live_execution: false,
  });
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await runDevSignalReplayCliV1(
      options.dataset,
      options.finalSignalArtifacts,
      options.output,
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('DEV_SIGNAL_REPLAY_V1_INVALID');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) void main();
