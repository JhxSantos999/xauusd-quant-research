import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

import {
  evaluateRiskV1,
  RISK_ENGINE_V1_PER_TRADE_EQUITY_FRACTION,
  RISK_ENGINE_V1_MAX_GROSS_EXPOSURE_MULTIPLE,
  RISK_ENGINE_V1_STOP_ATR_MULTIPLE,
  RISK_ENGINE_V1_TIME_EXIT_BARS,
  RISK_ENGINE_V1_TIME_EXIT_MS,
} from '../dist/quant-core/risk/risk-engine.js';
import {
  RISK_ENGINE_V1_SPEC_IDENTITY,
  RISK_ENGINE_V1_IMPLEMENTATION_BINDING,
  AUDITED_FINAL_SIGNAL_EXECUTION_V1R1,
  FROZEN_RISK_POLICY_V1,
} from '../dist/quant-core/research/risk-engine-contracts.js';

function sha256(raw) { return crypto.createHash('sha256').update(raw).digest('hex'); }
const lineage = {
  finalSignalExecutionId: AUDITED_FINAL_SIGNAL_EXECUTION_V1R1.executionId,
  finalSignalModelSha256: AUDITED_FINAL_SIGNAL_EXECUTION_V1R1.files.model.sha256,
  finalSignalCalibratorSha256: AUDITED_FINAL_SIGNAL_EXECUTION_V1R1.files.calibrator.sha256,
};
function input(overrides = {}) {
  return {
    asset: 'XAUUSD',
    timeframe: 'M5',
    decisionTime: 1_800_000_000_000,
    calibratedProbability: 0.51,
    decisionClose: 2500,
    atrSma12OverClose: 0.001,
    accountEquityQuote: 10_000,
    positionState: 'FLAT',
    finalSignalExecutionId: lineage.finalSignalExecutionId,
    finalSignalModelSha256: lineage.finalSignalModelSha256,
    finalSignalCalibratorSha256: lineage.finalSignalCalibratorSha256,
    ...overrides,
  };
}

test('Risk Engine V1 exact semantic spec and implementation binding identities are frozen', () => {
  for (const identity of [RISK_ENGINE_V1_SPEC_IDENTITY, RISK_ENGINE_V1_IMPLEMENTATION_BINDING]) {
    const raw = fs.readFileSync(identity.path);
    assert.equal(raw.length, identity.bytes);
    assert.equal(sha256(raw), identity.sha256);
  }
});

test('Risk Engine V1 policy constants are exact and not data-fitted', () => {
  assert.equal(RISK_ENGINE_V1_PER_TRADE_EQUITY_FRACTION, 0.0025);
  assert.equal(RISK_ENGINE_V1_MAX_GROSS_EXPOSURE_MULTIPLE, 1);
  assert.equal(RISK_ENGINE_V1_STOP_ATR_MULTIPLE, 1);
  assert.equal(RISK_ENGINE_V1_TIME_EXIT_BARS, 3);
  assert.equal(RISK_ENGINE_V1_TIME_EXIT_MS, 900000);
  assert.deepEqual(FROZEN_RISK_POLICY_V1, {
    perTradeEquityFraction: 0.0025,
    maxGrossExposureMultiple: 1,
    stopAtrMultiple: 1,
    timeExitBars: 3,
    timeExitMs: 900000,
    decisionThreshold: 0.5,
    takeProfitPolicy: 'NONE',
    maxOpenPositionsXauusd: 1,
  });
});

test('Risk Engine V1 maps calibrated probability above/below 0.5 symmetrically and exact 0.5 to NO_TRADE', () => {
  const long = evaluateRiskV1(input({ calibratedProbability: 0.5000001 }), lineage);
  const short = evaluateRiskV1(input({ calibratedProbability: 0.4999999 }), lineage);
  const flat = evaluateRiskV1(input({ calibratedProbability: 0.5 }), lineage);
  assert.equal(long.action, 'TRADE_INTENT');
  assert.equal(long.side, 'LONG');
  assert.equal(short.action, 'TRADE_INTENT');
  assert.equal(short.side, 'SHORT');
  assert.equal(flat.action, 'NO_TRADE');
  assert.equal(flat.reason, 'PROBABILITY_EXACTLY_0_5');
});

test('Risk Engine V1 emits fixed risk budget, 1x gross cap, 1 ATR stop and 3-bar time exit', () => {
  const result = evaluateRiskV1(input(), lineage);
  assert.equal(result.action, 'TRADE_INTENT');
  assert.equal(result.maxQuoteRisk, 25);
  assert.equal(result.maxGrossNotionalQuote, 10000);
  assert.equal(result.stopDistancePrice, 2.5);
  assert.equal(result.timeExitTime, 1_800_000_900_000);
  assert.equal(result.takeProfitPolicy, 'NONE');
  assert.equal(result.quantityConversion, 'DEFERRED_TO_EXECUTION_ENGINE');
});

test('Risk Engine V1 refuses overlapping entries while a position is open', () => {
  for (const positionState of ['LONG', 'SHORT']) {
    const result = evaluateRiskV1(input({ positionState }), lineage);
    assert.equal(result.action, 'NO_TRADE');
    assert.equal(result.reason, 'POSITION_ALREADY_OPEN');
  }
});

test('Risk Engine V1 fails loud on invalid inputs and Final Signal lineage mismatch', () => {
  assert.throws(() => evaluateRiskV1(input({ calibratedProbability: 1.01 }), lineage), /INVALID_CALIBRATED_PROBABILITY/);
  assert.throws(() => evaluateRiskV1(input({ accountEquityQuote: 0 }), lineage), /INVALID_ACCOUNT_EQUITY/);
  assert.throws(() => evaluateRiskV1(input({ decisionClose: Number.NaN }), lineage), /INVALID_DECISION_CLOSE/);
  assert.throws(() => evaluateRiskV1(input({ atrSma12OverClose: 0 }), lineage), /INVALID_ATR_RATIO/);
  assert.throws(() => evaluateRiskV1(input({ finalSignalModelSha256: 'wrong' }), lineage), /SIGNAL_LINEAGE_MISMATCH/);
});

test('Risk Engine V1 is hard-bound to the audited Final Signal artifacts and keeps lockbox outside scope', () => {
  assert.equal(AUDITED_FINAL_SIGNAL_EXECUTION_V1R1.executionId, 'final_signal_v1r1_20260913235306128');
  assert.equal(AUDITED_FINAL_SIGNAL_EXECUTION_V1R1.files.model.sha256, 'f4869afd3cfeb681bca356ee08d80a63fb617a841427932a571ff2e2306f7655');
  assert.equal(AUDITED_FINAL_SIGNAL_EXECUTION_V1R1.files.calibrator.sha256, '6d851a2eaa61deaa00bc2bc7899ad40fabc5b8758cd58ed933782709996ac17c');
  assert.equal(AUDITED_FINAL_SIGNAL_EXECUTION_V1R1.artifactManifestSemanticSha256, 'a4ee4aa9ab1af075aacdefa68919e4e81f0992e5d7b6219089006090d57f3b60');
});
