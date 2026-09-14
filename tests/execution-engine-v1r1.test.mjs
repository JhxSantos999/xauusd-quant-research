import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

import {
  EXECUTION_V1R1_HOLD_BARS,
  EXECUTION_V1R1_REQUIRED_OPEN_OFFSETS_MS,
  EXECUTION_V1R1_SESSION_REJECTION,
  buildExecutionWindowV1R1,
  openExecutionV1R1,
  stopBeforeTimeExitV1R1,
  timeExitFillV1R1,
} from '../dist/quant-core/execution/execution-engine-v1r1.js';

function sha256(raw) { return crypto.createHash('sha256').update(raw).digest('hex'); }
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

test('Execution V1R1 spec, implementation and metadata binding exact identities are frozen', () => {
  const identities = [
    ['quant-core/research/infinox_xauusd_mt5_metadata_v1.json', 1464, '17098ebb89f0cc71c621a070402892166cf5a31dc768732eec119d12b848cc8d'],
    ['quant-core/research/execution_engine_v1r1.spec.json', 2629, '67599e377311717db43f5431da0188a4608d3d7e0c11e5419140b6691fc86539'],
    ['quant-core/research/execution_engine_v1r1.implementation.json', 969, '869b2ed49afa35919fc6c140f77cca40bf1d209395a11ce743c156385f41bddb'],
  ];
  for (const [path, bytes, hash] of identities) {
    const raw = fs.readFileSync(path);
    assert.equal(raw.length, bytes);
    assert.equal(sha256(raw), hash);
  }
});

test('direct MT5 binding confirms tick economics and all previously pending fields', () => {
  const metadata = JSON.parse(fs.readFileSync('quant-core/research/infinox_xauusd_mt5_metadata_v1.json', 'utf8'));
  assert.equal(metadata.raw_capture.bytes, 1877);
  assert.equal(metadata.raw_capture.sha256, '7b007014ee4ecaff8261f5ab3ef021b762ec990c41c0771dbf81a6330356bcb3');
  assert.equal(metadata.symbol.tick_size, 0.01);
  assert.equal(metadata.symbol.tick_value, 1);
  assert.equal(metadata.symbol.tick_value_profit, 1);
  assert.equal(metadata.symbol.tick_value_loss, 1);
  assert.equal(metadata.sessions.reported_count, 15);
  assert.equal(metadata.research_binding.pnl_evaluated_at_binding, false);
  assert.equal(metadata.research_binding.future_lockbox_accessed_at_binding, false);
});

test('Execution V1R1 requires exactly four contiguous M5 opens from entry through time-exit open', () => {
  assert.equal(EXECUTION_V1R1_HOLD_BARS, 3);
  assert.deepEqual([...EXECUTION_V1R1_REQUIRED_OPEN_OFFSETS_MS], [0,300000,600000,900000]);
  assert.equal(EXECUTION_V1R1_SESSION_REJECTION, 'NO_FILL_SESSION_WINDOW');
  const t = intent().decisionTime;
  const full = [bar(t), bar(t+300000), bar(t+600000), bar(t+900000)];
  assert.ok(buildExecutionWindowV1R1(t, full));
  assert.equal(buildExecutionWindowV1R1(t, [full[0], full[1], full[3]]), null);
  assert.equal(buildExecutionWindowV1R1(t, [full[0], full[1], full[2]]), null);
});

test('Execution V1R1 forbids delayed post-gap entry/exit and exits exactly at decision+15m', () => {
  const i = intent();
  const t = i.decisionTime;
  const bars = [bar(t), bar(t+300000), bar(t+600000), bar(t+900000, { open: 2501 })];
  const opened = openExecutionV1R1(i, bars);
  assert.ok(opened);
  const exit = timeExitFillV1R1('LONG', opened.window);
  assert.equal(exit.time, t + 900000);
  assert.equal(exit.price, 2501);
  assert.equal(openExecutionV1R1(i, [bar(t), bar(t+300000), bar(t+600000), bar(t+1200000)]), null);
});

test('Execution V1R1 stop monitoring ends before the exact time-exit bar', () => {
  const i = intent({ stopDistancePrice: 1 });
  const t = i.decisionTime;
  const bars = [
    bar(t, { low: 2499.5 }),
    bar(t+300000, { low: 2499.5 }),
    bar(t+600000, { low: 2499.5 }),
    bar(t+900000, { open: 2501, high: 2502, low: 2400, close: 2450 }),
  ];
  const opened = openExecutionV1R1(i, bars);
  assert.ok(opened);
  assert.equal(stopBeforeTimeExitV1R1(opened.fill, opened.window), null);
  assert.equal(timeExitFillV1R1('LONG', opened.window).price, 2501);
});

test('legacy Execution V1 identities remain preserved and untouched', () => {
  const spec = fs.readFileSync('quant-core/research/execution_engine_v1.spec.json');
  const impl = fs.readFileSync('quant-core/research/execution_engine_v1.implementation.json');
  assert.equal(spec.length, 3200);
  assert.equal(sha256(spec), '36222916f96cc5e1459281838199fbe6aac8b109e3a5a92e8115c08e5bf67f3d');
  assert.equal(impl.length, 657);
  assert.equal(sha256(impl), '819c6deac5a21426c3db85e496215633031c9fa5d8e3382dacc68d33d0c29e86');
});
