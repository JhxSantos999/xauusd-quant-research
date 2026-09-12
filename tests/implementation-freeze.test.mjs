import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const expected = {
  'research-reference/logreg_v1.implementation.json': {
    bytes: 559,
    sha256: 'c6417700264c710e92a7dd1a888907b8aefafcd87f147805daea058cbe9b4483',
  },
  'research-reference/platt_v1.implementation.json': {
    bytes: 630,
    sha256: 'ec5035d8d5ada1fabe012859685de5bae4b415158524fa7209292cb355f2da30',
  },
};

for (const [path, identity] of Object.entries(expected)) {
  test(`implementation freeze identity is exact: ${path}`, () => {
    const raw = fs.readFileSync(path);
    assert.equal(raw.length, identity.bytes);
    assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), identity.sha256);
  });
}
