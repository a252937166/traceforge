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
