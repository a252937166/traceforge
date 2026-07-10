# Real Codex SDK repair evidence — 2026-07-10

This record distinguishes a real product-runtime Codex SDK turn from deterministic reference candidates and development-time use of Codex. It does not identify the underlying model as GPT-5.6 because the captured SDK result did not expose a model name.

## Source failure

- Failed proof: `proof_2937c81e-57c0-439d-8d08-b6d675047586`
- Failed proof digest: `sha256:da2dda38da5f8176645bb929c4e0c974c2ca637843fd112e843f61ecb9e1f8cb`
- Observed mismatch: the candidate restored one damaged refunded unit to sellable inventory instead of quarantine.
- Allowed write: `apps/api/src/candidates/generated-repair.ts` only.

## Attempt 1 — correctly rejected by the host

- SDK thread: `019f4bcc-a25b-7a51-bdf6-a1edea219ff7`
- Retained worktree: `.traceforge/worktrees/repair-1783683125556-ff5c4807`
- Base commit: `48268f67549cc2bb8ef5fbf0acefb6da899bc91f`
- Whitelist: passed; exactly the required file changed; no unexpected files.
- Offline install: exit `0`.
- Generated-candidate verifier: exit `0`, `PASSED`, zero mismatches.
- API tests: exit `1` (`19/20` passed).
- Endpoint outcome: HTTP `422`; proof was not sealed.

The failed test compared the active `generatedRepair` configuration with the immutable unconfigured baseline. A valid generated repair therefore made the test fail even though the generated scenario passed. This was a host-test defect, not a reason to weaken the business assertion. Commit `d78c368` changed that assertion to compare runtime evidence with the active generated configuration while retaining a separate baseline-immutability test.

## Attempt 2 — verified

- SDK thread: `019f4bcf-8a09-7ac1-b76c-4758e1be9f0d`
- Token usage reported by the SDK: 140,992 input; 114,176 cached input; 2,090 output; 387 reasoning output.
- Retained worktree: `.traceforge/worktrees/repair-1783683318321-5189e463`
- Base commit: `d78c368fcdf9dbe2d4b0d2cb0de07f77ffafd8a3`
- Changed files: `apps/api/src/candidates/generated-repair.ts` only.
- Whitelist: passed; no unexpected files.
- Offline install: exit `0`.
- API tests: exit `0`.
- Generated-candidate verifier: exit `0`.
- Fresh run: `run_e1112cf0-5081-4436-aab2-f6f93760978f`.
- Fresh proof: `proof_de0f0a09-756a-47a2-adef-d23860c9ffba`.
- Fresh proof digest: `sha256:4223e0c34036c7fce8810d93a684dc78a31aef4301551d73eb06b82a8eed5e6a`.
- Verification: `PASSED`; zero mismatches.
- Endpoint outcome: HTTP `200`.

The effective repair changed `damagedRefundDestination` from `SELLABLE` to `QUARANTINE`, marked the candidate as `codex-generated`, and attached the source-proof digest.

## Promotion boundary

The verified patch remains in the retained worktree. TraceForge did not apply it to `main`, commit it, push it, open a pull request, or deploy it. The checked-in generated candidate intentionally remains unconfigured so future demonstrations must execute the repair path rather than inherit a pre-repaired file.

## Release-validation run — verified after boundary hardening

The submission build repeated the entire product path after adding proof-digest provenance checks, a credential-minimized child environment, ignored-path tamper detection, and host-owned acceptance. The final recording produced:

- Source failed run: `run_ac6da7f9-42c7-4c14-b5b8-08ff0c0acbb5`.
- Source failed proof: `proof_bdb39dce-74e5-4534-8789-519e98b248ac`.
- Source proof digest: `sha256:3b1c97ce524318559cfd1d9f79e8b7308a079c44ae5e8b474a90c21eb5b6ffb5`.
- SDK thread: `019f4cb1-4193-7ee3-a4d2-5f7852c18329`.
- Retained worktree: `.traceforge/worktrees/repair-1783698109772-fed51e82`.
- Base commit: `7c6bae15cc794ccf4546de77aa56abba3dca37b2`.
- Changed files: `apps/api/src/candidates/generated-repair.ts` only.
- Whitelist: passed; required file changed; no unexpected files.
- Provenance: `codex-generated`; source digest matched the failed proof; no provenance problems.
- Fresh run: `run_185a9fe7-36de-4a24-a7b7-9d1fb31db622`.
- Fresh proof: `proof_5cde5f57-75b4-49bd-98dd-d926fcd356e9`.
- Fresh proof digest: `sha256:7a0c39939e0a6889a56eb038f14840391f6f5170293d4e9f647acdf3aef25eac`.
- Verification: `PASSED`; five assertions; zero mismatches; HTTP `200`.

Two operational preflight failures also failed closed during recording. A stale API key produced HTTP `401` and left the candidate unsealed. A repair turn that attempted to install dependencies would have created ignored artifacts, so the repair prompt was tightened to prohibit install/build/test activity; only the host may create the clean verification environment. The final run used the existing ChatGPT Codex login, an unauthenticated loopback proxy passed through a strict allowlist, and host-only installation and tests.

A sanitized machine-readable extract of the final response is published beside this record as [codex-run-proof.json](codex-run-proof.json); it contains no credentials or absolute worktree path.
