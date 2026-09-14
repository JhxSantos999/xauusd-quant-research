import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

import {
  SIGNAL_BRIDGE_V1_IMPLEMENTATION_IDENTITY,
  SIGNAL_BRIDGE_V1_SOURCE_IDENTITY,
  SIGNAL_BRIDGE_V1_SPEC_IDENTITY,
  SIGNAL_BRIDGE_V1_FROZEN_UPSTREAM,
} from '../dist/quant-core/research/signal-bridge-v1-contracts.js';

function sha256(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function assertIdentity(identity) {
  const raw = fs.readFileSync(identity.path);
  assert.equal(raw.length, identity.bytes);
  assert.equal(sha256(raw), identity.sha256);
}

test('Signal Bridge V1 spec, implementation binding and source identities are frozen', () => {
  assertIdentity(SIGNAL_BRIDGE_V1_SPEC_IDENTITY);
  assertIdentity(SIGNAL_BRIDGE_V1_IMPLEMENTATION_IDENTITY);
  assertIdentity(SIGNAL_BRIDGE_V1_SOURCE_IDENTITY);
});

test('Signal Bridge V1 spec is observe-only and explicitly excludes execution and lockbox behavior', () => {
  const spec = JSON.parse(fs.readFileSync(SIGNAL_BRIDGE_V1_SPEC_IDENTITY.path, 'utf8'));
  assert.equal(spec.version, 'signal_bridge_v1');
  assert.equal(spec.status, 'FROZEN_PRE_IMPLEMENTATION');
  assert.equal(spec.future_lockbox_accessed_at_freeze, false);
  assert.equal(spec.pnl_evaluated_at_freeze, false);
  assert.equal(spec.scope.mode, 'OBSERVE_ONLY');
  assert.equal(spec.scope.network_io, 'NONE');
  assert.equal(spec.scope.broker_order_submission, 'FORBIDDEN');
  assert.equal(spec.scope.browser_automation, 'FORBIDDEN');
  assert.equal(spec.scope.live_execution, 'FORBIDDEN');
  assert.equal(spec.scope.future_lockbox_input, 'FORBIDDEN');
  assert.equal(spec.upstream.execution_engine, 'NOT_INVOKED_BY_BRIDGE');
  assert.equal(spec.message_contract.timestamp_policy, 'NO_WALL_CLOCK_FIELD');
});

test('Signal Bridge V1 implementation binding preserves exact frozen upstream lineage', () => {
  const binding = JSON.parse(fs.readFileSync(SIGNAL_BRIDGE_V1_IMPLEMENTATION_IDENTITY.path, 'utf8'));
  assert.equal(binding.future_lockbox_accessed_at_binding, false);
  assert.equal(binding.pnl_evaluated_at_binding, false);
  assert.equal(binding.upstream.base_frozen_commit, SIGNAL_BRIDGE_V1_FROZEN_UPSTREAM.baseFrozenCommit);
  assert.equal(binding.upstream.risk_engine_v1_spec_sha256, SIGNAL_BRIDGE_V1_FROZEN_UPSTREAM.riskEngineV1SpecSha256);
  assert.equal(binding.upstream.risk_engine_v1_source_sha256, SIGNAL_BRIDGE_V1_FROZEN_UPSTREAM.riskEngineV1SourceSha256);
  assert.equal(binding.upstream.final_signal_execution_id, SIGNAL_BRIDGE_V1_FROZEN_UPSTREAM.finalSignalExecutionId);
  assert.equal(binding.upstream.final_signal_model_sha256, SIGNAL_BRIDGE_V1_FROZEN_UPSTREAM.finalSignalModelSha256);
  assert.equal(binding.upstream.final_signal_calibrator_sha256, SIGNAL_BRIDGE_V1_FROZEN_UPSTREAM.finalSignalCalibratorSha256);
  assert.equal(binding.behavior.mode, 'OBSERVE_ONLY');
  assert.equal(binding.behavior.order_submission, 'FORBIDDEN');
});
