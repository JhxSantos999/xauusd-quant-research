import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

import {
  DEV_RETROSPECTIVE_OBSERVABILITY_V1_CAUSAL_HISTORICAL_PREDICTION,
  DEV_RETROSPECTIVE_OBSERVABILITY_V1_MODE,
  DEV_RETROSPECTIVE_OBSERVABILITY_V1_OUTCOMES_READ,
  DEV_RETROSPECTIVE_OBSERVABILITY_V1_RECORD_COUNT,
  DEV_RETROSPECTIVE_OBSERVABILITY_V1_RISK_STATE_MODE,
  buildDevRetrospectiveObservationV1,
  selectDevRetrospectiveFeatureRowsV1,
} from '../dist/quant-core/replay/dev-retrospective-observability-v1.js';

const identities = {
  core: {
    path: 'quant-core/replay/dev-retrospective-observability-v1.ts',
    bytes: 5864,
    sha256: '41ef19b4e64fab9dee32861fef2867fc76f180fb6aa7d560bf930a2bfd714da8',
  },
  cli: {
    path: 'quant-core/cli/run-dev-retrospective-observability-v1.ts',
    bytes: 9339,
    sha256: 'ea25eec99410d2e4bc1fe03e3907b62d1ed7fbdac84da44433601656e92060c7',
  },
  spec: {
    path: 'quant-core/research/dev_retrospective_observability_v1.spec.json',
    bytes: 2713,
    sha256: '9c4fc480b8b1315a77bf524e89b5193addb32b7daf7d3419cb1a9b3192f4e80b',
  },
  implementation: {
    path: 'quant-core/research/dev_retrospective_observability_v1.implementation.json',
    bytes: 1717,
    sha256: '271a28383d92fd391cdbe770923b7a73b398a69903c4f9310f89705d5f15d4e9',
  },
};

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function feature(i, decisionTime) {
  return {
    barIndex: i,
    decisionBarOpenTime: decisionTime - 300000,
    decisionTime,
    vector: [0.001, 0.002, 0.003, 0.004, 0.005, 0.006, 0.007, 0.008, 0.1, 0.002],
  };
}

const model = {
  version: 'logreg_v1',
  featureCount: 10,
  weights: [24.210834004980466, 10.287269316228466, -19.730917871308595, 9.18768540609662, -1.386119606465847, -3.219360474468669, -11.454351201253516, -13.830521447904575, -0.05414865274094255, 30.431097601241706],
  intercept: -0.07899453352436417,
  iterations: 1,
  objective: 1,
};

const calibrator = {
  version: 'platt_v1',
  slope: 0.268656581334739,
  intercept: 0.032185770310444575,
  iterations: 1,
  objective: 1,
  positiveTarget: 0.5,
  negativeTarget: 0.5,
};

test('DEV retrospective observability constants explicitly deny causal historical interpretation', () => {
  assert.equal(DEV_RETROSPECTIVE_OBSERVABILITY_V1_MODE, 'DEV_RETROSPECTIVE_OBSERVABILITY_ONLY');
  assert.equal(DEV_RETROSPECTIVE_OBSERVABILITY_V1_RECORD_COUNT, 288);
  assert.equal(DEV_RETROSPECTIVE_OBSERVABILITY_V1_CAUSAL_HISTORICAL_PREDICTION, false);
  assert.equal(DEV_RETROSPECTIVE_OBSERVABILITY_V1_OUTCOMES_READ, false);
  assert.equal(DEV_RETROSPECTIVE_OBSERVABILITY_V1_RISK_STATE_MODE, 'ISOLATED_FLAT_PER_EVENT');
});

test('DEV retrospective feature selector deterministically chooses the last 288 observed rows in increasing time', () => {
  const end = Date.parse('2026-09-09T05:30:00Z');
  const rows = Array.from({ length: 300 }, (_, i) => feature(i, end - (299 - i) * 300000));
  const selected = selectDevRetrospectiveFeatureRowsV1(rows);
  assert.equal(selected.length, 288);
  assert.equal(selected[0].barIndex, 12);
  assert.equal(selected.at(-1).barIndex, 299);
  assert.equal(selected.at(-1).decisionTime, end);
});

