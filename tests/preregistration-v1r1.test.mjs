import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  ACTIVE_PREREGISTRATION_VERSION_V1R1,
  LEGACY_PREREGISTRATION_IDENTITIES_V1,
  PREREGISTRATION_IDENTITIES_V1,
  PREREGISTRATION_IDENTITIES_V1R1,
} from '../dist/quant-core/research/frozen-contracts.js';

function sha256(raw) { return crypto.createHash('sha256').update(raw).digest('hex'); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}
function assertCanonicalIdentity(identity) {
  const raw = fs.readFileSync(identity.path);
  assert.equal(raw.length, identity.bytes, identity.path);
  assert.equal(sha256(raw), identity.sha256, identity.path);
  const parsed = JSON.parse(raw.toString('utf8'));
  assert.equal(JSON.stringify(stable(parsed)), raw.toString('utf8'), `${identity.path}: canonical serialization mismatch`);
  return parsed;
}

test('V1R1 is the active canonical preregistration while original V1 identities remain preserved as legacy only', () => {
  assert.equal(ACTIVE_PREREGISTRATION_VERSION_V1R1, 'V1R1');
  assert.deepEqual(PREREGISTRATION_IDENTITIES_V1, PREREGISTRATION_IDENTITIES_V1R1);
  assert.notEqual(PREREGISTRATION_IDENTITIES_V1R1.manifest.path, LEGACY_PREREGISTRATION_IDENTITIES_V1.manifest.path);
  assert.notEqual(PREREGISTRATION_IDENTITIES_V1R1.manifest.sha256, LEGACY_PREREGISTRATION_IDENTITIES_V1.manifest.sha256);
});

test('all four V1R1 canonical files match their exact byte lengths and SHA-256 identities', () => {
  for (const identity of Object.values(PREREGISTRATION_IDENTITIES_V1R1)) assertCanonicalIdentity(identity);
});

test('V1R1 manifest cryptographically binds dataset and the three canonical rule specs', () => {
  const manifest = assertCanonicalIdentity(PREREGISTRATION_IDENTITIES_V1R1.manifest);
  assert.equal(manifest.preregistration_version, 'V1R1');
  assert.equal(manifest.semantic_protocol, 'V1');
  assert.equal(manifest.created_before_full_nested_xauusd_model_fit, true);
  assert.equal(manifest.relationship_to_v1, 'reconstructed_canonical_identity_for_preexisting_frozen_v1_semantics');
  assert.equal(manifest.dataset_sha256, 'a34f2d5469782fccd1e8479ceea5c81b633aa5301b7ed47447049323850de8f5');
  assert.equal(manifest.label_selection_rule_hash, PREREGISTRATION_IDENTITIES_V1R1.selection.sha256);
  assert.equal(manifest.walkforward_geometry_hash, PREREGISTRATION_IDENTITIES_V1R1.geometry.sha256);
  assert.equal(manifest.nested_validation_hash, PREREGISTRATION_IDENTITIES_V1R1.nested.sha256);
  assert.deepEqual(manifest.canonical_specs['label_selection_v1r1.spec.json'], { byte_length: PREREGISTRATION_IDENTITIES_V1R1.selection.bytes, sha256: PREREGISTRATION_IDENTITIES_V1R1.selection.sha256 });
  assert.deepEqual(manifest.canonical_specs['walkforward_geometry_v1r1.spec.json'], { byte_length: PREREGISTRATION_IDENTITIES_V1R1.geometry.bytes, sha256: PREREGISTRATION_IDENTITIES_V1R1.geometry.sha256 });
  assert.deepEqual(manifest.canonical_specs['nested_validation_v1r1.spec.json'], { byte_length: PREREGISTRATION_IDENTITIES_V1R1.nested.bytes, sha256: PREREGISTRATION_IDENTITIES_V1R1.nested.sha256 });
});
