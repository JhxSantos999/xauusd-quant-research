import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXECUTION_V1R2_BROKER_STOP_REJECTION,
  EXECUTION_V1R2_SESSION_REJECTION,
  brokerMinimumStopDistanceV1R2,
  openExecutionV1R2,
  sizeExecutionV1R2,
  stopBeforeTimeExitV1R2,
  timeExitFillV1R2,
} from '../dist/quant-core/execution/execution-engine-v1r2.js';

function bar(time, overrides = {}) {
  return { time, open: 2500, high: 2502, low: 2498, close: 2501, spreadPoints: 18, ...overrides };
}

function intent(overrides = {}) {
  const decisionTime = 1_800_000_000_000;
  return {
    version: 'risk_engine_v1',
    action: 'TRADE_INTENT',
    side: 'LONG',
    decisionTime,
    calibratedProbability: 0.51,
    riskFraction: 0.0025,
    maxQuoteRisk: 25,
    maxGrossExposureMultiple: 1,
    maxGrossNotionalQuote: 10000,
    stopAtrMultiple: 1,
    stopDistancePrice: 2,
    timeExitBars: 3,
    timeExitTime: decisionTime + 900000,
    takeProfitPolicy: 'NONE',
    quantityConversion: 'DEFERRED_TO_EXECUTION_ENGINE',
    ...overrides,
  };
}

test('Execution V1R2 preserves exact Risk stop and never widens it to broker minimum', () => {
  const i = intent({ stopDistancePrice: 0.21 });
  const t = i.decisionTime;
  const result = openExecutionV1R2(i, [bar(t), bar(t+300000), bar(t+600000), bar(t+900000)]);
  assert.equal(result.status, 'FILLED');
  if (result.status !== 'FILLED') return;
  assert.equal(result.fill.stopDistancePrice, i.stopDistancePrice);
  assert.equal(result.fill.stopPrice, result.fill.price - i.stopDistancePrice);
});

test('Execution V1R2 rejects ATR stop below broker minimum instead of mutating Risk intent', () => {
  assert.equal(brokerMinimumStopDistanceV1R2(), 0.2);
  const i = intent({ stopDistancePrice: 0.19 });
  const t = i.decisionTime;
  const result = openExecutionV1R2(i, [bar(t), bar(t+300000), bar(t+600000), bar(t+900000)]);
  assert.deepEqual(result, { status: 'NO_FILL', reason: EXECUTION_V1R2_BROKER_STOP_REJECTION });
});

test('Execution V1R2 accepts stop exactly at broker minimum', () => {
  const i = intent({ stopDistancePrice: 0.2 });
  const t = i.decisionTime;
  const result = openExecutionV1R2(i, [bar(t), bar(t+300000), bar(t+600000), bar(t+900000)]);
  assert.equal(result.status, 'FILLED');
  if (result.status !== 'FILLED') return;
  assert.equal(result.fill.stopDistancePrice, 0.2);
});

test('Execution V1R2 post-fill risk never exceeds Risk Engine budget', () => {
  for (const stopDistancePrice of [0.2, 0.21, 0.5, 1, 2, 10]) {
    const i = intent({ stopDistancePrice });
    const t = i.decisionTime;
    const result = openExecutionV1R2(i, [bar(t), bar(t+300000), bar(t+600000), bar(t+900000)]);
    assert.equal(result.status, 'FILLED');
    if (result.status !== 'FILLED') continue;
    const actualStopRisk = result.fill.volume * 100 * result.fill.stopDistancePrice;
    assert.ok(actualStopRisk <= i.maxQuoteRisk + 1e-9);
    assert.equal(result.fill.stopDistancePrice, i.stopDistancePrice);
  }
});

test('Execution V1R2 preserves session continuity rejection from V1R1', () => {
  const i = intent();
  const t = i.decisionTime;
  const result = openExecutionV1R2(i, [bar(t), bar(t+300000), bar(t+900000)]);
  assert.deepEqual(result, { status: 'NO_FILL', reason: EXECUTION_V1R2_SESSION_REJECTION });
});

test('Execution V1R2 retains stop and time-exit behavior after a valid fill', () => {
  const i = intent({ stopDistancePrice: 1 });
  const t = i.decisionTime;
  const bars = [
    bar(t, { low: 2499.5 }),
    bar(t+300000, { low: 2499.5 }),
    bar(t+600000, { low: 2499.5 }),
    bar(t+900000, { open: 2501, high: 2502, low: 2400, close: 2450 }),
  ];
  const result = openExecutionV1R2(i, bars);
  assert.equal(result.status, 'FILLED');
  if (result.status !== 'FILLED') return;
  assert.equal(stopBeforeTimeExitV1R2(result.fill, result.window), null);
  assert.deepEqual(timeExitFillV1R2('LONG', result.window), { time: t + 900000, price: 2501 });
});

test('Execution V1R2 sizing uses exact Risk stop and conservative volume floor', () => {
  const i = intent({ stopDistancePrice: 1, maxQuoteRisk: 25 });
  const sizing = sizeExecutionV1R2(i, 2500.18);
  assert.ok(sizing);
  assert.equal(sizing.stopDistancePrice, 1);
  assert.ok(sizing.maxLossAtStopBeforeSlippageQuote <= 25 + 1e-9);
});
