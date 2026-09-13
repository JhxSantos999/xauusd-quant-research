export interface FoldWindow {
  readonly start: number;
  readonly end: number;
}

export interface LabelEndSample {
  readonly decisionTime: number;
  readonly labelEnd: number;
}

export interface IsolationCounts {
  readonly beforeIsolation: number;
  readonly afterPurge: number;
  readonly afterEmbargo: number;
}

export function generateEndAlignedFolds(
  domainEnd: number,
  totalDurationMs: number,
  stepMs: number,
  count: number,
): FoldWindow[] {
  if (![domainEnd, totalDurationMs, stepMs].every(Number.isFinite)) throw new Error('INVALID_FOLD_ARGUMENT');
  if (!(totalDurationMs > 0) || !(stepMs > 0) || !Number.isInteger(count) || count <= 0) throw new Error('INVALID_FOLD_ARGUMENT');
  const folds: FoldWindow[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    const end = domainEnd - offset * stepMs;
    folds.push({ start: end - totalDurationMs, end });
  }
  return folds;
}

export function inWindow(decisionTime: number, window: FoldWindow): boolean {
  return decisionTime >= window.start && decisionTime < window.end;
}

export function sliceByDecisionTime<T extends { readonly decisionTime: number }>(
  samples: readonly T[],
  window: FoldWindow,
): T[] {
  return samples.filter((sample) => inWindow(sample.decisionTime, window));
}

export function applyPurge<T extends LabelEndSample>(samples: readonly T[], nextWindowStart: number): T[] {
  if (!Number.isFinite(nextWindowStart)) throw new Error('INVALID_PURGE_BOUNDARY');
  return samples.filter((sample) => sample.labelEnd < nextWindowStart);
}

export function applyEmbargo<T extends LabelEndSample>(
  samplesAfterPurge: readonly T[],
  boundary: number,
  embargoMs: number,
): T[] {
  if (!Number.isFinite(boundary) || !Number.isFinite(embargoMs) || embargoMs < 0) throw new Error('INVALID_EMBARGO_ARGUMENT');
  const cutoff = boundary - embargoMs;
  return samplesAfterPurge.filter((sample) => sample.labelEnd <= cutoff);
}

export function isolatePrecedingPartition<T extends LabelEndSample>(
  samples: readonly T[],
  nextWindowStart: number,
  embargoMs: number,
): { readonly samples: T[]; readonly counts: IsolationCounts } {
  const purged = applyPurge(samples, nextWindowStart);
  const embargoed = applyEmbargo(purged, nextWindowStart, embargoMs);
  return {
    samples: embargoed,
    counts: {
      beforeIsolation: samples.length,
      afterPurge: purged.length,
      afterEmbargo: embargoed.length,
    },
  };
}
