import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEmbargo,
  applyPurge,
  generateEndAlignedFolds,
  inWindow,
  isolatePrecedingPartition,
} from '../dist/quant-core/walkforward/orchestrator.js';

const DAY = 86_400_000;

test('[start,end) decision-time semantics are exact', () => {
  const w = { start: 100, end: 200 };
  assert.equal(inWindow(100, w), true);
  assert.equal(inWindow(199, w), true);
  assert.equal(inWindow(200, w), false);
});

test('purge removes labelEnd equal to or after the next boundary', () => {
  const samples = [
    { decisionTime: 1, labelEnd: 99 },
    { decisionTime: 2, labelEnd: 100 },
    { decisionTime: 3, labelEnd: 101 },
  ];
  assert.deepEqual(applyPurge(samples, 100).map((s) => s.labelEnd), [99]);
});

test('embargo keeps labelEnd <= boundary - embargo and removes later information', () => {
  const boundary = 10 * DAY;
  const samples = [
    { decisionTime: 1, labelEnd: 9 * DAY },
    { decisionTime: 2, labelEnd: 9 * DAY + 1 },
  ];
  assert.deepEqual(applyEmbargo(samples, boundary, DAY).map((s) => s.labelEnd), [9 * DAY]);
});

test('purge and embargo counts remain separate', () => {
  const boundary = 10 * DAY;
  const samples = [
    { decisionTime: 1, labelEnd: 8 * DAY },
    { decisionTime: 2, labelEnd: 9 * DAY },
    { decisionTime: 3, labelEnd: 9 * DAY + 1 },
    { decisionTime: 4, labelEnd: 10 * DAY },
  ];
  const result = isolatePrecedingPartition(samples, boundary, DAY);
  assert.deepEqual(result.counts, { beforeIsolation: 4, afterPurge: 3, afterEmbargo: 2 });
});

test('frozen outer geometry derives six end-aligned 360d folds without a hardcoded first start', () => {
  const end = Date.parse('2026-09-09T05:30:00Z');
  const folds = generateEndAlignedFolds(end, 360 * DAY, 30 * DAY, 6);
  assert.equal(folds.length, 6);
  assert.equal(new Date(folds[0].start).toISOString(), '2025-04-17T05:30:00.000Z');
  assert.equal(new Date(folds[5].end).toISOString(), '2026-09-09T05:30:00.000Z');
});

test('frozen Final DEV geometry derives ten end-aligned 240d folds', () => {
  const end = Date.parse('2026-09-09T05:30:00Z');
  const folds = generateEndAlignedFolds(end, 240 * DAY, 30 * DAY, 10);
  assert.equal(folds.length, 10);
  assert.equal(new Date(folds[0].start).toISOString(), '2025-04-17T05:30:00.000Z');
  assert.equal(new Date(folds[9].start).toISOString(), '2026-01-12T05:30:00.000Z');
});
