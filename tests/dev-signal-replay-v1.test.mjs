import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

import {
  DEV_SIGNAL_REPLAY_V1_DECISION_TIME,
  DEV_SIGNAL_REPLAY_V1_MODE,
  DEV_SIGNAL_REPLAY_V1_PAPER_EQUITY_QUOTE,
  DEV_SIGNAL_REPLAY_V1_VERSION,
  frozenReplayLineageV1,
  inferSignalObjectFromFeatureV1,
} from '../dist/quant-core/replay/dev-signal-replay-v1.js';

const identities = {
  core: {
    path: 'quant-core/replay/dev-signal-replay-v1.ts',
    bytes: 5579,
    sha256: 'c862b10b46c78a518bed97c3e06896cb06d0487c2f51d48fa2be799b232ca42a',
  },
  cli: {
    path: 'quant-core/cli/run-dev-signal-replay-v1.ts',
    bytes: 7519,
    sha256: '9613d8d9d2d77a3f743f9ffd0fb2b6cd83158eb2638582c19c58f8f77d4e5855',
  },
  spec: {
    path: 'quant-core/research/dev_signal_replay_v1.spec.json',
    bytes: 2596,
    sha256: '3258dcd24c821b9109bbc654b393707f30e8099c5ca94d9d6a0b93e3970eb0ba',
  },
  implementation: {
    path: 'quant-core/research/dev_signal_replay_v1.implementation.json',
    bytes: 1838,
    sha256: 'fcd785764c129c34933b06c55b6c3bf44b2c793d976fe2c6ba0316daf2f25e85',
  },
};

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

test('DEV Signal Replay V1 constants preserve exact DEV-only observability scope', () => {
  assert.equal(DEV_SIGNAL_REPLAY_V1_VERSION, 'dev_signal_replay_v1');
  assert.equal(DEV_SIGNAL_REPLAY_V1_MODE, 'DEV_REPLAY_ONLY');
  assert.equal(DEV_SIGNAL_REPLAY_V1_PAPER_EQUITY_QUOTE, 10000);
  assert.equal(DEV_SIGNAL_REPLAY_V1_DECISION_TIME, Date.parse('2026-09-09T05:30:00Z'));
  const lineage = frozenReplayLineageV1();
  assert.equal(lineage.finalSignalExecutionId, 'final_signal_v1r1_20260913235306128');
  assert.equal(lineage.finalSignalModelSha256, 'f4869afd3cfeb681bca356ee08d80a63fb617a841427932a571ff2e2306f7655');
  assert.equal(lineage.finalSignalCalibratorSha256, '6d851a2eaa61deaa00bc2bc7899ad40fabc5b8758cd58ed933782709996ac17c');
});

test('DEV Signal Replay inference is deterministic and rejects any decision beyond DEV information end', () => {
  const feature = {
    barIndex: 24,
    decisionBarOpenTime: DEV_SIGNAL_REPLAY_V1_DECISION_TIME - 300000,
    decisionTime: DEV_SIGNAL_REPLAY_V1_DECISION_TIME,
    vector: [0.001, 0.002, 0.003, 0.004, 0.005, 0.006, 0.007, 0.008, 0.1, 0.002],
  };
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
  const a = inferSignalObjectFromFeatureV1(feature, 3500, model, calibrator);
  const b = inferSignalObjectFromFeatureV1(feature, 3500, model, calibrator);
  assert.deepEqual(a, b);
  assert.equal(a.asset, 'XAUUSD');
  assert.equal(a.timeframe, 'M5');
  assert.equal(a.decisionTime, DEV_SIGNAL_REPLAY_V1_DECISION_TIME);
  assert.equal(a.decisionClose, 3500);
  assert.equal(a.atrSma12OverClose, 0.002);
  assert.equal(Number.isFinite(a.rawProbability), true);
  assert.equal(Number.isFinite(a.calibratedProbability), true);

  const future = { ...feature, decisionTime: DEV_SIGNAL_REPLAY_V1_DECISION_TIME + 1 };
  assert.throws(
    () => inferSignalObjectFromFeatureV1(future, 3500, model, calibrator),
    /FUTURE_INFORMATION_FORBIDDEN/,
  );
});

test('DEV Signal Replay V1 spec explicitly blocks post-DEV data, lockbox, PnL and execution', async () => {
  const spec = JSON.parse(await fs.readFile('quant-core/research/dev_signal_replay_v1.spec.json', 'utf8'));
  assert.equal(spec.status, 'FROZEN_DEV_REPLAY_OBSERVABILITY_ONLY');
  assert.equal(spec.mode, 'DEV_REPLAY_ONLY');
  assert.equal(spec.dataset_contract.post_dev_data_allowed, false);
  assert.equal(spec.dataset_contract.future_lockbox_data_allowed, false);
  assert.equal(spec.final_signal_binding.model_refit, false);
  assert.equal(spec.final_signal_binding.calibrator_refit, false);
  assert.equal(spec.determinism.wall_clock_used, false);
  assert.equal(spec.explicit_exclusions.future_lockbox_access, false);
  assert.equal(spec.explicit_exclusions.post_dev_market_data, false);
  assert.equal(spec.explicit_exclusions.labels_or_target_outcomes, false);
  assert.equal(spec.explicit_exclusions.pnl, false);
  assert.equal(spec.explicit_exclusions.paper_fill_simulation, false);
  assert.equal(spec.explicit_exclusions.execution_engine, false);
  assert.equal(spec.explicit_exclusions.broker_connection, false);
  assert.equal(spec.explicit_exclusions.order_submission, false);
  assert.equal(spec.explicit_exclusions.network_transport, false);
  assert.equal(spec.explicit_exclusions.live_execution, false);
});

test('DEV Signal Replay V1 source contains no lockbox, broker, execution or network input coupling', async () => {
  const sources = [
    await fs.readFile('quant-core/replay/dev-signal-replay-v1.ts', 'utf8'),
    await fs.readFile('quant-core/cli/run-dev-signal-replay-v1.ts', 'utf8'),
  ].join('\n');
  for (const forbidden of [
    'runEconomic', 'economic-lockbox', 'OrderSend', 'submitOrder', 'sendOrder',
    'WebSocket', 'fetch(', 'node:http', 'node:https', 'node:net', 'browser.', 'page.click',
    '--lockbox', 'LOCKBOX_DATASET', 'realizedPnl', 'profitFactor',
  ]) {
    assert.equal(sources.includes(forbidden), false, `forbidden coupling: ${forbidden}`);
  }
});

test('DEV Signal Replay V1 spec, implementation binding and source identities are frozen', async () => {
  for (const identity of Object.values(identities)) {
    const raw = await fs.readFile(identity.path);
    assert.equal(raw.length, identity.bytes, `${identity.path} bytes`);
    assert.equal(sha256(raw), identity.sha256, `${identity.path} sha256`);
  }
});
