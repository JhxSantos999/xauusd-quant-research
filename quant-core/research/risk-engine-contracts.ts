export const RISK_ENGINE_V1_SPEC_IDENTITY = {
  path: 'quant-core/research/risk_engine_v1.spec.json',
  bytes: 1999,
  sha256: '93dd6c9a5ba4d1049b92cbb009d3f844bd1841f9049950bc551c6c3167b3b233',
} as const;

export const RISK_ENGINE_V1_IMPLEMENTATION_BINDING = {
  path: 'quant-core/research/risk_engine_v1.implementation.json',
  bytes: 441,
  sha256: '6944ea3595bc680c08aaed019113195b6b7eca492da7f3b557cdb9c78857e1ff',
} as const;

export const AUDITED_FINAL_SIGNAL_EXECUTION_V1R1 = {
  executionId: 'final_signal_v1r1_20260913235306128',
  sourceCommit: 'c84050c6d62d29944d1763a1b71c5d990b987eed',
  artifactManifestSemanticSha256: 'a4ee4aa9ab1af075aacdefa68919e4e81f0992e5d7b6219089006090d57f3b60',
  selected: { h: 3, tau: 0 },
  files: {
    artifactManifest: {
      path: 'final_signal_artifact_manifest.json',
      bytes: 3443,
      sha256: 'b6b169ae88d9feaf4060528f4c5e2b17d6ef79da500a6bd7096835fae4a680e0',
    },
    model: {
      path: 'final_signal_model.json',
      bytes: 1073,
      sha256: 'f4869afd3cfeb681bca356ee08d80a63fb617a841427932a571ff2e2306f7655',
    },
    calibrator: {
      path: 'final_signal_calibrator.json',
      bytes: 684,
      sha256: '6d851a2eaa61deaa00bc2bc7899ad40fabc5b8758cd58ed933782709996ac17c',
    },
    fitEvidence: {
      path: 'final_signal_fit_evidence.json',
      bytes: 752,
      sha256: '27b9a1399fa106be754eef7c438e2c98cb05943d8bd6f131844b9ed8afeaf91c',
    },
    provenance: {
      path: 'execution_provenance.json',
      bytes: 3553,
      sha256: '1d6b8a538aa821afb7ae8fc1e8213f83d1aba949f35ecf14a3ab601a27dfe370',
    },
    lineage: {
      path: 'experiment_lineage.json',
      bytes: 1285,
      sha256: '952d5ff0e7d3915398bf4ca4f914978bd0c556e745df9e9379fa0a476087d5b1',
    },
    implementationBinding: {
      path: 'final_signal_model_v1r1.implementation.json',
      bytes: 1314,
      sha256: 'f5bf2acd6796c376a54a18a5b77d597dd2d6823c3053bd39c4c26d924b1c4b6a',
    },
  },
} as const;

export const FROZEN_RISK_POLICY_V1 = {
  perTradeEquityFraction: 0.0025,
  maxGrossExposureMultiple: 1.0,
  stopAtrMultiple: 1.0,
  timeExitBars: 3,
  timeExitMs: 900000,
  decisionThreshold: 0.5,
  takeProfitPolicy: 'NONE',
  maxOpenPositionsXauusd: 1,
} as const;

export function assertFrozenRiskPolicyV1(): void {
  const p = FROZEN_RISK_POLICY_V1;
  if (p.perTradeEquityFraction !== 0.0025) throw new Error('RISK_V1_PER_TRADE_RISK_CHANGED');
  if (p.maxGrossExposureMultiple !== 1.0) throw new Error('RISK_V1_MAX_GROSS_EXPOSURE_CHANGED');
  if (p.stopAtrMultiple !== 1.0) throw new Error('RISK_V1_STOP_ATR_CHANGED');
  if (p.timeExitBars !== 3 || p.timeExitMs !== 900000) throw new Error('RISK_V1_TIME_EXIT_CHANGED');
  if (p.decisionThreshold !== 0.5) throw new Error('RISK_V1_DECISION_THRESHOLD_CHANGED');
  if (p.takeProfitPolicy !== 'NONE') throw new Error('RISK_V1_TAKE_PROFIT_POLICY_CHANGED');
  if (p.maxOpenPositionsXauusd !== 1) throw new Error('RISK_V1_MAX_OPEN_POSITIONS_CHANGED');
}

assertFrozenRiskPolicyV1();
