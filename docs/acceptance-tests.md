# TraceForge MVP acceptance tests

## Purpose

This document is the executable acceptance contract for the TraceForge returns-workflow MVP. It is a specification, not a claim that the current repository already passes the tests.

The release gate is:

```bash
pnpm acceptance:all
```

That command must start from deterministic fixtures, exercise real legacy and replacement application paths, run the API and browser checks below, and exit non-zero if any required case fails. A seeded mutation is expected to produce a **failed proof**; the mutation acceptance command succeeds only when that failure is detected and preserved.

The bounded product claim remains:

> For each executed scenario, the replacement produced the asserted API results and business-state transitions recorded by the verifier.

No acceptance result may be presented as proof about unexecuted behavior.

## Fixed acceptance fixture

All required cases use one versioned fixture so that failures are reproducible.

| Item | Required value |
|---|---|
| Contract | Fresh `contract_<uuid>` derived from the legacy trace |
| Scenario | `damaged-small-refund` |
| Rule under test | `RULE-DAMAGED-DISPOSITION` |
| Return | `RET-1001`, damaged, refund amount `45.00` |
| Initial inventory | sellable `10`, quarantine `0` |
| Correct result | HTTP `201` from the run API; status `REFUNDED`; refund `45.00`; sellable delta `0`; quarantine delta `+1` |
| Seeded mutation | `restore_damaged_to_sellable` affects the replacement only |
| Mutated result | replacement sellable delta `+1` and quarantine delta `0` |

The fixture reset must create separate legacy and replacement state stores from the same seed. A reset is required before every scenario execution; copying the legacy database after execution is not a valid replacement run.

## Target definition of a live run

A run is `live` only when all of the following are true:

1. The legacy and replacement have distinct implementation identities and isolated SQLite state partitions. Separate database files remain a hardening step beyond this first MVP.
2. The public run API invokes each application adapter independently; a later hardening step may move those adapters behind separate HTTP processes.
3. Each application performs its own disposition logic and commits its own database transaction.
4. Before and after state is read back from SQLite after each operation completes.
5. Assertion values are computed from those observed responses and states, not copied from fixture JSON or a stored proof bundle.
6. The run receives a new run ID and new evidence IDs.

The two adapters may share a host process for the MVP, but they must not share the business handler, mutable database, or result object. A spy must demonstrate that both application paths were invoked exactly once for the scenario.

## Required command surface

The implementation must expose these scripts. They may call Vitest, integration-test helpers, and Playwright internally.

```bash
pnpm acceptance:api -- --mode baseline
pnpm acceptance:api -- --mode mutation
pnpm acceptance:ui
pnpm acceptance:repeat -- --runs 10
pnpm acceptance:all
```

Command rules:

- `baseline` exits zero only when the independently executed systems conform for the fixed scenario.
- `mutation` exits zero only when the verifier emits a `failed` proof for the expected deterministic mismatch. A passed or inconclusive proof fails the command.
- `ui` must run against a started API; network responses may not be mocked for the live-path test.
- `repeat` compares normalized semantic results across clean resets. Run IDs, timestamps, and bundle digests are expected to differ.
- `all` runs schema, API, mutation, retention, UI, and repeatability gates.

## API response and provenance boundary

The proof bundle must validate unchanged against `docs/proof-bundle.schema.json`, which has `additionalProperties: false`. Runtime provenance therefore belongs in an API envelope, not as an undeclared proof-bundle field:

```json
{
  "source": "live",
  "proofBundle": {},
  "evidenceBaseUrl": "/api/runs/<runId>/evidence"
}
```

Accepted source values and meanings:

| Source | Meaning | Presentation requirement |
|---|---|---|
| `live` | Both applications executed now and produced fresh evidence | Persistent `LIVE RUN` badge |
| `sample` | Static or prerecorded example data | Persistent `SAMPLE DATA` badge and visible fallback reason |
| `preview` | Initial explanatory UI before execution | Must not display a passed/proven verdict |

A malformed or incomplete API response must never be normalized with sample evidence and labeled `live`. It must either fail visibly or switch the entire view to `sample` with the reason shown.

## Verdict derivation

Verdicts are derived by the verifier, never accepted from either target application.

