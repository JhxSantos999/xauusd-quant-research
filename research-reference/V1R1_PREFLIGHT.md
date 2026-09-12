# V1R1 local preflight

V1R1 is the active canonical preregistration identity for the unchanged semantic V1 research protocol. The original V1 canonical bytes were not recovered and remain legacy-only.

## Required dataset

Use only the canonical development CSV:

- file: `XAUUSD_M5_202504070100_202609090525.csv`
- bytes: `6285976`
- SHA-256: `a34f2d5469782fccd1e8479ceea5c81b633aa5301b7ed47447049323850de8f5`
- candles: `101108`
- first bar open: `2025-04-07T01:00:00Z`
- last bar open: `2026-09-09T05:25:00Z`
- max DEV information time: `2026-09-09T05:30:00Z`

## Preflight-only command

From the repository root, after checking out `audit/quant-core-v1`:

```bash
npm install
npm test
npm run preflight:v1r1 -- --dataset "FULL_PATH_TO/XAUUSD_M5_202504070100_202609090525.csv"
```

`preflight:v1r1` always appends `--preflight-only`. It must not fit Logistic Regression, fit Platt calibration, generate Nested OOS metrics, execute Final DEV selection, or access any future lockbox data.

## Required success evidence

The command must print `PREFLIGHT_PASS` and report the canonical dataset identity plus these active preregistration identities:

- selection: `07cbc1cbbf774321368269bd4d8d58325c0b2adb78a8ba8cbb9bd05cc658e83f`
- geometry: `4371d1e60888aafcd77be2dca2ca33d70e8fc4e985433bff4a0d57155911b7b2`
- nested validation: `13e55e8f18d26005322ec079a03996dae02ec46d7e0d5dd8fc4a8e94418c07d1`
- manifest: `1cacf7759512560ad6068980e0ea44d19aa9018a3aa1c34ba08cf22d0fe399a0`

Any mismatch remains fail-closed. Do not repair a mismatch and continue into a full run in the same execution. Stop, audit, commit the correction if operational only, then rerun preflight separately.

## Full execution remains blocked

A passing local preflight does **not** automatically authorize Full XAUUSD execution. Its stdout must first be independently audited against the identities above. Only after that checkpoint may the full Nested V1R1 execution be authorized. Final DEV and the future lockbox remain separate later gates.
