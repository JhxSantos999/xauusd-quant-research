import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

import {
  EXECUTION_V1_POINT,
  EXECUTION_V1_CONTRACT_SIZE,
  EXECUTION_V1_STOPS_LEVEL_POINTS,
  EXECUTION_V1_VOLUME_MIN,
  EXECUTION_V1_VOLUME_MAX,
  EXECUTION_V1_VOLUME_STEP,
  EXECUTION_V1_COMMISSION_PER_LOT_PER_SIDE,
  quoteBarV1,
  sizeExecutionV1,
  openExecutionV1,
  stopFillPriceV1,
  timeExitFillPriceV1,
  quotePnlV1,
} from '../dist/quant-core/execution/execution-engine.js';
import {
  EXECUTION_ENGINE_V1_SPEC_IDENTITY,
  EXECUTION_ENGINE_V1_IMPLEMENTATION_BINDING,
  FROZEN_EXECUTION_BROKER_METADATA_V1,
  AUDITED_RISK_ENGINE_V1,
  AUDITED_FINAL_SIGNAL_V1R1,
} from '../dist/quant-core/research/execution-engine-contracts.js';

function sha256(raw) { return crypto.createHash('sha256').update(raw).digest('hex'); }
function intent(overrides = {}) {
  return {
    version: 'risk_engine_v1',
    action: 'TRADE_INTENT',
    side: 'LONG',
    decisionTime: 1_800_000_000_000,
    calibratedProbability: 0.51,
    riskFraction: 0.0025,
    maxQuoteRisk: 25,
    maxGrossExposureMultiple: 1,
    maxGrossNotionalQuote: 10000,
    stopAtrMultiple: 1,
    stopDistancePrice: 2,
    timeExitBars: 3,
    timeExitTime: 1_800_000_900_000,
    takeProfitPolicy: 'NONE',
    quantityConversion: 'DEFERRED_TO_EXECUTION_ENGINE',
    ...overrides,
  };
}
function bar(overrides = {}) {
  return {
    time: 1_800_000_000_000,
    open: 2500,
    high: 2502,
    low: 2498,
    close: 2501,
    spreadPoints: 18,
    ...overrides,
  };
}

test('Execution Engine V1 exact semantic spec and implementation binding identities are frozen', () => {
  for (const identity of [EXECUTION_ENGINE_V1_SPEC_IDENTITY, EXECUTION_ENGINE_V1_IMPLEMENTATION_BINDING]) {
    const raw = fs.readFileSync(identity.path);
    assert.equal(raw.length, identity.bytes);
    assert.equal(sha256(raw), identity.sha256);
  }
});

test('Execution Engine V1 broker metadata is exact and pre-PnL frozen', () => {
  assert.equal(EXECUTION_V1_POINT, 0.01);
  assert.equal(EXECUTION_V1_CONTRACT_SIZE, 100);
  assert.equal(EXECUTION_V1_STOPS_LEVEL_POINTS, 20);
  assert.equal(EXECUTION_V1_VOLUME_MIN, 0.01);
  assert.equal(EXECUTION_V1_VOLUME_MAX, 20);
  assert.equal(EXECUTION_V1_VOLUME_STEP, 0.01);
  assert.equal(EXECUTION_V1_COMMISSION_PER_LOT_PER_SIDE, 0);
  assert.equal(FROZEN_EXECUTION_BROKER_METADATA_V1.accountType, 'STP');
  assert.equal(FROZEN_EXECUTION_BROKER_METADATA_V1.fillPolicy, 'IOC');
  assert.equal(FROZEN_EXECUTION_BROKER_METADATA_V1.chartPriceSide, 'BID');
});

test('CSV Bid OHLC plus spread points deterministically produces Ask OHLC', () => {
  const q = quoteBarV1(bar());
  assert.equal(q.spreadPrice, 0.18);
  assert.equal(q.askOpen, 2500.18);
  assert.equal(q.askHigh, 2502.18);
  assert.equal(q.askLow, 2498.18);
  assert.equal(q.askClose, 2501.18);
});

test('Execution sizing respects both 0.25% risk and 1x gross cap then floors to 0.01 lot', () => {
  const sized = sizeExecutionV1(intent(), 2500.18);
  assert.ok(sized);
  assert.equal(sized.volume, 0.03);
  assert.ok(sized.maxLossAtStopBeforeSlippageQuote <= 25);
  assert.ok(sized.grossNotionalQuote <= 10000);
});

test('broker minimum stop level overrides too-small ATR stop distance', () => {
  const sized = sizeExecutionV1(intent({ stopDistancePrice: 0.05 }), 2500);
  assert.ok(sized);
  assert.equal(sized.stopDistancePrice, 0.2);
});

test('LONG enters Ask and SHORT enters Bid only on a bar opening exactly at decisionTime', () => {
  const long = openExecutionV1(intent({ side: 'LONG' }), bar());
  const short = openExecutionV1(intent({ side: 'SHORT' }), bar());
  assert.ok(long);
  assert.ok(short);
  assert.equal(long.price, 2500.18);
  assert.equal(short.price, 2500);
  assert.equal(openExecutionV1(intent(), bar({ time: 1_800_000_300_000 })), null);
});

test('stop fills at stop unless bar opens beyond stop, using Bid for LONG and Ask for SHORT', () => {
  const long = openExecutionV1(intent({ side: 'LONG' }), bar());
  assert.ok(long);
  assert.equal(stopFillPriceV1(long, bar({ low: long.stopPrice - 0.5 })), long.stopPrice);
  assert.equal(stopFillPriceV1(long, bar({ open: long.stopPrice - 1, high: long.stopPrice, low: long.stopPrice - 2, close: long.stopPrice - 1 })), long.stopPrice - 1);
  const short = openExecutionV1(intent({ side: 'SHORT' }), bar());
  assert.ok(short);
  assert.equal(stopFillPriceV1(short, bar({ high: short.stopPrice + 0.1 })), short.stopPrice);
});

test('time exit and quote PnL use executable Bid/Ask sides', () => {
  const b = bar({ open: 2501, spreadPoints: 20 });
  assert.equal(timeExitFillPriceV1('LONG', b), 2501);
  assert.equal(timeExitFillPriceV1('SHORT', b), 2501.2);
  assert.equal(quotePnlV1('LONG', 2500, 2501, 0.1), 10);
  assert.equal(quotePnlV1('SHORT', 2501, 2500, 0.1), 10);
});

test('Execution Engine V1 is hard-bound to frozen Risk and audited Final Signal lineage', () => {
  assert.equal(AUDITED_RISK_ENGINE_V1.sourceCommit, 'a28aedd9f160581871d911240e94dc755281ddb6');
  assert.equal(AUDITED_RISK_ENGINE_V1.spec.sha256, '93dd6c9a5ba4d1049b92cbb009d3f844bd1841f9049950bc551c6c3167b3b233');
  assert.equal(AUDITED_FINAL_SIGNAL_V1R1.executionId, 'final_signal_v1r1_20260913235306128');
  assert.equal(AUDITED_FINAL_SIGNAL_V1R1.modelSha256, 'f4869afd3cfeb681bca356ee08d80a63fb617a841427932a571ff2e2306f7655');
  assert.equal(AUDITED_FINAL_SIGNAL_V1R1.calibratorSha256, '6d851a2eaa61deaa00bc2bc7899ad40fabc5b8758cd58ed933782709996ac17c');
});
