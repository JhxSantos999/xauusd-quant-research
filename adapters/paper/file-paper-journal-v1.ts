import fs from 'node:fs/promises';
import path from 'node:path';
import type { PaperMonitorJournalV1 } from './paper-monitor-adapter-v1.js';

export const FILE_PAPER_JOURNAL_V1_VERSION = 'file_paper_journal_v1' as const;

export interface FilePaperJournalConfigV1 {
  readonly outputFilePath: string;
}

function resolveOutputPathV1(outputFilePath: string): string {
  if (typeof outputFilePath !== 'string' || outputFilePath.trim().length === 0) {
    throw new Error('FILE_PAPER_JOURNAL_V1_EMPTY_OUTPUT_PATH');
  }
  const resolved = path.resolve(outputFilePath);
  if (path.extname(resolved).toLowerCase() !== '.jsonl') {
    throw new Error('FILE_PAPER_JOURNAL_V1_OUTPUT_MUST_BE_JSONL');
  }
  return resolved;
}

function validateCanonicalLineV1(line: string): void {
  if (typeof line !== 'string' || line.length === 0) throw new Error('FILE_PAPER_JOURNAL_V1_EMPTY_LINE');
  if (line.includes('\n') || line.includes('\r')) throw new Error('FILE_PAPER_JOURNAL_V1_MULTILINE_RECORD');
  try {
    JSON.parse(line);
  } catch {
    throw new Error('FILE_PAPER_JOURNAL_V1_INVALID_JSON');
  }
}

export function resolveFilePaperJournalPathV1(outputFilePath: string): string {
  return resolveOutputPathV1(outputFilePath);
}

export function createFilePaperJournalV1(config: FilePaperJournalConfigV1): PaperMonitorJournalV1 {
  if (!config || typeof config !== 'object') throw new Error('FILE_PAPER_JOURNAL_V1_INVALID_CONFIG');
  const outputFilePath = resolveOutputPathV1(config.outputFilePath);
  return Object.freeze({
    async appendLine(line: string): Promise<void> {
      validateCanonicalLineV1(line);
      await fs.appendFile(outputFilePath, `${line}\n`, { encoding: 'utf8', flag: 'a' });
    },
  });
}
