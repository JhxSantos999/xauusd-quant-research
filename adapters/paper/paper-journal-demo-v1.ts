import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildSignalBridgeEnvelopeV1,
  publishSignalBridgeEnvelopeV1,
  type SignalObjectV1,
} from '../../quant-core/bridge/signal-bridge-v1.js';
import {
  evaluateRiskV1,
  type RiskEngineLineageV1,
} from '../../quant-core/risk/risk-engine.js';
import { createPaperMonitorSinkV1 } from './paper-monitor-adapter-v1.js';
import { createFilePaperJournalV1, resolveFilePaperJournalPathV1 } from './file-paper-journal-v1.js';

export const PAPER_JOURNAL_DEMO_V1_VERSION = 'paper_journal_demo_v1' as const;
export const PAPER_JOURNAL_DEMO_V1_MODE = 'SYNTHETIC_DEMO_ONLY' as const;

export const PAPER_JOURNAL_DEMO_V1_LINEAGE: RiskEngineLineageV1 = Object.freeze({
  finalSignalExecutionId: 'final_signal_v1r1_20260913235306128',
  finalSignalModelSha256: 'f4869afd3cfeb681bca356ee08d80a63fb617a841427932a571ff2e2306f7655',
  finalSignalCalibratorSha256: '6d851a2eaa61deaa00bc2bc7899ad40fabc5b8758cd58ed933782709996ac17c',
});

const DEMO_SIGNALS_V1: readonly SignalObjectV1[] = Object.freeze([
  Object.freeze({
    asset: 'XAUUSD', timeframe: 'M5', decisionTime: 1_800_000_000_000,
    decisionClose: 3000, atrSma12OverClose: 0.001,
    rawProbability: 0.57, calibratedProbability: 0.60,
  }),
  Object.freeze({
    asset: 'XAUUSD', timeframe: 'M5', decisionTime: 1_800_000_300_000,
    decisionClose: 3001, atrSma12OverClose: 0.0011,
    rawProbability: 0.43, calibratedProbability: 0.40,
  }),
  Object.freeze({
    asset: 'XAUUSD', timeframe: 'M5', decisionTime: 1_800_000_600_000,
    decisionClose: 3002, atrSma12OverClose: 0.0009,
    rawProbability: 0.50, calibratedProbability: 0.50,
  }),
]);

const RECEIPT_OFFSETS_MS_V1 = Object.freeze([125, 250, 375] as const);

export interface PaperJournalDemoResultV1 {
  readonly version: typeof PAPER_JOURNAL_DEMO_V1_VERSION;
  readonly mode: typeof PAPER_JOURNAL_DEMO_V1_MODE;
  readonly outputFilePath: string;
  readonly recordCount: 3;
  readonly decisions: readonly ['LONG', 'SHORT', 'NO_TRADE'];
  readonly sha256: string;
  readonly futureLockboxAccessed: false;
  readonly pnlEvaluated: false;
  readonly liveExecution: false;
}

async function reserveFreshOutputV1(outputFilePath: string): Promise<void> {
  await fs.mkdir(path.dirname(outputFilePath), { recursive: true });
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(outputFilePath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('PAPER_JOURNAL_DEMO_V1_OUTPUT_EXISTS');
    throw error;
  } finally {
    if (handle) await handle.close();
  }
}

function hashBytesV1(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export async function runPaperJournalDemoV1(outputFilePathInput: string): Promise<PaperJournalDemoResultV1> {
  const outputFilePath = resolveFilePaperJournalPathV1(outputFilePathInput);
  await reserveFreshOutputV1(outputFilePath);
  const journal = createFilePaperJournalV1({ outputFilePath });

  let receiptIndex = 0;
  const clock = Object.freeze({
    nowMs(): number {
      const signal = DEMO_SIGNALS_V1[receiptIndex];
      const offset = RECEIPT_OFFSETS_MS_V1[receiptIndex];
      if (!signal || offset === undefined) throw new Error('PAPER_JOURNAL_DEMO_V1_CLOCK_EXHAUSTED');
      receiptIndex += 1;
      return signal.decisionTime + offset;
    },
  });
  const sink = createPaperMonitorSinkV1(PAPER_JOURNAL_DEMO_V1_LINEAGE, clock, journal);

  for (const signal of DEMO_SIGNALS_V1) {
    const riskDecision = evaluateRiskV1({
      ...signal,
      accountEquityQuote: 10_000,
      positionState: 'FLAT',
      ...PAPER_JOURNAL_DEMO_V1_LINEAGE,
    }, PAPER_JOURNAL_DEMO_V1_LINEAGE);
    const envelope = buildSignalBridgeEnvelopeV1({
      signal,
      lineage: PAPER_JOURNAL_DEMO_V1_LINEAGE,
      riskDecision,
    }, PAPER_JOURNAL_DEMO_V1_LINEAGE);
    await publishSignalBridgeEnvelopeV1(envelope, [sink]);
  }

  const bytes = await fs.readFile(outputFilePath);
  const text = bytes.toString('utf8');
  const lines = text.trimEnd().split('\n');
  if (lines.length !== 3) throw new Error('PAPER_JOURNAL_DEMO_V1_RECORD_COUNT_MISMATCH');
  const decisions = lines.map(line => (JSON.parse(line) as { decision?: unknown }).decision);
  if (decisions[0] !== 'LONG' || decisions[1] !== 'SHORT' || decisions[2] !== 'NO_TRADE') {
    throw new Error('PAPER_JOURNAL_DEMO_V1_DECISION_SEQUENCE_MISMATCH');
  }

  return Object.freeze({
    version: PAPER_JOURNAL_DEMO_V1_VERSION,
    mode: PAPER_JOURNAL_DEMO_V1_MODE,
    outputFilePath,
    recordCount: 3,
    decisions: Object.freeze(['LONG', 'SHORT', 'NO_TRADE'] as const),
    sha256: hashBytesV1(bytes),
    futureLockboxAccessed: false,
    pnlEvaluated: false,
    liveExecution: false,
  });
}
