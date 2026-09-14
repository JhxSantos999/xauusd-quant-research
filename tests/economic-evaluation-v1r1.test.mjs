import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

import {
  ECONOMIC_EVALUATION_V1R1_LOCKBOX,
  ECONOMIC_EVALUATION_V1R1_PRIMARY_ACCOUNT,
  ECONOMIC_EVALUATION_V1R1_PRIMARY_GATES,
  ECONOMIC_EVALUATION_V1R1_SCENARIOS,
  ECONOMIC_EVALUATION_V1R1_SPEC_IDENTITY,
  EXECUTION_ENGINE_V1R1_IMPLEMENTATION_IDENTITY_FOR_ECONOMIC,
  EXECUTION_ENGINE_V1R1_SPEC_IDENTITY_FOR_ECONOMIC,
  INFINOX_XAUUSD_MT5_METADATA_V1_IDENTITY,
  INFINOX_XAUUSD_RAW_CAPTURE_V1_IDENTITY,
} from '../dist/quant-core/research/economic-evaluation-v1r1-contracts.js';

function sha256(raw) { return crypto.createHash('sha256').update(raw).digest('hex'); }

test('Economic Evaluation V1R1 semantic and implementation identities are frozen', () => {
  const identities = [
    ECONOMIC_EVALUATION_V1R1_SPEC_IDENTITY,
    { path: 'quant-core/research/economic_evaluation_v1r1.implementation.json', bytes: 1389, sha256: 'a10638e944a86722a24d879dcd095124e8de13c23f442d41dea21d4000071c50' },
    EXECUTION_ENGINE_V1R1_SPEC_IDENTITY_FOR_ECONOMIC,
    EXECUTION_ENGINE_V1R1_IMPLEMENTATION_IDENTITY_FOR_ECONOMIC,
    INFINOX_XAUUSD_MT5_METADATA_V1_IDENTITY,
  ];
  for (const identity of identities) {
    const raw = fs.readFileSync(identity.path);
    assert.equal(raw.length, identity.bytes);
    assert.equal(sha256(raw), identity.sha256);
  }
});

test('Economic Evaluation V1R1 preserves the exact 90-day one-shot lockbox and original gates', () => {
  assert.equal(ECONOMIC_EVALUATION_V1R1_LOCKBOX.informationStart, 1788931800000);
  assert.equal(ECONOMIC_EVALUATION_V1R1_LOCKBOX.firstPotentialDecisionTime, 1788932100000);
  assert.equal(ECONOMIC_EVALUATION_V1R1_LOCKBOX.informationEnd, 1796707800000);
  assert.equal(ECONOMIC_EVALUATION_V1R1_LOCKBOX.calendarDays, 90);
  assert.equal(ECONOMIC_EVALUATION_V1R1_PRIMARY_ACCOUNT.initialEquity, 10000);
  assert.equal(ECONOMIC_EVALUATION_V1R1_PRIMARY_GATES.minimumFilledTrades, 500);
  assert.deepEqual(ECONOMIC_EVALUATION_V1R1_SCENARIOS.map((s) => [s.name,s.slippageMultiplierOfSpreadPerFill]), [
    ['BASE',0],['STRESS_0_5X',0.5],['STRESS_1_0X',1],
  ]);
});

test('Economic V1R1 records direct MT5 capture and clears metadata-pending state before PnL', () => {
  assert.equal(INFINOX_XAUUSD_RAW_CAPTURE_V1_IDENTITY.bytes, 1877);
  assert.equal(INFINOX_XAUUSD_RAW_CAPTURE_V1_IDENTITY.sha256, '7b007014ee4ecaff8261f5ab3ef021b762ec990c41c0771dbf81a6330356bcb3');
  const spec = JSON.parse(fs.readFileSync('quant-core/research/economic_evaluation_v1r1.spec.json','utf8'));
  assert.equal(spec.metadata_gate.required_mt5_fields_resolved, true);
  assert.equal(spec.metadata_gate.live_deployment_metadata_pending, false);
  assert.equal(spec.pnl_evaluated_at_freeze, false);
  assert.equal(spec.future_lockbox_accessed_at_freeze, false);
  assert.equal(spec.execution_lineage_v1r1.raw_metadata_capture.sha256, INFINOX_XAUUSD_RAW_CAPTURE_V1_IDENTITY.sha256);
});

test('Economic V1R1 preflight accepts only final-signal and exact MT5 capture inputs, never a lockbox path', () => {
  const source = fs.readFileSync('quant-core/cli/run-economic-preflight-v1r1.ts','utf8');
  assert.match(source, /--final-signal-artifacts/);
  assert.match(source, /--mt5-metadata-capture/);
  assert.doesNotMatch(source, /--lockbox/);
  assert.doesNotMatch(source, /--dataset/);
  assert.match(source, /lockbox_accessed: false/);
  assert.match(source, /pnl_evaluated: false/);
  assert.match(source, /live_deployment_metadata_pending: false/);
});

test('legacy Economic Evaluation V1 remains preserved', () => {
  const raw = fs.readFileSync('quant-core/research/economic_evaluation_v1.spec.json');
  assert.equal(raw.length, 3816);
  assert.equal(sha256(raw), '2c750ec8532a5b137f08318ae066a83dda64f4616a09560f29a0662a44e7a9bd');
});
