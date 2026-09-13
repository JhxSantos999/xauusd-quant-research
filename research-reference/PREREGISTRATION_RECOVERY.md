# Preregistration V1 recovery status

## Current state

The mathematical V1 rules remain frozen, but the four canonical preregistration JSON bodies are not currently available byte-for-byte in the accessible conversation, Library, or Git history.

Production must remain fail-closed. No file may be accepted because it merely appears semantically equivalent. The exact byte length and SHA-256 identity are the acceptance criteria.

| Canonical file | Bytes | SHA-256 |
| --- | ---: | --- |
| `label_selection_v1.spec.json` | 2068 | `a5d19b25723d2576b53c6aac20ca4d8c34df3446af9bed0e418026fea405a966` |
| `walkforward_geometry_v1.spec.json` | 1203 | `da97bfb9be52a5ac68f94fc7c19b897502eeeef737db864a745fcdcec95734cc` |
| `nested_validation_v1.spec.json` | 1068 | `ac844eb750d2f67d12bcf70cb276fbab411c4e6395eac3b53415feb7ecbbf836` |
| `research_preregistration_manifest.json` | 851 | `791d89013224ae0e3a9296058e53f54b732e20bffdf5fe746c81e283f06a70e0` |

## Recovery work performed

The audit searched the accessible conversation and Library by exact hashes and filenames, inspected historical reports and attachment aliases, materialized available historical files, checked the GitHub repository and branches for an older Quant Core snapshot, and performed a bounded reconstruction search for the geometry using only documented field names and values.

A real historical `walkforward_geometry_v1.corrected.spec.json` was recovered, but it is **not** the final frozen geometry. Its identity is 1006 bytes / SHA-256 `44099ce71eacb2ee8f8ba673351bd341a6123b9dc435de7a7674014addf63175`. It is classified as superseded and must never satisfy production preflight.

The bounded geometry reconstruction checked 626,288 candidates at the expected 1203-byte length and found no SHA-256 match. This is evidence that the missing canonical body should not be guessed from naming variations.

## Governance rule

Do **not** approximate a canonical file. Do **not** substitute the superseded geometry. Do **not** silently create a new V1 body under the old hashes or filenames. Do **not** execute the Full XAUUSD nested experiment, Final DEV selection, or future lockbox while the exact canonical files are absent.

There are only two legitimate ways to leave this HOLD state:

1. Restore all four exact canonical files and pass byte-length + SHA-256 preflight.
2. Explicitly authorize and document a **new preregistration version** before any empirical model fit. A new version must receive new canonical files/hashes and must never be represented as recovery of the old V1 bytes.

Until one of those conditions is met, the correct production state is `ABORTED_PREREGISTRATION_MISMATCH` / HOLD.
