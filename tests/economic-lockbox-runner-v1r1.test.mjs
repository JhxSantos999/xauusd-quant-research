import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  adverseSlippedPriceV1R1,
  evaluatePrimaryGatesV1R1,
  simulateScenarioV1R1,
} from '../dist/quant-core/economic/economic-lockbox-evaluator-v1r1.js';
import {
  assertLockboxMatureV1R1,
  parseEconomicLockboxArgsV1R1,
} from '../dist/quant-core/cli/run-economic-lockbox-v1r1.js';
import {
  ECONOMIC_LOCKBOX_RUNNER_V1R1_IMPLEMENTATION_IDENTITY,
  ECONOMIC_LOCKBOX_RUNNER_V1R1_INFORMATION_END,
  ECONOMIC_LOCKBOX_RUNNER_V1R1_SOURCE_IDENTITIES,
  ECONOMIC_LOCKBOX_RUNNER_V1R1_SPEC_IDENTITY,
} from '../dist/quant-core/research/economic-lockbox-runner-v1r1-contracts.js';

function sha256(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

test('Economic Lockbox Runner V1R1 spec, implementation and source identities are frozen', () => {
  for (const identity of [
    ECONOMIC_LOCKBOX_RUNNER_V1R1_SPEC_IDENTITY,
    ECONOMIC_LOCKBOX_RUNNER_V1R1_IMPLEMENTATION_IDENTITY,
    ...Object.values(ECONOMIC_LOCKBOX_RUNNER_V1R1_SOURCE_IDENTITIES),
  ]) {
    const raw = fs.readFileSync(identity.path);
    assert.equal(raw.length, identity.bytes);
    assert.equal(sha256(raw), identity.sha256);
  }
});

test('production lockbox maturity gate rejects one millisecond early and accepts exact information end', () => {
  assert.throws(
    () => assertLockboxMatureV1R1(ECONOMIC_LOCKBOX_RUNNER_V1R1_INFORMATION_END - 1),
    /LOCKBOX_NOT_MATURE/,
  );
  assert.doesNotThrow(() => assertLockboxMatureV1R1(ECONOMIC_LOCKBOX_RUNNER_V1R1_INFORMATION_END));
});

test('production CLI exposes no clock override or partial-run bypass', () => {
  const base = [
    '--dev-dataset', 'dev.csv',
    '--lockbox-dataset', 'lockbox.csv',
    '--final-signal-artifacts', 'final',
    '--mt5-metadata-capture', 'meta.txt',
    '--output', 'out',
  ];
  assert.deepEqual(parseEconomicLockboxArgsV1R1(base), {
    devDataset: 'dev.csv',
    lockboxDataset: 'lockbox.csv',
    finalSignalArtifacts: 'final',
    mt5MetadataCapture: 'meta.txt',
    outputRoot: 'out',
  });
  assert.throws(() => parseEconomicLockboxArgsV1R1([...base, '--now', '9999999999999']), /UNKNOWN_ARGUMENT:--now/);
  assert.throws(() => parseEconomicLockboxArgsV1R1([...base, '--partial']), /UNKNOWN_ARGUMENT:--partial/);
  assert.throws(() => parseEconomicLockboxArgsV1R1([...base, '--dry-run']), /UNKNOWN_ARGUMENT:--dry-run/);
});

test('production source gates time before any lockbox filesystem read', () => {
  const source = fs.readFileSync('quant-core/cli/run-economic-lockbox-v1r1.ts', 'utf8');
  const gate = source.indexOf('assertLockboxMatureV1R1(nowMs);');
  const lockboxPath = source.indexOf('const lockboxAbsolute = path.resolve(options.lockboxDataset);');
  const lockboxRead = source.indexOf('fs.readFileSync(lockboxAbsolute)');
  assert.ok(gate >= 0);
  assert.ok(lockboxPath > gate);
  assert.ok(lockboxRead > lockboxPath);
  assert.equal(source.includes('--now'), false);
  assert.equal(source.includes('--partial'), false);
});

test('adverse slippage is directionally correct for LONG and SHORT on entry and exit', () => {
  assert.equal(adverseSlippedPriceV1R1('LONG', 'ENTRY', 100, 0.2, 0.5), 100.1);
  assert.equal(adverseSlippedPriceV1R1('LONG', 'EXIT', 100, 0.2, 0.5), 99.9);
  assert.equal(adverseSlippedPriceV1R1('SHORT', 'ENTRY', 100, 0.2, 0.5), 99.9);
  assert.equal(adverseSlippedPriceV1R1('SHORT', 'EXIT', 100, 0.2, 0.5), 100.1);
});

const lineage = {
  finalSignalExecutionId: 'signal',
  finalSignalModelSha256: 'model',
  finalSignalCalibratorSha256: 'cal',
};

function bar(time, open, high, low, close, spread = 10) {
  return { time, open, high, low, close, spread };
}

test('scenario simulation uses executable Bid/Ask, fixed base stop path and independent adverse fill slippage', () => {
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
  const base = simulateScenarioV1R1(candles, signals, lineage, 10000, {
    name: 'BASE',
    slippageMultiplierOfSpreadPerFill: 0,
  });
  const stress = simulateScenarioV1R1(candles, signals, lineage, 10000, {
    name: 'STRESS_0_5X',
    slippageMultiplierOfSpreadPerFill: 0.5,
  });

  assert.equal(base.summary.filledTrades, 1);
  assert.equal(base.trades[0].side, 'LONG');
  assert.equal(base.trades[0].exitReason, 'TIME_EXIT');
  assert.equal(base.trades[0].baseEntryPrice, 100.1);
  assert.equal(base.trades[0].baseExitPrice, 101);
  assert.ok(base.trades[0].pnlQuote > stress.trades[0].pnlQuote);
  assert.equal(stress.trades[0].scenarioEntryPrice, 100.15);
  assert.equal(stress.trades[0].scenarioExitPrice, 100.95);
});

test('missing one of the four exact M5 execution bars rejects the intent as NO_FILL_SESSION_WINDOW', () => {
  const candles = [
    bar(0, 100, 101, 99.5, 100.5),
    bar(300000, 100.5, 101, 100, 100.7),
    bar(900000, 100.8, 101, 100.5, 100.9),
  ];
  const signals = [{
    decisionTime: 0,
    decisionClose: 100,
    atrSma12OverClose: 0.01,
    rawProbability: 0.6,
    calibratedProbability: 0.6,
  }];
  const result = simulateScenarioV1R1(candles, signals, lineage, 10000, {
    name: 'BASE',
    slippageMultiplierOfSpreadPerFill: 0,
  });
  assert.equal(result.summary.filledTrades, 0);
  assert.equal(result.summary.noFillSessionWindow, 1);
});

function summary(overrides) {
  return {
    scenario: 'BASE',
    slippageMultiplierOfSpreadPerFill: 0,
    initialEquity: 10000,
    finalEquity: 10100,
    finalEquityDelta: 100,
    filledTrades: 600,
    winningTrades: 320,
    losingTrades: 280,
    breakevenTrades: 0,
    winRate: 320 / 600,
    grossProfit: 1000,
    grossLossAbs: 900,
    profitFactor: 1000 / 900,
    profitFactorInfinite: false,
    meanRealizedR: 0.01,
    averageTradeQuote: 100 / 600,
    maxDrawdownQuote: 200,
    maxDrawdownFraction: 0.02,
    minEquity: 9800,
    stopExits: 300,
    timeExits: 300,
    signalsProcessed: 1000,
    tradeIntents: 600,
    noTradePositionOpen: 400,
    noTradeProbabilityExactHalf: 0,
    noFillSessionWindow: 0,
    noFillSizing: 0,
    terminatedForNonpositiveEquity: false,
    ...overrides,
  };
}

test('primary gates require BASE and half-spread stress, while 1.0x stress is diagnostic only', () => {
  const result = evaluatePrimaryGatesV1R1([
    { summary: summary({ scenario: 'BASE' }), trades: [] },
    { summary: summary({ scenario: 'STRESS_0_5X', finalEquityDelta: 10, profitFactor: 1.01 }), trades: [] },
    { summary: summary({ scenario: 'STRESS_1_0X', finalEquityDelta: -500, profitFactor: 0.5 }), trades: [] },
  ], { minimumFilledTrades: 500 });
  assert.equal(result.allRequiredGatesPass, true);

  const fail = evaluatePrimaryGatesV1R1([
    { summary: summary({ scenario: 'BASE' }), trades: [] },
    { summary: summary({ scenario: 'STRESS_0_5X', finalEquityDelta: -1, profitFactor: 0.99 }), trades: [] },
    { summary: summary({ scenario: 'STRESS_1_0X' }), trades: [] },
  ], { minimumFilledTrades: 500 });
  assert.equal(fail.allRequiredGatesPass, false);
});
