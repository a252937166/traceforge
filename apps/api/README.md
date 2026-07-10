# TraceForge API

Deterministic backend for the TraceForge hackathon MVP. It captures a controlled legacy return workflow, extracts an evidence-linked behavior contract, runs a candidate replacement against the same input, and produces a differential proof bundle. Legacy and replacement inventory/return state live in separate SQLite partitions; each run resets, executes, commits, and reads the business state back before comparison.

The legacy oracle and replacement candidate are separate exported implementations (`executeLegacyWorkflow` and `executeReplacementWorkflow`) with independent inventory-disposition code and traceable `implementationId` values. The default candidate contains one deliberate, reproducible mutation: a damaged standard-customer refund is incorrectly restored to sellable inventory instead of quarantine. `candidateVersion: "fixed"` is a clearly labelled reference implementation for the passing rerun. It is **not** represented as a Codex-generated fix.

## Run

Requires Node.js 22.5+ for `node:sqlite`.

```bash
npm install
npm test
npm run dev
```

The API uses port `8787` by default. With Codex disabled it binds to `0.0.0.0`; with `TRACEFORGE_ENABLE_CODEX=1` it binds to `127.0.0.1` to keep the expensive repair surface local. Set `HOST` to make an explicit override, or `PORT` / `TRACEFORGE_DB` to override the port / SQLite artifact path.

Browser CORS is restricted by default to `localhost` and `127.0.0.1` on ports `5173`, `5174`, and `4173`. Add exact origins with the comma-separated `TRACEFORGE_ALLOWED_ORIGINS` variable. Requests without an `Origin` header, such as server-to-server calls and curl, remain allowed.

## Frontend contract

`POST /api/demo/run`

```json
{
  "scenarioId": "damaged-small-refund",
  "candidateVersion": "buggy"
}
```

Returns a stable top-level shape:

```json
{
  "runId": "run_...",
  "status": "FAILED",
  "source": "deterministic-local-demo",
  "events": [{ "type": "legacy.input.captured", "title": "...", "detail": "...", "evidenceId": "ev_...", "digest": "sha256:..." }],
  "rules": [{ "ruleId": "...", "statement": "...", "confidence": 1, "evidenceIds": ["ev_..."] }],
  "proofs": [{ "proofId": "assert_001", "label": "...", "status": "PASSED", "expected": "...", "actual": "..." }],
  "contract": {},
  "proofBundle": {},
  "traces": { "legacy": {}, "replacement": {} }
}
```

## Routes

- `GET /api/health` — service, SQLite, and Codex adapter status.
- `GET /api/scenarios` — four deterministic demo scenarios.
- `GET /api/replacement/versions` — honest labels for mutated, reference-fixed, and generated candidates.
- `POST /api/traces/capture` — capture one legacy or replacement trace; legacy capture also returns a contract.
- `POST /api/demo/run` — full capture → contract → dual run → differential proof flow.
- `POST /api/verifications` — wrapped `{ data }` form of the same verifier for programmatic clients.
- `POST /api/verifications/suite` — verify all controlled scenarios.
- `GET /api/traces/:id`, `GET /api/contracts/:id`, `GET /api/proofs/:id` — retrieve persisted artifacts.
- `GET /api/adapters/codex` — distinguishes SDK installation from explicit execution enablement.
- `POST /api/adapters/codex/repair` — accepts `{ "proofId": "proof_..." }`; disabled by default and returns `501` unless `TRACEFORGE_ENABLE_CODEX=1`.

## Real Codex repair boundary

When explicitly enabled, the repair endpoint requires `Content-Type: application/json` and starts a real Codex SDK thread in a new detached `.traceforge/worktrees/*` worktree. The thread runs with `workspace-write`, approval policy `never`, tool-network access disabled, and a default five-minute turn timeout. Override the timeout with `TRACEFORGE_CODEX_TIMEOUT_MS` between 10,000 and 1,800,000 milliseconds.

Only `apps/api/src/candidates/generated-repair.ts` may change. The host verifies the Git whitelist, performs `pnpm install --offline --frozen-lockfile`, runs all API tests, then runs `verify:generated`. A successful response contains `verification.run`, the complete fresh `DemoRunResponse` and proof seal produced inside that worktree. The worktree is retained; the adapter never applies, commits, pushes, merges, or deploys the repair.

## Truthfulness boundary

The contract extractor in this MVP is deterministic and declares `openaiUsed: false`. Inventory assertions compare snapshots read from the `inventory_state` and `return_state` SQLite tables, and the proof bundle is produced by code-level assertions outside any generative model. Every evidence record and proof bundle carries a real `sha256:<64 hex>` digest over stable, key-sorted JSON; `src/digest.ts` is the independent reproduction contract. The current scope is covered-scenario conformance, not universal behavioral equivalence.
