import { DAY_MS, DEV_INFORMATION_END_V1 } from './frozen-contracts.js';

export interface FinalSignalFitGeometryV1R1 {
  readonly domainEnd: number;
  readonly embargoMs: number;
  readonly trainMs: number;
  readonly calibrationMs: number;
  readonly h: number;
  readonly tau: number;
}

export const FROZEN_FINAL_SIGNAL_FIT_V1R1: FinalSignalFitGeometryV1R1 = {
  domainEnd: DEV_INFORMATION_END_V1,
  embargoMs: DAY_MS,
  trainMs: 180 * DAY_MS,
  calibrationMs: 30 * DAY_MS,
  h: 3,
  tau: 0,
};

export const FINAL_SIGNAL_IMPLEMENTATION_BINDING_V1R1 = {
  path: 'quant-core/research/final_signal_model_v1r1.implementation.json',
  bytes: 1314,
  sha256: 'f5bf2acd6796c376a54a18a5b77d597dd2d6823c3053bd39c4c26d924b1c4b6a',
} as const;

export const AUDITED_FINAL_DEV_EXECUTION_V1R1 = {
  executionId: 'final_dev_v1r1_20260913201852646',
  sourceCommit: 'a7d4b1111047f4c1123e48d776ade4c7ea3a441f',
  artifactManifestSemanticSha256: '74a586a33366cd6f2f0ba7b90f63bb36e5b79344b28595aa2abfc2bac7f9705d',
  selected: { h: 3, tau: 0 },
  files: {
    artifactManifest: {
      path: 'final_dev_artifact_manifest.json',
      bytes: 2829,
      sha256: '9288be8d26fcc54b91bdbff210b531bbf65a5365b119f3c5488781fdd6e0be48',
    },
    selectionEvidence: {
      path: 'final_dev_selection_evidence.json',
      bytes: 6667,
      sha256: '6908037201942b6e2b0e11e256ef130cb0aa3f98e033a9def39a7fadf2f4cf86',
    },
    provenance: {
      path: 'execution_provenance.json',
      bytes: 3643,
      sha256: '695f7f5f2a368d113a971ab36f24928d8c4f2e2869a91949beb1946817e50b26',
    },
    lineage: {
      path: 'experiment_lineage.json',
      bytes: 1155,
      sha256: '7a94415c92045119911512ef9a7322eb5874bff3d462bdd9e7bea9048bd7ea1f',
    },
    foldGeometry: {
      path: 'final_dev_fold_geometry.json',
      bytes: 3583,
      sha256: '421012b9c8cba304b89de5625b7a877a7a6c96e3ece0f5fa00b94cb40533869a',
    },
    implementationBinding: {
      path: 'final_dev_selection_v1r1.implementation.json',
      bytes: 1251,
      sha256: 'e08dac1b79fd2fa26f266a27efc645cdbd25ce8c0f1a8419920a8332efc82f67',
    },
  },
} as const;

export function assertFrozenFinalSignalFitV1R1(): void {
  const fit = FROZEN_FINAL_SIGNAL_FIT_V1R1;
  if (fit.domainEnd !== DEV_INFORMATION_END_V1) throw new Error('FINAL_SIGNAL_DOMAIN_END_CHANGED');
  if (fit.trainMs !== 180 * DAY_MS || fit.calibrationMs !== 30 * DAY_MS) throw new Error('FINAL_SIGNAL_DURATION_CHANGED');
  if (fit.embargoMs !== DAY_MS) throw new Error('FINAL_SIGNAL_EMBARGO_CHANGED');
  if (fit.h !== 3 || fit.tau !== 0) throw new Error('FINAL_SIGNAL_LABEL_SPEC_CHANGED');
}

assertFrozenFinalSignalFitV1R1();
