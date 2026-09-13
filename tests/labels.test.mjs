import test from 'node:test';
import assert from 'node:assert/strict';
import { M5_TIMEFRAME_MS } from '../dist/quant-core/data/contracts.js';
import { generateLabelsV1, summarizeLabelCoverageV1 } from '../dist/quant-core/ml/labeling.js';
function make(closes, times) {
    const start = Date.parse('2025-01-01T00:00:00Z');
    return closes.map((close, i) => ({
        time: times?.[i] ?? start + i * M5_TIMEFRAME_MS,
        open: close, high: close + 1, low: close - 1, close,
    }));
}
test('tau zero maps positive/negative returns and exact zero to neutral', () => {
    const up = generateLabelsV1(make([100, 101]), 1, 0)[0];
    const down = generateLabelsV1(make([100, 99]), 1, 0)[0];
    const flat = generateLabelsV1(make([100, 100]), 1, 0)[0];
    assert.equal(up.label, 1);
    assert.equal(down.label, 0);
    assert.equal(flat.status, 'NEUTRAL');
});
test('tau band is strict outside and inclusive neutral inside', () => {
    const atTau = generateLabelsV1(make([100, 100.02]), 1, 0.0002)[0];
    const above = generateLabelsV1(make([100, 100.03]), 1, 0.0002)[0];
    assert.equal(atTau.status, 'NEUTRAL');
    assert.equal(above.label, 1);
});
test('gap rule rejects strictly greater than timeframe but accepts exactly one timeframe', () => {
    const start = Date.parse('2025-01-01T00:00:00Z');
    const exact = generateLabelsV1(make([100, 101], [start, start + M5_TIMEFRAME_MS]), 1, 0)[0];
    const gap = generateLabelsV1(make([100, 101], [start, start + M5_TIMEFRAME_MS + 1]), 1, 0)[0];
    assert.equal(exact.status, 'VALID');
    assert.equal(gap.status, 'INVALID_GAP');
});
test('decision and target information availability timestamps follow V1 semantics', () => {
    const samples = generateLabelsV1(make([100, 101, 102]), 2, 0);
    const s = samples[0];
    assert.equal(s.decisionTime, s.decisionBarOpenTime + M5_TIMEFRAME_MS);
    assert.equal(s.labelStart, s.decisionTime);
    assert.equal(s.labelEnd, s.targetBarOpenTime + M5_TIMEFRAME_MS);
    assert.equal(s.timestamp, s.decisionTime);
});
test('coverage counts valid neutral invalid gap independently', () => {
    const start = Date.parse('2025-01-01T00:00:00Z');
    const data = make([100, 101, 101, 102], [start, start + M5_TIMEFRAME_MS, start + 2 * M5_TIMEFRAME_MS, start + 4 * M5_TIMEFRAME_MS]);
    const coverage = summarizeLabelCoverageV1(generateLabelsV1(data, 1, 0));
    assert.equal(coverage.totalCandidates, 3);
    assert.equal(coverage.valid, 1);
    assert.equal(coverage.neutral, 1);
    assert.equal(coverage.invalidGap, 1);
});
