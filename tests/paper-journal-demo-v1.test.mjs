import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createFilePaperJournalV1,
  FILE_PAPER_JOURNAL_V1_VERSION,
  resolveFilePaperJournalPathV1,
} from '../dist/adapters/paper/file-paper-journal-v1.js';
import {
  PAPER_JOURNAL_DEMO_V1_MODE,
  PAPER_JOURNAL_DEMO_V1_VERSION,
  runPaperJournalDemoV1,
} from '../dist/adapters/paper/paper-journal-demo-v1.js';

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'paper-journal-demo-v1-'));
}

async function sha256File(filePath) {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

test('Paper Journal Demo V1 spec, implementation binding and source identities are frozen', async () => {
  const implementation = JSON.parse(await fs.readFile('adapters/paper/paper_journal_demo_v1.implementation.json', 'utf8'));
  assert.equal(implementation.status, 'FROZEN_OBSERVABILITY_DEMO_ONLY');
  assert.equal(implementation.base_frozen_paper_monitor_commit, '3ae467e75fa4f847b565b6f4bb57bf52bcc4c50f');
  for (const [filePath, identity] of Object.entries(implementation.files)) {
    const bytes = await fs.readFile(filePath);
    assert.equal(bytes.length, identity.bytes, `byte length mismatch: ${filePath}`);
    assert.equal(await sha256File(filePath), identity.sha256, `sha256 mismatch: ${filePath}`);
  }
  assert.equal(implementation.upstream_frozen.signal_bridge_v1_source_sha256, '5a9be8586679831610fd18e045d5efdf8f947ff12e2b95d3f66c77b95f961626');
  assert.equal(implementation.upstream_frozen.paper_monitor_adapter_v1_source_sha256, '2f00ab549b1087db390bd1a08519e9230e002b6bd04fe623ee8aff537483b935');
  assert.equal(implementation.scope.future_lockbox_accessed, false);
  assert.equal(implementation.scope.pnl_evaluated, false);
  assert.equal(implementation.scope.live_execution, false);
});

test('File Paper Journal V1 appends valid one-line JSON records exactly and rejects invalid input', async () => {
  const dir = await tempDir();
  const output = path.join(dir, 'paper.jsonl');
  assert.equal(FILE_PAPER_JOURNAL_V1_VERSION, 'file_paper_journal_v1');
  assert.equal(resolveFilePaperJournalPathV1(output), path.resolve(output));
  assert.throws(() => createFilePaperJournalV1({ outputFilePath: path.join(dir, 'paper.txt') }), /OUTPUT_MUST_BE_JSONL/);

  const journal = createFilePaperJournalV1({ outputFilePath: output });
  await journal.appendLine('{"a":1}');
  await journal.appendLine('{"b":2}');
  assert.equal(await fs.readFile(output, 'utf8'), '{"a":1}\n{"b":2}\n');
  await assert.rejects(() => journal.appendLine('not-json'), /INVALID_JSON/);
  await assert.rejects(() => journal.appendLine('{"a":1}\n{"b":2}'), /MULTILINE_RECORD/);
});

test('Paper Journal Demo V1 deterministically journals LONG, SHORT, NO_TRADE synthetic observations only', async () => {
  const dir = await tempDir();
  const outputA = path.join(dir, 'demo-a.jsonl');
  const outputB = path.join(dir, 'demo-b.jsonl');
  const a = await runPaperJournalDemoV1(outputA);
  const b = await runPaperJournalDemoV1(outputB);

  assert.equal(a.version, PAPER_JOURNAL_DEMO_V1_VERSION);
  assert.equal(a.mode, PAPER_JOURNAL_DEMO_V1_MODE);
  assert.equal(a.recordCount, 3);
  assert.deepEqual(a.decisions, ['LONG', 'SHORT', 'NO_TRADE']);
  assert.equal(a.futureLockboxAccessed, false);
  assert.equal(a.pnlEvaluated, false);
  assert.equal(a.liveExecution, false);
  assert.equal(a.sha256, b.sha256);

  const bytesA = await fs.readFile(outputA);
  const bytesB = await fs.readFile(outputB);
  assert.deepEqual(bytesA, bytesB);
  const records = bytesA.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(records.map(record => record.decision), ['LONG', 'SHORT', 'NO_TRADE']);
  assert.equal(records.every(record => record.mode === 'PAPER_MONITOR_ONLY'), true);
  assert.equal(records.every(record => !Object.hasOwn(record, 'pnl') && !Object.hasOwn(record, 'fillPrice')), true);

  await assert.rejects(() => runPaperJournalDemoV1(outputA), /OUTPUT_EXISTS/);
});

test('Paper Journal Demo V1 spec is synthetic observability only and excludes trading, PnL and Future Lockbox', async () => {
  const spec = JSON.parse(await fs.readFile('adapters/paper/paper_journal_demo_v1.spec.json', 'utf8'));
  assert.equal(spec.status, 'FROZEN_OBSERVABILITY_DEMO_ONLY');
  assert.equal(spec.mode, 'SYNTHETIC_DEMO_ONLY');
  assert.equal(spec.demo_fixture.synthetic_only, true);
  assert.deepEqual(spec.demo_fixture.decision_sequence, ['LONG', 'SHORT', 'NO_TRADE']);
  assert.equal(spec.demo_fixture.output_file_must_not_preexist, true);
  assert.equal(spec.demo_fixture.rerun_same_output_fails_closed, true);
  assert.equal(spec.explicit_exclusions.future_lockbox_access, false);
  assert.equal(spec.explicit_exclusions.pnl, false);
  assert.equal(spec.explicit_exclusions.paper_fill_simulation, false);
  assert.equal(spec.explicit_exclusions.execution_engine, false);
  assert.equal(spec.explicit_exclusions.order_submission, false);
  assert.equal(spec.explicit_exclusions.network_transport, false);
  assert.equal(spec.explicit_exclusions.browser_automation, false);
  assert.equal(spec.explicit_exclusions.real_market_signal_input, false);
});

test('Paper Journal Demo V1 adds only local filesystem persistence and has no execution, economic, broker, network or browser coupling', async () => {
  const sources = [
    await fs.readFile('adapters/paper/file-paper-journal-v1.ts', 'utf8'),
    await fs.readFile('adapters/paper/paper-journal-demo-v1.ts', 'utf8'),
    await fs.readFile('quant-core/cli/run-paper-journal-demo-v1.ts', 'utf8'),
  ].join('\n');
  for (const forbidden of [
    '../../quant-core/execution/', '../../quant-core/economic/', '../../quant-core/lockbox/',
    'OrderSend', 'submitOrder', 'sendOrder', 'WebSocket', 'fetch(', 'node:http', 'node:https', 'node:net',
    'browser.', 'page.click', 'profitFactor', 'realizedPnl',
  ]) {
    assert.equal(sources.includes(forbidden), false, `forbidden coupling: ${forbidden}`);
  }
});
