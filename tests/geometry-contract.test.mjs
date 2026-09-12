import test from 'node:test';
import assert from 'node:assert/strict';
import { generateEndAlignedFolds } from '../dist/quant-core/walkforward/orchestrator.js';
import { DAY_MS, FROZEN_NESTED_GEOMETRY_V1 } from '../dist/quant-core/research/frozen-contracts.js';

const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const pair = (fold) => [iso(fold.start), iso(fold.end)];

const EXPECTED_OUTER = [
  ['2025-04-17T05:30:00Z', '2026-04-12T05:30:00Z'],
  ['2025-05-17T05:30:00Z', '2026-05-12T05:30:00Z'],
  ['2025-06-16T05:30:00Z', '2026-06-11T05:30:00Z'],
  ['2025-07-16T05:30:00Z', '2026-07-11T05:30:00Z'],
  ['2025-08-15T05:30:00Z', '2026-08-10T05:30:00Z'],
  ['2025-09-14T05:30:00Z', '2026-09-09T05:30:00Z'],
];

const EXPECTED_FINAL_DEV = [
  ['2025-04-17T05:30:00Z', '2025-12-13T05:30:00Z'],
  ['2025-05-17T05:30:00Z', '2026-01-12T05:30:00Z'],
  ['2025-06-16T05:30:00Z', '2026-02-11T05:30:00Z'],
  ['2025-07-16T05:30:00Z', '2026-03-13T05:30:00Z'],
  ['2025-08-15T05:30:00Z', '2026-04-12T05:30:00Z'],
  ['2025-09-14T05:30:00Z', '2026-05-12T05:30:00Z'],
  ['2025-10-14T05:30:00Z', '2026-06-11T05:30:00Z'],
  ['2025-11-13T05:30:00Z', '2026-07-11T05:30:00Z'],
  ['2025-12-13T05:30:00Z', '2026-08-10T05:30:00Z'],
  ['2026-01-12T05:30:00Z', '2026-09-09T05:30:00Z'],
];

function deriveOuter() {
  const g = FROZEN_NESTED_GEOMETRY_V1;
  const total = g.outer.trainDevMs + g.outer.calibrationMs + g.outer.oosMs;
  return generateEndAlignedFolds(g.domainEnd, total, g.outer.stepMs, g.outer.count);
}
function deriveInner(outer) {
  const g = FROZEN_NESTED_GEOMETRY_V1;
  const devEnd = outer.start + g.outer.trainDevMs;
  const total = g.inner.trainMs + g.inner.calibrationMs + g.inner.oosMs;
  return generateEndAlignedFolds(devEnd, total, g.inner.stepMs, g.inner.count);
}

test('all six frozen Outer full-span boundaries match the preregistered calendar exactly', () => {
  assert.deepEqual(deriveOuter().map(pair), EXPECTED_OUTER);
});

test('first and last Outer each derive the exact three frozen Inner full-span boundaries', () => {
  const outer = deriveOuter();
  assert.deepEqual(deriveInner(outer[0]).map(pair), [
    ['2025-04-17T05:30:00Z', '2025-12-13T05:30:00Z'],
    ['2025-05-17T05:30:00Z', '2026-01-12T05:30:00Z'],
    ['2025-06-16T05:30:00Z', '2026-02-11T05:30:00Z'],
  ]);
  assert.deepEqual(deriveInner(outer[5]).map(pair), [
    ['2025-09-14T05:30:00Z', '2026-05-12T05:30:00Z'],
    ['2025-10-14T05:30:00Z', '2026-06-11T05:30:00Z'],
    ['2025-11-13T05:30:00Z', '2026-07-11T05:30:00Z'],
  ]);
});

test('Outer and Inner OOS windows are non-overlapping and touch only at [start,end) boundaries', () => {
  const g = FROZEN_NESTED_GEOMETRY_V1;
  const outer = deriveOuter();
  const outerOos = outer.map((fold) => ({ start: fold.end - g.outer.oosMs, end: fold.end }));
  for (let i = 1; i < outerOos.length; i++) assert.equal(outerOos[i - 1].end, outerOos[i].start);
  for (const outerFold of outer) {
    const innerOos = deriveInner(outerFold).map((fold) => ({ start: fold.end - g.inner.oosMs, end: fold.end }));
    for (let i = 1; i < innerOos.length; i++) assert.equal(innerOos[i - 1].end, innerOos[i].start);
  }
});

test('all ten Final DEV full-span boundaries match the frozen 180/30/30 step-30 geometry', () => {
  const finalDev = generateEndAlignedFolds(FROZEN_NESTED_GEOMETRY_V1.domainEnd, 240 * DAY_MS, 30 * DAY_MS, 10);
  assert.deepEqual(finalDev.map(pair), EXPECTED_FINAL_DEV);
});
