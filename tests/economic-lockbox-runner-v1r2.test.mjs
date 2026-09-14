import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  simulateScenarioV1R2,
} from '../dist/quant-core/economic/economic-lockbox-evaluator-v1r2.js';
import {
  assertLockboxMatureV1R2,
  parseEconomicLockboxArgsV1R2,
} from '../dist/quant-core/cli/run-economic-lockbox-v1r2.js';
import {
  assertNoPriorLockboxEvaluationV1R2,
  reserveLockboxEvaluationV1R2,
  transitionLockboxRegistryV1R2,
} from '../dist/quant-core/lockbox/one-shot-registry-v1r2.js';

const lineage = {
  finalSignalExecutionId: 'signal',
  finalSignalModelSha256: 'model',
  finalSignalCalibratorSha256: 'cal',
};

function bar(time, open, high, low, close, spread = 10) {
  return { time, open, high, low, close, spread };
}

test('Economic V1R2 records NO_FILL_BROKER_STOP_CONSTRAINT instead of widening ATR stop', () => {
  const candles = [
    bar(0, 100, 100.2, 99.8, 100),
    bar(300000, 100, 100.2, 99.8, 100),
    bar(600000, 100, 100.2, 99.8, 100),
    bar(900000, 100, 100.2, 99.8, 100),
  ];
  const signals = [{
    decisionTime: 0,
    decisionClose: 100,
    atrSma12OverClose: 0.0019,
    rawProbability: 0.6,
    calibratedProbability: 0.6,
  }];
  const result = simulateScenarioV1R2(candles, signals, lineage, 10000, {
    name: 'BASE',
    slippageMultiplierOfSpreadPerFill: 0,
  });
  assert.equal(result.summary.filledTrades, 0);
  assert.equal(result.summary.noFillBrokerStopConstraint, 1);
  assert.equal(result.summary.noFillSizing, 0);
});

test('Economic V1R2 keeps exact Risk stop when broker constraint is satisfied', () => {
  const candles = [
    bar(0, 100, 100.8, 99.5, 100.5),
    bar(300000, 100.5, 101.0, 100.2, 100.8),
    bar(600000, 100.8, 101.2, 100.4, 101.0),
    bar(900000, 101.0, 101.3, 100.7, 101.1),
  ];
  const signals = [{
    decisionTime: 0,
    decisionClose: 100,
    atrSma12OverClose: 0.01,
    rawProbability: 0.6,
    calibratedProbability: 0.6,
  }];
  const result = simulateScenarioV1R2(candles, signals, lineage, 10000, {
    name: 'BASE',
    slippageMultiplierOfSpreadPerFill: 0,
  });
  assert.equal(result.summary.filledTrades, 1);
  assert.equal(result.trades[0].stopDistancePrice, 1);
  assert.ok(result.trades[0].initialStopRiskQuote <= 25 + 1e-9);
});

test('V1R2 production CLI exposes no clock or registry override', () => {
  const base = [
    '--dev-dataset', 'dev.csv',
    '--lockbox-dataset', 'lockbox.csv',
    '--final-signal-artifacts', 'final',
    '--mt5-metadata-capture', 'meta.txt',
    '--output', 'out',
  ];
  assert.deepEqual(parseEconomicLockboxArgsV1R2(base), {
    devDataset: 'dev.csv',
    lockboxDataset: 'lockbox.csv',
    finalSignalArtifacts: 'final',
    mt5MetadataCapture: 'meta.txt',
    outputRoot: 'out',
  });
  assert.throws(() => parseEconomicLockboxArgsV1R2([...base, '--now', '9999999999999']), /UNKNOWN_ARGUMENT:--now/);
  assert.throws(() => parseEconomicLockboxArgsV1R2([...base, '--registry', 'other.json']), /UNKNOWN_ARGUMENT:--registry/);
  assert.throws(() => parseEconomicLockboxArgsV1R2([...base, '--partial']), /UNKNOWN_ARGUMENT:--partial/);
});

test('V1R2 production runner owns the clock and has no injectable nowMs parameter', () => {
  const source = fs.readFileSync('quant-core/cli/run-economic-lockbox-v1r2.ts', 'utf8');
  const signatureStart = source.indexOf('export function runEconomicLockboxFromPathsV1R2(');
  const signatureEnd = source.indexOf(') {', signatureStart);
  const signature = source.slice(signatureStart, signatureEnd);
  assert.ok(signature.includes('options: EconomicLockboxCliOptionsV1R2'));
  assert.equal(signature.includes('nowMs'), false);

  const gate = source.indexOf('assertLockboxMatureV1R2(Date.now());');
  const lockboxPath = source.indexOf('const lockboxAbsolute = path.resolve(options.lockboxDataset);');
  const lockboxRead = source.indexOf('fs.readFileSync(lockboxAbsolute)');
  assert.ok(gate >= 0);
  assert.ok(lockboxPath > gate);
  assert.ok(lockboxRead > lockboxPath);
});

test('pure V1R2 maturity boundary remains testable without exposing clock injection to production runner', () => {
  const informationEnd = 1796707800000;
  assert.throws(() => assertLockboxMatureV1R2(informationEnd - 1), /LOCKBOX_NOT_MATURE/);
  assert.doesNotThrow(() => assertLockboxMatureV1R2(informationEnd));
});

test('one-shot registry is exclusive and persists state independently of output root', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockbox-v1r2-registry-'));
  const registry = path.join(dir, 'attempt.json');
  const hash = 'a'.repeat(64);
  try {
    assert.doesNotThrow(() => assertNoPriorLockboxEvaluationV1R2(registry));
    const reserved = reserveLockboxEvaluationV1R2('exec-1', hash, registry);
    assert.equal(reserved.state, 'EVALUATION_RESERVED');
    assert.throws(
      () => reserveLockboxEvaluationV1R2('exec-2', hash, registry),
      /LOCKBOX_V1R2_PRIOR_EVALUATION_REGISTRY_EXISTS/,
    );
    const pnl = transitionLockboxRegistryV1R2('exec-1', hash, 'PNL_EVALUATED', undefined, registry);
    assert.equal(pnl.state, 'PNL_EVALUATED');
    const completed = transitionLockboxRegistryV1R2('exec-1', hash, 'COMPLETED', undefined, registry);
    assert.equal(completed.state, 'COMPLETED');
    const onDisk = JSON.parse(fs.readFileSync(registry, 'utf8'));
    assert.equal(onDisk.executionId, 'exec-1');
    assert.equal(onDisk.lockboxDatasetSha256, hash);
    assert.equal(onDisk.state, 'COMPLETED');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('registry identity mismatch fails closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockbox-v1r2-registry-'));
  const registry = path.join(dir, 'attempt.json');
  const hash = 'b'.repeat(64);
  try {
    reserveLockboxEvaluationV1R2('exec-1', hash, registry);
    assert.throws(
      () => transitionLockboxRegistryV1R2('wrong-exec', hash, 'PNL_EVALUATED', undefined, registry),
      /LOCKBOX_V1R2_REGISTRY_IDENTITY_MISMATCH/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
