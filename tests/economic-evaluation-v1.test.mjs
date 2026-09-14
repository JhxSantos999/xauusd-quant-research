import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

import {
  ECONOMIC_EVALUATION_V1_LOCKBOX,
  ECONOMIC_EVALUATION_V1_PRIMARY_ACCOUNT,
  ECONOMIC_EVALUATION_V1_PRIMARY_GATES,
  ECONOMIC_EVALUATION_V1_REQUIRED_MT5_FIELDS,
  ECONOMIC_EVALUATION_V1_SCENARIOS,
  ECONOMIC_EVALUATION_V1_SPEC_IDENTITY,
  AUDITED_EXECUTION_ENGINE_V1,
  AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_EVAL,
} from '../dist/quant-core/research/economic-evaluation-contracts.js';
import { ECONOMIC_EVALUATION_V1_IMPLEMENTATION_BINDING } from '../dist/quant-core/research/economic-evaluation-identities.js';

function sha256(raw) { return crypto.createHash('sha256').update(raw).digest('hex'); }

test('Economic Evaluation V1 semantic spec and implementation binding identities are frozen', () => {
  for (const identity of [ECONOMIC_EVALUATION_V1_SPEC_IDENTITY, ECONOMIC_EVALUATION_V1_IMPLEMENTATION_BINDING]) {
    const raw = fs.readFileSync(identity.path);
    assert.equal(raw.length, identity.bytes);
    assert.equal(sha256(raw), identity.sha256);
  }
});

test('Economic Evaluation V1 reserves a fixed 90-day future lockbox without partial peeking', () => {
  assert.equal(ECONOMIC_EVALUATION_V1_LOCKBOX.informationStart, 1788931800000);
  assert.equal(ECONOMIC_EVALUATION_V1_LOCKBOX.firstPotentialDecisionTime, 1788932100000);
  assert.equal(ECONOMIC_EVALUATION_V1_LOCKBOX.informationEnd, 1796707800000);
  assert.equal(ECONOMIC_EVALUATION_V1_LOCKBOX.informationEnd - ECONOMIC_EVALUATION_V1_LOCKBOX.informationStart, 90 * 86_400_000);
  const spec = JSON.parse(fs.readFileSync(ECONOMIC_EVALUATION_V1_SPEC_IDENTITY.path, 'utf8'));
  assert.equal(spec.future_lockbox.allow_partial_evaluation, false);
  assert.equal(spec.future_lockbox.allow_repeated_peeking, false);
  assert.equal(spec.future_lockbox.training_or_calibration_on_lockbox, false);
  assert.equal(spec.governance.future_lockbox_accessed_at_freeze, false);
});

test('Economic Evaluation V1 freezes primary account, gates and mandatory stress scenarios before PnL', () => {
  assert.equal(ECONOMIC_EVALUATION_V1_PRIMARY_ACCOUNT.initialEquity, 10_000);
  assert.equal(ECONOMIC_EVALUATION_V1_PRIMARY_GATES.minimumFilledTrades, 500);
  assert.deepEqual(ECONOMIC_EVALUATION_V1_SCENARIOS, [
    { name: 'BASE', slippageMultiplierOfSpreadPerFill: 0 },
    { name: 'STRESS_0_5X', slippageMultiplierOfSpreadPerFill: 0.5 },
    { name: 'STRESS_1_0X', slippageMultiplierOfSpreadPerFill: 1 },
  ]);
});

test('Economic Evaluation V1 is hard-bound to frozen Execution Engine and audited Final Signal', () => {
  assert.equal(AUDITED_EXECUTION_ENGINE_V1.sourceCommit, '288d16f0e00bbc39d21b4fe32b1322bc62195399');
  assert.equal(AUDITED_EXECUTION_ENGINE_V1.spec.sha256, '36222916f96cc5e1459281838199fbe6aac8b109e3a5a92e8115c08e5bf67f3d');
  assert.equal(AUDITED_EXECUTION_ENGINE_V1.implementationBinding.sha256, '819c6deac5a21426c3db85e496215633031c9fa5d8e3382dacc68d33d0c29e86');
  assert.equal(AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_EVAL.executionId, 'final_signal_v1r1_20260913235306128');
  assert.equal(AUDITED_FINAL_SIGNAL_V1R1_FOR_ECONOMIC_EVAL.modelSha256, 'f4869afd3cfeb681bca356ee08d80a63fb617a841427932a571ff2e2306f7655');
});

test('Economic Evaluation V1 preflight cannot accept or read a lockbox dataset', () => {
  const source = fs.readFileSync('quant-core/cli/run-economic-preflight-v1.ts', 'utf8');
  assert.equal(source.includes('--lockbox-dataset'), false);
  assert.equal(source.includes('lockbox_accessed: false'), true);
  assert.equal(source.includes('pnl_evaluated: false'), true);
});

test('Economic Evaluation V1 blocks full run until direct MT5 metadata capture is complete', () => {
  assert.deepEqual(ECONOMIC_EVALUATION_V1_REQUIRED_MT5_FIELDS, [
    'SYMBOL_TRADE_TICK_SIZE',
    'SYMBOL_TRADE_TICK_VALUE',
    'SYMBOL_TRADE_TICK_VALUE_PROFIT',
    'SYMBOL_TRADE_TICK_VALUE_LOSS',
    'SYMBOL_TRADE_SESSIONS',
  ]);
});
