export const DAY_MS = 86_400_000;
export const DEV_DATASET_ID_V1 = 'XAUUSD_M5_DEV_V1' as const;
export const DEV_DATASET_SHA256_V1 = 'a34f2d5469782fccd1e8479ceea5c81b633aa5301b7ed47447049323850de8f5' as const;
export const DEV_DATASET_BYTES_V1 = 6_285_976;
export const DEV_DATASET_CANDLES_V1 = 101_108;
export const DEV_FIRST_BAR_OPEN_TIME_V1 = Date.parse('2025-04-07T01:00:00Z');
export const DEV_MAX_BAR_OPEN_TIME_V1 = Date.parse('2026-09-09T05:25:00Z');
export const FROZEN_H_GRID_V1 = [3, 6, 12, 24] as const;
export const FROZEN_TAU_GRID_V1 = [0, 0.0002, 0.0004, 0.0008] as const;
export const EMBARGO_MS_V1 = DAY_MS;
export const DEV_INFORMATION_END_V1 = Date.parse('2026-09-09T05:30:00Z');
export const ACTIVE_PREREGISTRATION_VERSION_V1R1 = 'V1R1' as const;

export interface NestedGeometryV1 {
  readonly domainEnd: number;
  readonly embargoMs: number;
  readonly outer: {
    readonly trainDevMs: number;
    readonly calibrationMs: number;
    readonly oosMs: number;
    readonly stepMs: number;
    readonly count: number;
  };
  readonly inner: {
    readonly trainMs: number;
    readonly calibrationMs: number;
    readonly oosMs: number;
    readonly stepMs: number;
    readonly count: number;
  };
}

export function assertNonOverlappingOosGeometryV1(geometry: NestedGeometryV1): void {
  if (!Number.isFinite(geometry.domainEnd) || !Number.isFinite(geometry.embargoMs) || geometry.embargoMs < 0) throw new Error('INVALID_GEOMETRY_BOUNDARY');
  const blocks = [geometry.outer, geometry.inner] as const;
  for (const block of blocks) {
    if (![block.calibrationMs, block.oosMs, block.stepMs].every((value) => Number.isFinite(value) && value > 0)) throw new Error('INVALID_GEOMETRY_DURATION');
    if (!Number.isInteger(block.count) || block.count <= 0) throw new Error('INVALID_GEOMETRY_COUNT');
  }
  if (!Number.isFinite(geometry.outer.trainDevMs) || geometry.outer.trainDevMs <= 0) throw new Error('INVALID_OUTER_DEVELOPMENT_DURATION');
  if (!Number.isFinite(geometry.inner.trainMs) || geometry.inner.trainMs <= 0) throw new Error('INVALID_INNER_TRAIN_DURATION');
  if (geometry.outer.stepMs < geometry.outer.oosMs) throw new Error('OUTER_OOS_OVERLAP_NOT_ALLOWED');
  if (geometry.inner.stepMs < geometry.inner.oosMs) throw new Error('INNER_OOS_OVERLAP_NOT_ALLOWED');
}

export const FROZEN_NESTED_GEOMETRY_V1: NestedGeometryV1 = {
  domainEnd: DEV_INFORMATION_END_V1,
  embargoMs: EMBARGO_MS_V1,
  outer: {
    trainDevMs: 300 * DAY_MS,
    calibrationMs: 30 * DAY_MS,
    oosMs: 30 * DAY_MS,
    stepMs: 30 * DAY_MS,
    count: 6,
  },
  inner: {
    trainMs: 180 * DAY_MS,
    calibrationMs: 30 * DAY_MS,
    oosMs: 30 * DAY_MS,
    stepMs: 30 * DAY_MS,
    count: 3,
  },
};

assertNonOverlappingOosGeometryV1(FROZEN_NESTED_GEOMETRY_V1);

export const LEGACY_PREREGISTRATION_IDENTITIES_V1 = {
  selection: { path: 'quant-core/selection/label_selection_v1.spec.json', bytes: 2068, sha256: 'a5d19b25723d2576b53c6aac20ca4d8c34df3446af9bed0e418026fea405a966' },
  geometry: { path: 'quant-core/research/walkforward_geometry_v1.spec.json', bytes: 1203, sha256: 'da97bfb9be52a5ac68f94fc7c19b897502eeeef737db864a745fcdcec95734cc' },
  nested: { path: 'quant-core/research/nested_validation_v1.spec.json', bytes: 1068, sha256: 'ac844eb750d2f67d12bcf70cb276fbab411c4e6395eac3b53415feb7ecbbf836' },
  manifest: { path: 'quant-core/research/research_preregistration_manifest.json', bytes: 851, sha256: '791d89013224ae0e3a9296058e53f54b732e20bffdf5fe746c81e283f06a70e0' },
} as const;

export const PREREGISTRATION_IDENTITIES_V1R1 = {
  selection: { path: 'quant-core/selection/label_selection_v1r1.spec.json', bytes: 2015, sha256: '07cbc1cbbf774321368269bd4d8d58325c0b2adb78a8ba8cbb9bd05cc658e83f' },
  geometry: { path: 'quant-core/research/walkforward_geometry_v1r1.spec.json', bytes: 1680, sha256: '4371d1e60888aafcd77be2dca2ca33d70e8fc4e985433bff4a0d57155911b7b2' },
  nested: { path: 'quant-core/research/nested_validation_v1r1.spec.json', bytes: 1630, sha256: '13e55e8f18d26005322ec079a03996dae02ec46d7e0d5dd8fc4a8e94418c07d1' },
  manifest: { path: 'quant-core/research/research_preregistration_manifest_v1r1.json', bytes: 2196, sha256: '1cacf7759512560ad6068980e0ea44d19aa9018a3aa1c34ba08cf22d0fe399a0' },
} as const;

// Compatibility alias: the mathematical engine remains semantic V1, while the active canonical preregistration identity is V1R1.
export const PREREGISTRATION_IDENTITIES_V1 = PREREGISTRATION_IDENTITIES_V1R1;

export const IMPLEMENTATION_FREEZE_IDENTITIES_V1 = {
  logreg: { path: 'research-reference/logreg_v1.implementation.json', bytes: 559, sha256: 'c6417700264c710e92a7dd1a888907b8aefafcd87f147805daea058cbe9b4483' },
  platt: { path: 'research-reference/platt_v1.implementation.json', bytes: 630, sha256: 'ec5035d8d5ada1fabe012859685de5bae4b415158524fa7209292cb355f2da30' },
} as const;