test('DEV retrospective selector fails closed on post-DEV or nonincreasing decision times', () => {
  const end = Date.parse('2026-09-09T05:30:00Z');
  const rows = Array.from({ length: 288 }, (_, i) => feature(i, end - (287 - i) * 300000));
  assert.throws(
    () => selectDevRetrospectiveFeatureRowsV1([...rows.slice(0, -1), feature(287, end + 1)]),
    /INFORMATION_BOUNDARY_VIOLATION/,
  );
  const duplicate = [...rows];
  duplicate[287] = feature(287, duplicate[286].decisionTime);
  assert.throws(
    () => selectDevRetrospectiveFeatureRowsV1(duplicate),
    /NONINCREASING_DECISION_TIME/,
  );
});

test('DEV retrospective observation deterministically traverses frozen signal, risk and bridge with isolated FLAT telemetry', () => {
  const decisionTime = Date.parse('2026-09-09T05:30:00Z');
  const a = buildDevRetrospectiveObservationV1(0, feature(24, decisionTime), 3500, model, calibrator);
  const b = buildDevRetrospectiveObservationV1(0, feature(24, decisionTime), 3500, model, calibrator);
  assert.deepEqual(a, b);
  assert.equal(a.signal.decisionTime, decisionTime);
  assert.equal(a.riskDecision.asset, 'XAUUSD');
  assert.match(a.envelope.eventId, /^[0-9a-f]{64}$/);
});

test('DEV retrospective observability spec blocks outcomes, performance, execution and V1 tuning', async () => {
  const spec = JSON.parse(await fs.readFile('quant-core/research/dev_retrospective_observability_v1.spec.json', 'utf8'));
  assert.equal(spec.status, 'FROZEN_DEV_RETROSPECTIVE_OBSERVABILITY_ONLY');
  assert.equal(spec.interpretation_guard.causal_historical_prediction, false);
  assert.equal(spec.interpretation_guard.predictive_validity_claimed, false);
  assert.equal(spec.interpretation_guard.outcomes_read, false);
  assert.equal(spec.interpretation_guard.labels_read, false);
  assert.equal(spec.interpretation_guard.performance_metrics_allowed, false);
  assert.equal(spec.interpretation_guard.threshold_or_model_tuning_allowed, false);
  assert.equal(spec.interpretation_guard.v1_changes_from_scan_output_allowed, false);
  assert.equal(spec.explicit_exclusions.future_lockbox_access, false);
  assert.equal(spec.explicit_exclusions.pnl, false);
  assert.equal(spec.explicit_exclusions.win_loss, false);
  assert.equal(spec.explicit_exclusions.execution_engine, false);
  assert.equal(spec.explicit_exclusions.live_execution, false);
});

test('DEV retrospective observability source has no outcome, economic, execution or network coupling', async () => {
  const sources = [
    await fs.readFile('quant-core/replay/dev-retrospective-observability-v1.ts', 'utf8'),
    await fs.readFile('quant-core/cli/run-dev-retrospective-observability-v1.ts', 'utf8'),
  ].join('\n');
  for (const forbidden of [
    'generateLabelsV1', 'labelEnd', 'realizedPnl', 'profitFactor', 'drawdown',
    'runEconomic', 'economic-lockbox', 'execution-engine-v1r2', 'OrderSend',
    'submitOrder', 'sendOrder', 'WebSocket', 'fetch(', 'node:http', 'node:https',
    'node:net', 'browser.', 'page.click', '--lockbox',
  ]) {
    assert.equal(sources.includes(forbidden), false, `forbidden coupling: ${forbidden}`);
  }
});

test('DEV retrospective observability spec, implementation and source identities are frozen', async () => {
  for (const identity of Object.values(identities)) {
    const raw = await fs.readFile(identity.path);
    assert.equal(raw.length, identity.bytes, `${identity.path} bytes`);
    assert.equal(sha256(raw), identity.sha256, `${identity.path} sha256`);
  }
});
