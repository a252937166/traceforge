# Build log

This log separates development-time Codex assistance, product-runtime model execution, recorded evidence, and deterministic host verification.

## 2026-07-10 — evidence-bounded foundation

- Chose a narrow workflow-modernization laboratory instead of a general code generator.
- Implemented independent legacy and replacement workflow modules with SQLite-backed inventory and return state.
- Kept the verifier outside every model turn and limited claims to executed fields and scenarios.
- Used development-time Codex agents to implement and review the initial API and web surfaces in parallel. This is not presented as product-runtime evidence.

## 2026-07-10 — product loop rebuilt after judge review

- Replaced the earlier linear demo with Observe → Infer → Challenge → Build → Verify.
- Added SQLite migration jobs, sequence-numbered append-only events, SSE replay, downloadable artifacts, and proof-digest recomputation.
- Added three explicit modes: fresh model execution, disclosed recorded replay, and host-only deterministic verification. A failed fresh run remains failed.
- Expanded the suite to six partitions: two observed, one counterexample, two adjacent boundary cases, and one held-out tier-priority case.

## 2026-07-10 — real GPT-5.6 Sol archaeology

- Ran a read-only Behavior Archaeologist, two Counterexample Hunter turns, and a Contract Critic with schema-constrained output and evidence-ID allowlists.
- Let the host—not the model—execute proposed inputs and binary-search the exact 50,000-cent review boundary.
- Preserved the initial over-generalizations, the counterexamples that falsified them, and the refined priority rule.
- Recorded source migration `migration_57dcf6ff-c7b0-4842-8a66-a74e08565b7b` and four model thread IDs in `docs/evidence/live-champion-run/`.

## 2026-07-10 — real Codex full-module repair

- Seeded two defects in `apps/api/src/candidates/generated-return-workflow.ts`: VIP priority and damaged-inventory disposition.
- Started Codex from base commit `899ff7ac5f6151b58129559a1d760177a1243136` in a detached worktree with a one-file allowlist.
- Codex thread `019f4d12-9228-78c1-95fc-3a13d8e1919f` replaced the complete decision/side-effect module rather than toggling a configuration value.
- The host accepted the candidate only after 37 API tests and all six differential scenarios passed.
- The accepted source digest is `sha256:33dae444638bf3e7015aa743711358a19e330ca98d1fec8b98d044a106132773`.

## 2026-07-11 — judge-facing Migration Loom

- Rebuilt the web interface as a cold, high-contrast evidence instrument with a five-stage rail, hypothesis threads, visible falsification, candidate ledger, scenario matrix, event console, and artifact dock.
- Removed timer-driven progress and any client-manufactured successful output.
- Made recorded replay the public-safe default while keeping fresh model work one explicit selection away.
- Browser-tested the real local API at desktop width and 390px; corrected terminal transport state, structured inventory rendering, and mobile overflow.

## Evidence policy

- A recorded replay is always labelled with its original timestamp and never described as a current model call.
- A SHA-256 digest is reproducible integrity metadata, not a cryptographic signature.
- A six-scenario pass is covered-scenario conformance, not universal equivalence.
- Failed model or verifier runs remain visible evidence; no other execution mode is substituted automatically.
- Codex never applies, commits, pushes, merges, deploys, or judges its own candidate.
