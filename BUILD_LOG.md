# Build log

This file records how Codex participated in the project and separates shipped behavior from planned integrations.

## 2026-07-10 — foundation

- Chose a narrow proof-carrying modernization wedge instead of a generic code generator.
- Defined a controlled returns workflow with observable API and SQLite side effects.
- Split responsibilities: read-only behavior archaeology, a single code writer, and an independent deterministic verifier.
- Used development-time Codex subagents to implement the API/verifier and console in parallel; this is not evidence of product-runtime multi-agent execution.
- Kept registration legal confirmations pending because the official rules are not yet published.

## 2026-07-10 — first executable proof loop

- Registered the existing Devpost account for OpenAI Build Week; project submissions remain closed until July 13 at 09:00 PDT.
- Added distinct in-process legacy and replacement workflow paths with separate implementation IDs.
- Persisted inventory and return state in one SQLite database partitioned by system and read both snapshots back before comparison.
- Demonstrated the controlled replacement mutation: sellable `10 → 11` and quarantine `0 → 0`, while legacy produces `10 → 10` and `0 → 1`.
- Re-ran the reference-fixed candidate and sealed a `PASSED` proof only after five deterministic assertions reported zero differences.
- Added stable-key SHA-256 digests for evidence and proof bundles, plus JSON Schema validation against checked-in repository schemas.
- Kept the Codex repair adapter explicitly unconfigured (`501`) so the deterministic reference patch cannot be mistaken for a live model-generated change.

## 2026-07-10 — isolated Codex repair exercised

- Added `@openai/codex-sdk` behind explicit `TRACEFORGE_ENABLE_CODEX=1` enablement.
- Restricted the SDK turn to a retained detached worktree and the single writable file `apps/api/src/candidates/generated-repair.ts`.
- Kept installation, API tests, generated-candidate verification, and proof sealing in the host process; the SDK cannot edit the verifier or accept its own result.
- Preserved the first real SDK attempt as a failed verification: the generated candidate passed with zero mismatches, but an API test incorrectly compared the active generated configuration with the immutable baseline. The endpoint correctly returned `422`.
- Corrected that host test in commit `d78c368`, retried from the same failed proof, and received a fresh `PASSED` generated run with zero mismatches. The successful SDK thread, token usage, diff, proof IDs, digests, exit codes, and retained worktree are recorded in `docs/evidence/codex-repair-run.md`.
- Connected the web console to the repair endpoint. Only an integrity-complete HTTP `200` can seal; `422`, `502`, network failure, timeout, reused IDs, malformed evidence, or whitelist failure stay unresolved. Only `501` activates the labelled reference fallback.

## Evidence policy

- Do not describe deterministic fixtures as model output.
- Do not describe a local diff as a GitHub pull request.
- Do not call covered-scenario conformance “full equivalence.”
- Preserve failed verification as part of the proof story.
