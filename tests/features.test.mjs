import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_WARMUP, M5_TIMEFRAME_MS } from '../dist/quant-core/data/contracts.js';
import { extractFeatureRowsV1, FEATURE_SCHEMA_V1 } from '../dist/quant-core/features/extractor.js';
function candles(count) {
    const start = Date.parse('2025-01-01T00:00:00Z');
    return Array.from({ length: count }, (_, i) => {
        const close = 100 + i * 0.5;
        return { time: start + i * M5_TIMEFRAME_MS, open: close - 0.1, high: close + 0.4, low: close - 0.5, close };
    });
}
test('feature schema V1 has exactly ten frozen features', () => {
    assert.equal(FEATURE_SCHEMA_V1.length, 10);
});
test('first feature row is ordinal index 24 and uses decision time after close', () => {
    const rows = extractFeatureRowsV1(candles(30));
    assert.equal(rows[0].barIndex, FEATURE_WARMUP);
    assert.equal(rows[0].decisionTime, rows[0].decisionBarOpenTime + M5_TIMEFRAME_MS);
    assert.equal(rows[0].vector.length, 10);
    assert.ok(rows[0].vector.every(Number.isFinite));
});
test('features continue across observed bars despite civil gaps', () => {
    const data = candles(30);
    const original = data[20];
    for (let i = 20; i < data.length; i++) {
        data[i] = { ...data[i], time: data[i].time + 60 * 60 * 1000 };
    }
    const rows = extractFeatureRowsV1(data);
    assert.equal(rows[0].barIndex, 24);
    assert.ok(rows[0].vector.every(Number.isFinite));
    assert.notEqual(original.time, data[20].time);
});
test('constant adjacent returns produce zscore zero when sample std is exactly zero', () => {
    const start = Date.parse('2025-01-01T00:00:00Z');
    const data = Array.from({ length: 30 }, (_, i) => ({
        time: start + i * M5_TIMEFRAME_MS, open: 100, high: 101, low: 99, close: 100,
    }));
    const row = extractFeatureRowsV1(data)[0];
    assert.equal(row.vector[8], 0);
});
