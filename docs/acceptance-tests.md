# TraceForge executable release gate

The gate tests the implemented claim: a recorded, provenance-bearing model run can drive the five-stage migration workbench, while a fresh host verifier independently checks six scenarios, emits downloadable evidence, and produces a recomputable proof.

It does not establish universal workflow equivalence or rerun paid model calls in CI.

## One-command gate

From a clean checkout with Node.js 22.5 or newer and pnpm 10.33.2:

```bash
pnpm install --frozen-lockfile
pnpm acceptance:all
```

`acceptance:all` executes:

```text
pnpm check
pnpm acceptance:api
pnpm acceptance:ui
pnpm acceptance:repeat -- --runs 3
```

Generated outputs are retained under `.traceforge/acceptance/` and excluded from Git.

## Gate matrix

| Command | What it verifies |
|---|---|
| `pnpm check` | API and Web type checking, unit/integration tests, and production builds. This includes the six-scenario corpus, exact 50,000-cent priority boundary, independent candidate module, three execution-mode behavior, event reduction, replay disclosure, and fail-closed live mode. |
| `pnpm acceptance:api` | The compiled production API runs both `deterministic-only` and `recorded-replay`, then checks the complete five-stage event ledger, SSE replay, four recorded GPT-5.6 Sol invocations, Codex provenance, `6/6` proof coverage, artifact downloads, digest recomputation, and tamper rejection. |
| `pnpm acceptance:ui` | A fresh production Web build plus a real headless Chromium run. It proves the browser enters SSE, renders Infer active and a hypothesis before completion, never falls back to polling on the healthy stream, and finishes at `6/6 PASSED`. |
| `pnpm acceptance:repeat -- --runs 3` | Three independently issued replay jobs have stable normalized semantics while migration, proof, event, artifact, and scenario trace IDs remain unique. |

## API acceptance details

`pnpm acceptance:api` rebuilds and starts the compiled `dist/server.js` with live GPT-5.6 and Codex execution disabled. It first proves that `deterministic-only` can issue a model-free proof from the deployed JavaScript module, then requests:

```http
POST /api/migrations
Content-Type: application/json

{"executionMode":"recorded-replay"}
```

The gate waits for a terminal job and checks:

- mode is still `recorded-replay`, status is `passed`, and model is `gpt-5.6-sol`;
- the recording timestamp, source run ID, and replay disclosure are present;
- event sequences are contiguous from 1, event IDs are unique, and every event has a SHA-256 digest;
- Observe, Infer, Challenge, Build, and Verify each emit `stage.started` and `stage.passed`;
- the ledger contains hypothesis proposals, evidence challenges, accepted bounded rules, both candidate states, a completed proof, and a terminal job event;
- the proof includes four `gpt-5.6-sol` invocation records and the recorded Codex thread;
- coverage is exactly `2 observed + 1 counterexample + 2 boundary + 1 verification-only` (`held-out` remains the raw schema partition name);
- all six scenarios pass with zero mismatches;
- `contract.json`, `evidence.jsonl`, `candidate.diff`, `commands.json`, and `proof.json` are present.

It then downloads every artifact and checks HTTP status, byte length, digest header, and a local digest recomputation. It calls `POST /api/proofs/verify-digest` once with the untouched proof and once after changing `coverage.passed`; the first must be valid and the second invalid.

The same gate verifies:

- an unsupported execution mode returns `400 INVALID_EXECUTION_MODE`;
- the compiled deterministic run passes and records zero model invocations;
- an unknown migration returns `404`;
- `?after=<sequence>` returns exactly the later events;
- the SSE endpoint returns `text/event-stream`, `X-Accel-Buffering: no`, every server sequence ID, and one uniform `event: migration` channel whose JSON payloads include `hypothesis.accepted` and `proof.completed`.

## UI acceptance details

`pnpm acceptance:ui` builds the React app and inspects the emitted HTML, JavaScript, and CSS. The production bundle must contain:

- the TraceForge Migration Loom identity;
- all three explicit execution modes;
- the migration API and `EventSource` integration;
- the counterexample and evidence-download surfaces;
- five-stage workbench styles, keyboard focus styles, and reduced-motion handling.

It then serves the Web app and compiled API on random local ports and starts Playwright Chromium. A mutation observer installed before React boots records transient UI states while the browser follows the real recorded-replay click path. The gate requires:

- transport visibly enters `sse` while the job is running;
- Infer visibly becomes `active` before the terminal event renders;
- at least one server-issued hypothesis renders before completion;
- the browser issues no `?format=json` polling request and never displays `polling`;
- the native SSE response is HTTP 200 with `text/event-stream`;
- the complete event ledger reaches the event console;
- the final proof reads `PASSED · 6/6 scenarios`.

The local acceptance API uses a short server-owned replay delay so transient states are observable. The browser still has no progress timer and derives every state from server events.

To check deployed services instead of starting local ones:

```bash
API_BASE=https://traceforge.axiqo.xyz \
WEB_BASE=https://traceforge.axiqo.xyz \
pnpm acceptance:ui
```

`acceptance:api` and `acceptance:repeat` also honor `API_BASE`.

## Repeatability gate

```bash
pnpm acceptance:repeat -- --runs 3
```

Each iteration executes the complete recorded-replay API acceptance, including downloads and digest checks. The gate then compares normalized:

- proof status, claim, and coverage;
- candidate implementation, source/diff digests, and Codex thread;
- six scenario IDs, partitions, statuses, assertion counts, and mismatch counts;
- four model invocation roles, model IDs, threads, and statuses;
- artifact filenames.

Across iterations it requires unique migration IDs, migration proof IDs, event IDs, artifact IDs, and all twelve legacy/candidate scenario trace IDs per job. Random provenance must be fresh even when business semantics remain stable.

The accepted `--runs` range is 2 through 25; the full gate uses 3 to keep CI bounded.

## Three-mode behavior

API integration tests, run by `pnpm check`, exercise the truth boundary directly:

| Mode | Expected test outcome |
|---|---|
| `recorded-replay` | Passes with replay disclosure, four recorded model invocations, Codex provenance, and fresh six-scenario proof |
| `deterministic-only` | Passes the host suite, marks Infer/Challenge/Build skipped, and records zero model invocations |
| `live-ai` with adapters disabled | Fails with `GPT56_ADAPTER_NOT_CONFIGURED`, issues no proof, and substitutes no replay or deterministic result |

Fresh authenticated `live-ai` execution is intentionally outside the repeatable CI gate because it depends on model access, credentials, latency, and token usage. Its checked-in provenance is documented in [`evidence/live-champion-run/README.md`](evidence/live-champion-run/README.md).

## Verify a checked-in proof directly

```bash
pnpm proof:verify docs/evidence/live-champion-run/proof.json
```

The command exits non-zero if the internal proof digest does not match its canonical body.

## Honest limits

The executable gate does not prove:

- exhaustive responsive or visual-regression quality beyond the Chromium interaction path exercised by `acceptance:ui`;
- a fresh GPT-5.6 or Codex invocation on every CI run;
- append-only integrity against a database administrator;
- a cryptographic signature or external timestamp;
- separate deployed processes for legacy and candidate applications;
- arbitrary external workflows, databases, payment providers, or carrier systems;
- behavioral equivalence outside the six executed scenarios.
