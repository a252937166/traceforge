# TraceForge API

The API owns the complete migration state machine: Observe → Infer → Challenge → Build → Verify. It stores jobs, append-only events, traces, artifacts, and proofs in SQLite; the browser only renders server-issued state.

## Run

Node.js 22.13 or newer is required so `node:sqlite` is available without a CLI flag.

```bash
pnpm --filter @traceforge/api dev
pnpm --filter @traceforge/api typecheck
pnpm --filter @traceforge/api test
```

The default address is `http://0.0.0.0:8787`. Override it with `HOST`, `PORT`, and `TRACEFORGE_DB`.

## Migration API

```text
POST /api/migrations
GET  /api/migrations/:id
GET  /api/migrations/:id/events
GET  /api/migrations/:id/proof
GET  /api/migrations/:id/artifacts
GET  /api/migrations/:id/downloads/:filename
POST /api/proofs/verify-digest
```

Start a run with one explicit mode:

```json
{ "executionMode": "recorded-replay" }
```

- `live-ai` performs fresh GPT-5.6 Sol archaeology and a fresh Codex SDK build. Missing model capability fails the job; the server does not substitute another mode.
- `recorded-replay` re-emits the checked-in model invocation provenance and then reruns the deterministic seven-scenario suite.
- `deterministic-only` skips model stages and claims only current host verification.

`/events` supports both Server-Sent Events and JSON replay with sequence cursors. Completed runs expose `proof.json`, `contract.json`, `candidate.diff`, `commands.json`, and `evidence.jsonl` with SHA-256 headers.

## Trust boundary

The GPT adapter is read-only and receives an evidence-ID allowlist. The host executes every counterexample. The critic must partition initial unknowns into evidence-linked resolutions or remaining unknowns, and the host rejects `READY_FOR_BUILD` while any in-scope blocking unknown remains. The Codex adapter may change only `apps/api/src/candidates/generated-return-workflow.ts` in a detached worktree; it cannot edit the legacy oracle, verifier, scenarios, or event store. The host runs all API tests and the complete scenario suite outside the writing turn.

Enable fresh model work only in an authenticated local environment:

```bash
TRACEFORGE_ENABLE_GPT56=1 TRACEFORGE_ENABLE_CODEX=1 pnpm --filter @traceforge/api dev
```

The adapters use the operator's existing Codex login unless `TRACEFORGE_CODEX_API_KEY` is set explicitly. Unrelated ambient keys are removed from the child environment.

## Lower-level verification routes

`POST /api/traces/capture`, `POST /api/verifications`, and `POST /api/verifications/suite` expose the deterministic capture and comparison primitives used by integration tests. Candidate identity is limited to `seeded` or `generated`; the seeded implementation is intentionally rejected by hidden rules.

The resulting proof is an unsigned, reproducible digest over covered-scenario conformance. Six successful rows compare five business-result fields. The exhausted-stock row instead compares failure status, code plus message, no return record, unchanged inventory, and zero side effects. It is not a signature and does not claim universal behavioral equivalence.
