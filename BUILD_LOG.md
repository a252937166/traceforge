# Build log

This log separates development-time Codex assistance, product-runtime model execution, recorded evidence, and deterministic host verification.

## 2026-07-10 — evidence-bounded foundation

- Chose a narrow workflow-modernization laboratory instead of a general code generator.
- Implemented independent legacy and replacement workflow modules with SQLite-backed inventory and return state.
- Kept the verifier outside every model turn and limited claims to executed fields and scenarios.
- Used development-time Codex agents to implement and review the initial API and web surfaces in parallel. This is not presented as product-runtime evidence.

## 2026-07-10 to 2026-07-11 — evidence loop rebuilt after review

- Replaced the earlier linear demo with Observe → Infer → Challenge → Build → Verify.
- Added SQLite migration jobs, sequence-numbered append-only events, SSE replay, downloadable artifacts, and proof-digest recomputation.
- Added three explicit modes: fresh model execution, disclosed recorded replay, and host-only deterministic verification. A failed fresh run remains failed.
- Expanded the current evidence suite to seven executed scenarios: two observed cases, two counterexamples, two adjacent boundary cases, and one post-turn verification-only case.
- Added the stock-exhaustion counterexample and five failure-atomicity assertions: execution failure, exact code/message, no return record, unchanged inventory, and zero side effects.

## 2026-07-11 — canonical GPT-5.6 Sol archaeology

- Ran one read-only Trace Archaeologist, two Counterexample Hunter turns, and one Contract Critic with schema-constrained output and evidence-ID allowlists.
- Let the host—not the model—execute proposed inputs, establish the exact 50,000-cent review boundary, and expose the zero-stock failure branch.
- Preserved four failed proofs in the Codex repair input instead of rewriting them as successful attempts.
- Closed the contract lifecycle from four initial unknowns to four resolved and zero remaining before Build.
- Recorded canonical source migration `migration_efaa0383-628a-4fba-94df-96bfe344bcbe` in `docs/evidence/live-champion-run/`.
- The four authenticated `gpt-5.6-sol` turns total `121,673` tokens; their bounded inputs, structured outputs, metadata, and manifest remain in `docs/evidence/live-champion-run/invocations/`.

## 2026-07-11 — canonical Codex full-module repair and host proof

- Seeded defects in `apps/api/src/candidates/generated-return-workflow.ts`, including rule priority, damaged-inventory disposition, and stockout atomicity.
- Started Codex from fixture commit `eb0e6169974b96bd3bff3b536b38ef5f665127c2` in a detached worktree with a one-file accepted-write allowlist.
- Codex thread `019f5244-7bef-71f2-8f25-8ed1446a539e` changed only `apps/api/src/candidates/generated-return-workflow.ts`.
- Codex received the final contract, four failed proofs, and seven disclosed scenario records. The concrete verification-only input was materialized by the host after the writing turn.
- The host accepted the candidate only after `56/56` candidate-safe tests passed; four replay-integrity guards remained separate from the candidate worktree gate.
- The differential verifier passed `7/7` scenarios and `35/35` deterministic assertions with zero mismatches.
- Candidate source digest: `sha256:fdf9a85c55e6a007320a5613672ba3354fb785d307c57f7201357bdc7b1c9e74`.
- Accepted diff digest: `sha256:4e2841074c97edaacd151318cdcc1fc8e0b9ba72f50d47c40d0a5c4a6a21577a`.
- Canonical proof ID: `migration-proof_54c63c5b-f5ca-4675-b0bc-7fedb6956dbb`.
- Canonical internal proof digest: `sha256:4be44d476f222ca492d025a13f296997148142471e2387d532c61479bc3703bc`.

## 2026-07-11 to 2026-07-12 — judge-facing Migration Loom

- Rebuilt the web interface as a high-contrast evidence instrument with a five-stage rail, hypothesis threads, visible falsification, candidate ledger, scenario matrix, event console, and artifact dock.
- Removed timer-driven progress and client-manufactured successful output.
- Made the no-credential completed-proof path the public-safe experience while retaining a clearly separate Local Runner path.
- Browser-tested the real API at desktop, tablet, and mobile widths and captured a hash-bound submission gallery.

## 2026-07-12 — exercised Local Runner v0.1.9

- Verified tag `local-runner-v0.1.9` at commit `a2ce8b2394caf5d1491c2b142f99a8421f3cec2d` from a fresh clone before installation.
- Used the actual loopback UI to approve one live local `gpt-5.6-sol` Codex turn, thread `019f5288-3b94-7a71-a087-032825fff3fa`.
- The separate local host verifier passed `15/15` focused tests, `7/7` scenarios, `35/35` assertions, and the stockout branch's `5/5` assertions with zero mismatches.
- Local proof digest: `sha256:0218e92475eb2c08cd875e2a5363ff6a0b71800d17503b5fb5381387d544453b`.
- Local diff digest: `sha256:5c51b3f7bd93a75c5dbeeb1d82b47086480d92a49ace52d26dc451479082386f`.
- UI-triggered cleanup verified removal or closure of the session, writer, verifier, registered worktree, Codex lock, and loopback server.

## 2026-07-12 — public evidence release

- Deployed source commit `652afb576815924607cecf9a632c0eb7f988e195` to `https://traceforge.axiqo.xyz`; the API release manifest recorded build time `2026-07-12T04:25:07.768Z`.
- Published the signed-out-playable 1080p judge video at `https://youtu.be/tRtgOKyW7qs`.
- Preserved the earlier six-scenario source under `docs/evidence/superseded-champion-run-v1-20260711/` with an explicit `DO NOT SUBMIT` notice. Its old metrics remain intact as historical evidence, not as current claims.

## Evidence policy

- A recorded replay is always labelled with its original timestamp and never described as a current model call.
- A SHA-256 digest is reproducible integrity metadata, not a cryptographic signature, identity attestation, or trusted timestamp.
- A seven-scenario pass is covered-scenario conformance for the asserted fields, not universal equivalence.
- Failed model or verifier runs remain visible evidence; no other execution mode is substituted automatically.
- Historical runs retain their original metrics and identifiers, but are named and labelled `superseded` and are never submission aliases.
- Codex never applies, commits, pushes, merges, deploys, or judges its own candidate.
