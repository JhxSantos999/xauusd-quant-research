import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

function identity(path) {
  const bytes = fs.readFileSync(path);
  return {
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

test('Paper Monitor Adapter V1 spec, implementation binding and source identities are frozen', () => {
  assert.deepEqual(identity('adapters/paper/paper-monitor-adapter-v1.ts'), {
    bytes: 11006,
    sha256: '2f00ab549b1087db390bd1a08519e9230e002b6bd04fe623ee8aff537483b935',
  });
  assert.deepEqual(identity('adapters/paper/paper_monitor_adapter_v1.spec.json'), {
    bytes: 3424,
    sha256: 'ff40cb6d69589c53c81db33839593ef169a7542f1cd29af3abc4efe5d69e246d',
  });
  assert.deepEqual(identity('adapters/paper/paper_monitor_adapter_v1.implementation.json'), {
    bytes: 1172,
    sha256: '0abff3631f21fcddb9e7941841e22af102fa3ab3e505f42f09b8e678c3df1de6',
  });
});

test('Paper Monitor Adapter V1 implementation binding preserves the exact frozen Signal Bridge V1 checkpoint', () => {
  const binding = JSON.parse(fs.readFileSync('adapters/paper/paper_monitor_adapter_v1.implementation.json', 'utf8'));
  assert.equal(binding.version, 'paper_monitor_adapter_v1_implementation_binding');
  assert.equal(binding.created_before_paper_or_live_execution, true);
  assert.equal(binding.future_lockbox_accessed_at_freeze, false);
  assert.equal(binding.pnl_evaluated_at_freeze, false);
  assert.equal(binding.semantic_spec.bytes, 3424);
  assert.equal(binding.semantic_spec.sha256, 'ff40cb6d69589c53c81db33839593ef169a7542f1cd29af3abc4efe5d69e246d');
  assert.equal(binding.source_files['adapters/paper/paper-monitor-adapter-v1.ts'].bytes, 11006);
  assert.equal(binding.source_files['adapters/paper/paper-monitor-adapter-v1.ts'].sha256, '2f00ab549b1087db390bd1a08519e9230e002b6bd04fe623ee8aff537483b935');
  assert.equal(binding.upstream_signal_bridge_v1.frozen_commit, '14312a3675df3ae11d7f514909c7eafbe9ae7d32');
  assert.equal(binding.upstream_signal_bridge_v1.spec.sha256, '93320a196c8f43d604d8fbe4333f5ef761e47db41fac7e3b151598e98fa20027');
  assert.equal(binding.upstream_signal_bridge_v1.implementation.sha256, '109563d16ed7faa4610149c00086893d5b0cf18dff61b0e0947fe869913f2c57');
  assert.equal(binding.upstream_signal_bridge_v1.source.sha256, '5a9be8586679831610fd18e045d5efdf8f947ff12e2b95d3f66c77b95f961626');
  assert.deepEqual(binding.governance, {
    mode: 'PAPER_MONITOR_ONLY',
    broker_order_submission: false,
    execution_engine_invoked: false,
    paper_fill_simulation: false,
    paper_pnl: false,
    browser_automation: false,
    network_io_in_library: false,
    filesystem_io_in_library: false,
    future_lockbox_input: false,
  });
});

test('Paper Monitor Adapter V1 spec explicitly keeps trading, PnL and Future Lockbox outside scope', () => {
  const spec = JSON.parse(fs.readFileSync('adapters/paper/paper_monitor_adapter_v1.spec.json', 'utf8'));
  assert.equal(spec.status, 'FROZEN_PRE_IMPLEMENTATION');
  assert.equal(spec.scope.mode, 'PAPER_MONITOR_ONLY');
  assert.equal(spec.scope.broker_order_submission, 'FORBIDDEN');
  assert.equal(spec.scope.execution_engine_invocation, 'FORBIDDEN');
  assert.equal(spec.scope.browser_automation, 'FORBIDDEN');
  assert.equal(spec.scope.live_execution, 'FORBIDDEN');
  assert.equal(spec.scope.paper_fill_simulation, 'FORBIDDEN');
  assert.equal(spec.scope.paper_pnl, 'FORBIDDEN');
  assert.equal(spec.scope.future_lockbox_input, 'FORBIDDEN');
  assert.equal(spec.timing_governance.timing_telemetry_must_not_change_signal_or_risk_decision, true);
});