- A scenario is `failed` when any deterministic assertion has `passed: false`.
- A scenario is `inconclusive` when required evidence is missing, corrupt, or cannot be compared.
- A scenario is `passed` only when every required assertion passed and all referenced evidence resolves.
- The run verdict precedence is `failed` over `inconclusive` over `passed`.
- The seeded inventory mutation must be `failed`, not `inconclusive`.

## Acceptance matrix

| ID | Gate | Execution | Required assertions |
|---|---|---|---|
| `ENV-001` | Clean bootstrap | Install dependencies, build, create fixtures, and start API plus web from a clean checkout. | No undeclared manual setup; health endpoints become ready; fixture versions are recorded in test output. |
| `SYS-001` | Real legacy execution | Reset the legacy partition and execute the damaged-return command through the legacy adapter. | Invocation count is `1`; legacy DB changes from sellable `10`/quarantine `0` to `10`/`1`; return becomes `REFUNDED`; trace evidence exists. |
| `SYS-002` | Real replacement execution | Reset the replacement partition and execute the same command through the replacement adapter. | A distinct implementation identity and state partition are reported; invocation count is `1`; the fixed reference independently reaches the same API and DB outcome. |
| `ISO-001` | State isolation | Execute legacy only, inspect replacement DB, then execute replacement only and inspect legacy DB. | Running either target does not change the other target's database, transaction log, or evidence namespace. |
| `VER-001` | Baseline differential pass | `pnpm acceptance:api -- --mode baseline` | Proof bundle verdict is `passed`; all scenario assertions are true; legacy and replacement values are present rather than summarized away. |
| `MUT-001` | Seeded mutation is caught | Enable `restore_damaged_to_sellable` for the replacement and run `pnpm acceptance:api -- --mode mutation`. | Legacy stays correct; replacement is wrong; inventory assertion is false; scenario and run verdicts are `failed`; process-level acceptance test exits zero because rejection was expected. |
| `MUT-002` | Verifier independence | Hash verifier, fixture, contract, schemas, and legacy implementation before and after `MUT-001`. | Only the replacement mutation surface differs. The mutation cannot edit expected values, suppress evidence, or change verdict logic. |
| `FIX-001` | Fresh repair rerun | Disable/fix the mutation, reset both stores, and execute a new baseline run. | A new run ID is produced; all assertions pass; no evidence item from the failed run is reused as fresh evidence. |
| `SCH-001` | Behavior contract schema | Validate the contract with JSON Schema draft 2020-12 and format support. | Contract passes `docs/behavior-contract.schema.json`; every evidence reference matches `^ev_`; scenario and rule IDs are unique. |
| `SCH-002` | Proof schema | Validate passed, failed, and inconclusive fixtures. | Each bundle passes `docs/proof-bundle.schema.json`; intentionally missing required properties or invalid evidence IDs are rejected. |
| `TRC-001` | Contract-to-proof trace | Resolve `proof.contractId`, scenario IDs, rule coverage, and evidence IDs against the contract and evidence store. | No dangling contract, scenario, rule, or evidence reference; unexercised rules and unresolved unknowns remain explicitly listed. |
| `TRC-002` | Evidence integrity | Fetch every evidence ID used by the fixed scenario and recompute its content digest. | Evidence contains source type, scenario ID, step ID, timestamp, redacted payload/artifact reference, and matching digest; altered payloads fail validation. |
| `TRC-003` | Assertion drill-down | Open each assertion from the proof console. | UI resolves to the exact legacy/replacement HTTP or entity snapshots used for that assertion. If only scenario-level linkage exists, UI says `scenario evidence` and does not imply per-assertion provenance. |
| `DIG-001` | Bundle integrity | Recursively sort object keys, serialize the bundle without its `digest` field as JSON, then SHA-256 hash it. | Computed value equals `proof.digest`; modifying an assertion, verdict, mismatch, limitation, or evidence reference invalidates it. |
| `SRC-001` | Honest live label | Run the UI against a healthy API and execute the fixed scenario. | `LIVE RUN` is visible before showing results; API envelope says `live`; new IDs and fresh target evidence exist; no sample values are substituted. |
| `SRC-002` | Honest sample fallback | Stop the API or force timeout, then request a run. | UI shows `SAMPLE DATA` and the fallback reason; it never shows `LIVE RUN`; sample proof cannot be described as newly verified. |
| `SRC-003` | Malformed live response | Return HTTP `200` with missing evidence or invalid proof data. | UI rejects the response or switches wholly to labeled sample mode. It must not combine live metadata with sample evidence. |
| `API-001` | API end-to-end | POST the live run endpoint without test mocks, then GET the stored run, bundle, and each evidence item. | POST result and subsequent GETs agree byte-for-byte after canonicalization; target HTTP and DB evidence are present; unknown run/evidence IDs return `404`. |
| `API-002` | Failure API end-to-end | Execute the mutation through the same public API used by the UI. | API returns a completed run whose proof verdict is `failed`; HTTP transport success must not be confused with proof success. |
| `UI-001` | Browser baseline | In a clean browser, start the live run and wait for completion. | UI shows both target executions, a bounded `covered scenarios passed` result, run ID, contract ID, and downloadable proof bundle. |
| `UI-002` | Browser mismatch | Enable the mutation and start the run in the browser. | Mismatch appears before any repaired state; failed assertion shows both values; clicking it opens matching evidence; UI does not advance to `proven`. |
| `UI-003` | Historical failure remains visible | After `UI-002`, execute `FIX-001`, refresh, and revisit the failed run. | The new run passes, while the earlier failed run remains addressable with its original evidence and digest. |
| `REP-001` | Ten-run repeatability | `pnpm acceptance:repeat -- --runs 10` with a reset before every run. | All ten normalized scenario assertions, values, verdicts, and coverage sets are identical; every run/evidence ID is unique; no flaky/inconclusive run occurs. |
| `REP-002` | Order independence | Run the full deterministic scenario set in declared, reverse, and seeded-random order. | Normalized per-scenario outcomes are identical and no scenario consumes state left by a prior scenario. |
| `RET-001` | Failed proof retention | Capture IDs for baseline-pass, mutation-fail, and repaired-pass runs; restart the API. | All three runs, bundles, and evidence trees remain retrievable; later success does not overwrite or delete failure evidence. |
| `RET-002` | Append-only evidence | Attempt to write a second payload under an existing evidence ID and to replace a stored proof digest. | Both operations are rejected; evidence is immutable after publication. |

