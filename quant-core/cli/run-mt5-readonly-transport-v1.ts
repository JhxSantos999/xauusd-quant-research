import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMt5ReadOnlySignalTransportV1,
  serializeMt5ReadOnlySignalTransportV1,
  validateAndSelectLatestDevObservabilityLineV1,
  writeMt5ReadOnlySignalFileV1,
} from '../../adapters/mt5/readonly-signal-transport-v1.js';

class Mt5ReadOnlySignalTransportCliError extends Error {
  override readonly name = 'Mt5ReadOnlySignalTransportCliError';
}

function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function parseArgs(args: readonly string[]): { journal: string; output: string } {
  let journal: string | undefined;
  let output: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--journal') { journal = args[++i]; continue; }
    if (arg === '--output') { output = args[++i]; continue; }
    throw new Mt5ReadOnlySignalTransportCliError(`UNKNOWN_ARGUMENT:${arg}`);
  }
  if (!journal) throw new Mt5ReadOnlySignalTransportCliError('JOURNAL_PATH_REQUIRED');
  if (!output) throw new Mt5ReadOnlySignalTransportCliError('OUTPUT_PATH_REQUIRED');
  return { journal, output };
}

export function runMt5ReadOnlySignalTransportCliV1(
  journalPath: string,
  outputPath: string,
): unknown {
  const journal = path.resolve(journalPath);
  if (!fs.existsSync(journal) || !fs.statSync(journal).isFile()) {
    throw new Mt5ReadOnlySignalTransportCliError(`JOURNAL_NOT_FOUND:${journal}`);
  }

  const journalRaw = fs.readFileSync(journal);
  const journalText = journalRaw.toString('utf8');
  const selected = validateAndSelectLatestDevObservabilityLineV1(journalText);
  const message = buildMt5ReadOnlySignalTransportV1(selected.latest);
  const serialized = serializeMt5ReadOnlySignalTransportV1(message);
  writeMt5ReadOnlySignalFileV1(outputPath, serialized);

  const output = path.resolve(outputPath);
  const outputRaw = fs.readFileSync(output);
  return Object.freeze({
    status: 'MT5_READONLY_SIGNAL_TRANSPORT_V1_PASS',
    mode: 'DEV_TO_MT5_READONLY_ONLY',
    sourceJournalRecords: selected.lines.length,
    sourceJournalSha256: sha256Buffer(journalRaw),
    decisionTime: message.decisionTime,
    decision: message.decision,
    eventId: message.eventId,
    paperMonitorRecordSha256: message.paperMonitorRecordSha256,
    output,
    outputBytes: outputRaw.length,
    outputSha256: sha256Buffer(outputRaw),
    receiverPolicy: 'DISPLAY_AND_LOG_ONLY',
    future_lockbox_accessed: false,
    pnl_evaluated: false,
    paper_fill_simulated: false,
    execution_engine_invoked: false,
    order_submission_enabled: false,
    live_execution: false,
  });
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2));
    console.log(JSON.stringify(
      runMt5ReadOnlySignalTransportCliV1(options.journal, options.output),
      null,
      2,
    ));
  } catch (error) {
    console.error('MT5_READONLY_SIGNAL_TRANSPORT_V1_INVALID');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) main();
