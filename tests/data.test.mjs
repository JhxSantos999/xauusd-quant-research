import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCandles, enforceDatasetContract, M5_TIMEFRAME_MS } from '../dist/quant-core/data/contracts.js';
import { parseMt5TabCsv } from '../dist/quant-core/data/mt5-parser.js';
const CSV = '<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>\n' +
    '2025.04.07\t01:00:00\t100\t102\t99\t101\t10\t0\t20\n' +
    '2025.04.07\t01:05:00\t101\t103\t100\t102\t11\t0\t21\n';
test('MT5 tab parser reads canonical columns and UTC timestamps', () => {
    const candles = parseMt5TabCsv(CSV);
    assert.equal(candles.length, 2);
    assert.equal(candles[0].time, Date.parse('2025-04-07T01:00:00Z'));
    assert.equal(candles[1].close, 102);
    assert.equal(candles[0].tickVolume, 10);
});
test('candle audit detects clean geometry/order', () => {
    const candles = parseMt5TabCsv(CSV);
    const audit = auditCandles(candles);
    assert.equal(audit.duplicateTimestamps, 0);
    assert.equal(audit.nonIncreasingTimestamps, 0);
    assert.equal(audit.invalidGeometry, 0);
});
test('dataset contract blocks raw bars beyond maxCandleOpenTime', () => {
    const candles = parseMt5TabCsv(CSV);
    assert.throws(() => enforceDatasetContract(candles, {
        datasetId: 'TEST', datasetSha256: 'x', timeframeMs: M5_TIMEFRAME_MS,
        maxCandleOpenTime: candles[0].time, maxInformationTime: candles[0].time + M5_TIMEFRAME_MS,
    }), /LOCKBOX_BOUNDARY_VIOLATION/);
});
