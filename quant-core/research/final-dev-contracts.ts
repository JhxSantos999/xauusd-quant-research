import { DAY_MS, DEV_INFORMATION_END_V1 } from './frozen-contracts.js';
import type { FinalDevGeometryV1 } from '../engine/final-dev-selection.js';

export const FROZEN_FINAL_DEV_GEOMETRY_V1: FinalDevGeometryV1 = {
  domainEnd: DEV_INFORMATION_END_V1,
  embargoMs: DAY_MS,
  trainMs: 180 * DAY_MS,
  calibrationMs: 30 * DAY_MS,
  oosMs: 30 * DAY_MS,
  stepMs: 30 * DAY_MS,
  count: 10,
};

export const FINAL_DEV_IMPLEMENTATION_BINDING_V1R1 = {
  path: 'quant-core/research/final_dev_selection_v1r1.implementation.json',
  bytes: 1251,
  sha256: 'e08dac1b79fd2fa26f266a27efc645cdbd25ce8c0f1a8419920a8332efc82f67',
} as const;

export const AUDITED_NESTED_EXECUTION_V1R1 = {
  executionId: 'exec_v1_20260913194912754',
  sourceCommit: 'a5dd45240be0eca140b9ab171a439877c8fae96b',
  artifactManifestSemanticSha256: 'b3a7da02fa3df2b3ce689e43cada64fda6f112f47a19bbba361b7ff007d03d55',
  files: {
    artifactManifest: {
      path: 'empirical_execution_artifact_manifest.json',
      bytes: 2864,
      sha256: 'c7c7172fe3e34cacc61383ed253eada442e5d7fe41bd30e1887055c80896ea02',
    },
    nestedValidation: {
      path: 'nested_validation_evidence.json',
      bytes: 1529,
      sha256: '7c6f81cbf3f6d5897cb89da80acb7e6ca14bf4d79608ff7a0039b6a5c0b87431',
    },
    provenance: {
      path: 'execution_provenance.json',
      bytes: 1905,
      sha256: '96bfd67a3841c954f6ccf65a750a1d13e612548c11841bda7f777beef86f60a9',
    },
    lineage: {
      path: 'experiment_lineage.json',
      bytes: 1014,
      sha256: '3d70c86144c1d3cf96554a6db04e094e01bd435e5a69a174e14d2d4bd0104d0a',
    },
    innerSelection: {
      path: 'inner_selection_evidence.json',
      bytes: 43107,
      sha256: '06ea8fcb1e3e971cdd1b2dbe729c5efc3eb86ca01a4accc25b33c8b3484ab650',
    },
    outerOosMetrics: {
      path: 'outer_oos_metrics.json',
      bytes: 3926,
      sha256: 'c3b0c36d929392ef4cb0368b5e962683d5a4f5de35595eb8d6d9f536e2bb23ff',
    },
    outerOosPredictions: {
      path: 'outer_oos_predictions.json',
      bytes: 9951243,
      sha256: 'f16aec44586078f647cabb189928c03c573884b06e6d05199db7efb10d89280c',
    },
  },
} as const;

export function assertFrozenFinalDevGeometryV1(): void {
  const geometry = FROZEN_FINAL_DEV_GEOMETRY_V1;
  if (geometry.count !== 10) throw new Error('FINAL_DEV_EXPECTED_FOLD_COUNT_CHANGED');
  if (geometry.trainMs !== 180 * DAY_MS || geometry.calibrationMs !== 30 * DAY_MS || geometry.oosMs !== 30 * DAY_MS || geometry.stepMs !== 30 * DAY_MS) throw new Error('FINAL_DEV_DURATION_CHANGED');
  if (geometry.domainEnd !== DEV_INFORMATION_END_V1) throw new Error('FINAL_DEV_DOMAIN_END_CHANGED');
  if (geometry.stepMs < geometry.oosMs) throw new Error('FINAL_DEV_OOS_OVERLAP_NOT_ALLOWED');
}

assertFrozenFinalDevGeometryV1();
