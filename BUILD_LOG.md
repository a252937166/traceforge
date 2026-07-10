# Build log

This file records how Codex participated in the project and separates shipped behavior from planned integrations.

## 2026-07-10 — foundation

- Chose a narrow proof-carrying modernization wedge instead of a generic code generator.
- Defined a controlled returns workflow with observable API and SQLite side effects.
- Split responsibilities: read-only behavior archaeology, a single code writer, and an independent deterministic verifier.
- Started the API/verifier and judge-facing console in parallel with Codex subagents.
- Kept registration legal confirmations pending because the official rules are not yet published.

## 2026-07-10 — first executable proof loop

- Registered the existing Devpost account for OpenAI Build Week; project submissions remain closed until July 13 at 09:00 PDT.
- Added distinct legacy and replacement workflow implementations with separate implementation IDs.
- Persisted inventory and return state in isolated SQLite partitions and read both snapshots back before comparison.
- Demonstrated the controlled replacement mutation: sellable `10 → 11` and quarantine `0 → 0`, while legacy produces `10 → 10` and `0 → 1`.
- Re-ran the reference-fixed candidate and sealed a `PASSED` proof only after five deterministic assertions reported zero differences.
- Added stable-key SHA-256 digests for evidence and proof bundles, plus JSON Schema validation against the published schemas.
- Kept the Codex repair adapter explicitly unconfigured (`501`) so the deterministic reference patch cannot be mistaken for a live model-generated change.

## Evidence policy

- Do not describe deterministic fixtures as model output.
- Do not describe a local diff as a GitHub pull request.
- Do not call covered-scenario conformance “full equivalence.”
- Preserve failed verification as part of the proof story.
