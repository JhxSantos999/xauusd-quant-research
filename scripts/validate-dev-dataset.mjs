import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { parseMt5TabCsv } from '../dist/quant-core/data/mt5-parser.js';
import { auditCandles } from '../dist/quant-core/data/contracts.js';
import { generateLabelsV1, summarizeLabelCoverageV1 } from '../dist/quant-core/ml/labeling.js';

const datasetPath = process.argv[2];
if (!datasetPath) {
  console.error('Usage: npm run validate:dev -- <path-to-XAUUSD-M5-CSV>');
  process.exit(2);
}

const reference = JSON.parse(fs.readFileSync(new URL('../research-reference/xauusd-m5-dev-v1.json', import.meta.url), 'utf8'));
const raw = fs.readFileSync(datasetPath);
const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
assert.equal(raw.length, reference.byteLength, 'dataset byte length mismatch');
assert.equal(sha256, reference.sha256, 'dataset SHA-256 mismatch');

const candles = parseMt5TabCsv(raw.toString('utf8'));
const audit = auditCandles(candles);
assert.equal(audit.candles, reference.candles, 'candle count mismatch');
assert.equal(new Date(audit.firstBarOpenTime).toISOString(), new Date(reference.firstBarOpenTime).toISOString(), 'first bar mismatch');
assert.equal(new Date(audit.lastBarOpenTime).toISOString(), new Date(reference.lastBarOpenTime).toISOString(), 'last bar mismatch');
assert.equal(audit.duplicateTimestamps, 0, 'duplicate timestamps found');
assert.equal(audit.nonIncreasingTimestamps, 0, 'non-increasing timestamps found');
assert.equal(audit.invalidGeometry, 0, 'invalid OHLC geometry found');
assert.equal(audit.nonFiniteValues, 0, 'non-finite OHLC values found');

for (const expected of reference.labelCoverage) {
  const coverage = summarizeLabelCoverageV1(generateLabelsV1(candles, expected.h, expected.tau));
  const actual = {
    h: expected.h,
    tau: expected.tau,
    totalCandidates: coverage.totalCandidates,
    valid: coverage.valid,
    neutral: coverage.neutral,
    invalidGap: coverage.invalidGap,
    class1: coverage.class1,
    class0: coverage.class0,
  };
  assert.deepEqual(actual, expected, `label coverage mismatch h=${expected.h} tau=${expected.tau}`);
}

console.log(JSON.stringify({
  status: 'DEV_DATASET_REPRODUCIBILITY_GATE_PASS',
  datasetId: reference.datasetId,
  sha256,
  byteLength: raw.length,
  candles: audit.candles,
  labelConfigsVerified: reference.labelCoverage.length,
}, null, 2));
