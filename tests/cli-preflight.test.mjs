import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeProductionV1, parseArgsV1 } from '../dist/quant-core/cli/run-nested-v1.js';

function captureConsole(fn) {
  const errors = [];
  const logs = [];
  const oldError = console.error;
  const oldLog = console.log;
  console.error = (...args) => errors.push(args.join(' '));
  console.log = (...args) => logs.push(args.join(' '));
  try { return { value: fn(), errors, logs }; }
  finally { console.error = oldError; console.log = oldLog; }
}

test('production CLI has no test-geometry bypass and preflight-only does not require output root', () => {
  assert.deepEqual(parseArgsV1(['--dataset', '/tmp/dev.csv', '--preflight-only']), { dataset: '/tmp/dev.csv', preflightOnly: true });
  assert.throws(() => parseArgsV1(['--dataset', '/tmp/dev.csv', '--test-geometry']), /UNKNOWN_ARGUMENT:--test-geometry/);
});

test('full production execution requires explicit output root', () => {
  assert.throws(() => parseArgsV1(['--dataset', '/tmp/dev.csv']), /OUTPUT_ROOT_REQUIRED/);
});

test('missing dataset is operational EXECUTION_INVALID_V1, not preregistration mismatch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-cli-root-'));
  const missing = path.join(root, 'missing.csv');
  const captured = captureConsole(() => executeProductionV1(root, { dataset: missing, preflightOnly: true }));
  assert.equal(captured.value.kind, 'EXECUTION');
  assert.equal(captured.value.status, 'EXECUTION_INVALID_V1');
  assert(captured.errors.some((line) => line.includes('DATASET_NOT_FOUND')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('wrong dataset identity aborts preregistration before any artifact directory is created', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-cli-root-'));
  const dataset = path.join(root, 'wrong.csv');
  const output = path.join(root, 'artifacts');
  fs.writeFileSync(dataset, '<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\n2026.01.01\t00:00:00\t1\t1\t1\t1\n');
  const captured = captureConsole(() => executeProductionV1(root, { dataset, outputRoot: output, preflightOnly: false }));
  assert.equal(captured.value.kind, 'EXECUTION');
  assert.equal(captured.value.status, 'ABORTED_PREREGISTRATION_MISMATCH');
  assert(captured.errors.some((line) => line.includes('DATASET_IDENTITY_MISMATCH')));
  assert.equal(fs.existsSync(output), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('production source contains no synthetic bypass flags or dummy fitting vectors', () => {
  const source = fs.readFileSync('quant-core/cli/run-nested-v1.ts', 'utf8');
  assert.equal(source.includes('--test-geometry'), false);
  assert.equal(source.includes('dummyX'), false);
  assert.equal(source.includes('dummyY'), false);
  assert.equal(source.includes('DRY-RUN READY'), false);
  assert.equal(source.includes('VALIDATED_V1 (DRY-RUN READY)'), false);
});
