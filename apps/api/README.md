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

The API listens on `http://localhost:8787` by default. Set `PORT` or `TRACEFORGE_DB` to override the port or SQLite artifact path.

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
- `GET /api/replacement/versions` — honest labels for the mutated and reference-fixed candidates.
- `POST /api/traces/capture` — capture one legacy or replacement trace; legacy capture also returns a contract.
- `POST /api/demo/run` — full capture → contract → dual run → differential proof flow.
- `POST /api/verifications` — wrapped `{ data }` form of the same verifier for programmatic clients.
- `POST /api/verifications/suite` — verify all controlled scenarios.
- `GET /api/traces/:id`, `GET /api/contracts/:id`, `GET /api/proofs/:id` — retrieve persisted artifacts.
- `GET /api/adapters/codex` — explicit not-configured status and future integration contract.
- `POST /api/adapters/codex/repair` — returns `501` until a real authenticated Codex integration exists.

## Truthfulness boundary

The contract extractor in this MVP is deterministic and declares `openaiUsed: false`. Inventory assertions compare snapshots read from the `inventory_state` and `return_state` SQLite tables, and the proof bundle is produced by code-level assertions outside any generative model. Every evidence record and proof bundle carries a real `sha256:<64 hex>` digest over stable, key-sorted JSON; `src/digest.ts` is the independent reproduction contract. The current scope is covered-scenario conformance, not universal behavioral equivalence.