## Normalized repeatability comparison

`REP-001` and `REP-002` compare only semantic output:

- run verdict;
- scenario IDs and verdicts;
- assertion paths, legacy values, replacement values, and booleans;
- exercised/unexercised rule sets and unknown sets;
- evidence source types and business payloads after removal of generated IDs and timestamps.

They intentionally ignore `runId`, timestamps, evidence IDs, artifact paths containing a run ID, and the top-level bundle digest. Those values must be fresh per run.

Money values must use a fixed decimal representation, timestamps UTC ISO-8601, database reads an explicit ordering, and JSON objects canonical key ordering before hashing.

## Required failure artifacts

When any acceptance case fails, the harness must retain enough information to reproduce the failure:

- acceptance case ID and random seed, if any;
- fixture and application version/digest;
- target base URLs and redacted configuration;
- legacy and replacement request/response evidence;
- before/after entity snapshots;
- assertion diff;
- proof bundle, including failed or inconclusive verdict;
- browser screenshot and trace for UI cases;
- stdout/stderr and process exit codes.

Artifacts are stored under a unique run namespace and are never replaced by a later retry. A retry creates a new run linked to the preceding run; it does not turn the original failed record green.

## Release-blocking conditions

The MVP is not acceptable if any of the following is true:

- the “legacy” result is a fixture object rather than an executed application response;
- legacy and replacement share mutable state or a result-producing business handler;
- the seeded mutation passes, becomes inconclusive, or is hidden by normalization;
- a proof references missing or mutable evidence;
- the UI silently falls back to sample data while retaining a live/proven label;
- API-only checks pass but the judge-facing browser path does not complete;
- repeated clean runs produce different business outcomes;
- a repaired pass overwrites the prior failed proof;
- the UI claims complete system equivalence instead of bounded scenario conformance.
