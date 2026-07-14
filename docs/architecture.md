# TraceForge architecture

## Implemented product claim

TraceForge converts observed workflow traces into an evidence-bounded behavior contract, challenges that contract before code generation, builds a replacement candidate in an isolated worktree, and independently verifies the candidate against the legacy oracle.

Its guarantee is intentionally narrow:

> For the seven scenarios listed in a proof bundle, the candidate matched the legacy behavior observed by the host verifier: five business-result fields on successful rows, and five failure-and-atomicity facts on the exhausted-stock row.

TraceForge does not infer that unexecuted behavior, external services, or an arbitrary application are equivalent.

## Runtime pipeline

```text
                         server-owned migration job
                                    │
                                    ▼
  Observe              Infer               Challenge
  legacy traces  ──►   GPT-5.6 rules  ──►  GPT proposals + host execution
  API + SQLite         evidence-linked      counterexamples + boundary search
                                                    │
                                                    ▼
                                              behavior contract
                                                    │
                                                    ▼
                                      all failed candidate proofs
                                      visible scenario corpus only
                                                    │
                                                    ▼
  retained detached worktree  ◄──  Build: Codex repairs complete candidate module
  one-file write allowlist          generic prompt points to immutable JSON inputs
                                    no hidden input / no oracle / no tests / no network
                 │
                 ▼
  legacy oracle ───────────── Verify: host differential suite ───────── candidate
                 │             7 scenarios × 5 assertions               │
                 └────────────────────────┬───────────────────────────────┘
                                          ▼
                     proof + contract + evidence + diff + command log
```

Every stage transition is emitted by the API and persisted before the React client renders it. Server sequence numbers, not timers or browser timestamps, determine ordering and de-duplication.

## Five stages and separation of powers

### 1. Observe

The host executes two operator-observed branches against the standalone legacy module and reads the resulting business state back from SQLite:

- `STANDARD + DAMAGED + 4,500 cents` → refund, sellable `10→10`, quarantine `0→1`;
- `VIP + DAMAGED + 12,000 cents` → replacement, sellable `10→9`, quarantine `0→1`.

The trace pack contains inputs, results, trace IDs, evidence IDs, and digests. The model never receives permission to run the workflow.

### 2. Infer

`BehaviorArchaeologyAdapter` starts a read-only `gpt-5.6-sol` Codex SDK thread with network and Web search disabled. The **Trace Archaeologist** returns schema-constrained hypotheses, invariants, and unknowns. In the canonical run it identified four blocking unknowns.

The host rejects output that cites an evidence ID outside the supplied trace pack. A plausible sentence without a valid evidence reference cannot enter the contract.

### 3. Challenge

The **Counterexample Hunter** proposes one valid input at a time but cannot predict, fabricate, or execute its result. The host validates the input, runs it against the legacy oracle, and adds the fresh trace to the next model call. The host also turns the stock-sufficiency unknown into a visible zero-sellable counterexample; the legacy attempt fails before persistence, with no return record, inventory mutation, or emitted side effect.

After a high-information example reveals manual-review behavior, the host performs deterministic adjacent probes to find the exact `49,999 / 50,000`-cent boundary. It also executes two visible priority checks before the writing turn: `VIP + DAMAGED + 50,000 cents` and `VIP + DAMAGED + 75,000 cents`. The first becomes the final suite's host-derived counterexample; the second bounds the disclosed high-value interval supplied to Codex. The **Contract Critic** then audits every rule and returns one of three dispositions:

- `NEEDS_COUNTEREXAMPLE` — execute another host-owned check;
- `READY_FOR_BUILD` — the evidence supports an ordered contract;
- `STOP_UNSUPPORTED` — stop rather than guess.

The critic must explicitly partition every initial unknown into `resolvedUnknowns` or `remainingUnknowns`, preserving each unknown's blocking metadata and citing evidence for every resolution. The host rejects an incomplete or contradictory partition and forbids `READY_FOR_BUILD` while any in-scope blocking unknown remains. The canonical run moved all `4` initial unknowns into `4` evidence-linked resolutions and left `0` remaining.

The implemented contract gives the high-value review boundary priority over customer-tier handling, requires sellable stock before replacement, and leaves inventory and money untouched while review is pending or a replacement fails.

### 4. Build

The host first runs the seeded candidate and preserves **every** failed proof. `CodexRepairAdapter` accepts exactly three classes of writer-visible input:

1. the GPT-5.6 behavior contract;
2. all failed candidate proofs;
3. only scenarios already disclosed before the writing turn.

For the champion run, those inputs were materialized as immutable `.traceforge/behavior-contract.json`, `.traceforge/failed-proofs.json`, and `.traceforge/visible-scenarios.json`. Their aggregate repair-input digest is `sha256:afe5ac02691e8929f1600f00bf57247b1915da88b759892087deb3b6e81755b8`. The repair input included four failed proofs, including the atomic exhausted-stock failure, plus the disclosed corpus used to bound the repair. It did not contain the final verification-only scenario.

The literal Codex prompt does not embed workflow thresholds, expected decisions, inventory answers, or a final-scenario name. It points to those three JSON artifacts and states the access constraints. The host hashes the inputs before the turn and re-reads and verifies them after the turn; mutation or an extra input file fails the repair.

Codex runs with:

- model `gpt-5.6-sol`;
- a detached worktree retained for inspection;
- workspace write access but no network or Web search;
- exactly one allowed repository path: `apps/api/src/candidates/generated-return-workflow.ts`;
- a structured response schema;
- no authority to inspect the legacy oracle, verifier internals, repository tests, or host-only inputs;
- no authority to install, test, apply, commit, push, merge, deploy, or publish.

The writable unit is a complete replacement workflow module, not a configuration switch. The host collects tracked, staged, untracked, and relevant ignored-path changes before accepting the diff.

The champion build used Codex thread `019f5244-7bef-71f2-8f25-8ed1446a539e` from base commit `eb0e6169974b96bd3bff3b536b38ef5f665127c2` and changed only the allowed module. The host, not Codex, then performed the offline install and verification.

### 5. Verify

Only after the Codex SDK turn has returned does the host create fresh entropy and materialize the concrete final verification input. The input never exists in the prompt, immutable artifacts, or worktree during the writing turn. Public surfaces call it **verification-only**; the proof schema retains the internal partition value `held-out` for compatibility.

The host then performs an offline frozen install, runs `56/56` candidate-safe API tests, and executes the generated candidate suite. Four replay-only tests are deliberately skipped inside the candidate worktree: replay source-digest enforcement, replay pacing, recorded replay provenance, and invocation-manifest consistency. They are release guards for the repository runtime, not tests the candidate is allowed to inspect or satisfy during its writing turn.

Each scenario resets the isolated `legacy` and `replacement` SQLite partitions. Successful rows compare five fields:

1. decision;
2. return status;
3. refund amount in cents;
4. final sellable quantity;
5. final quarantine quantity.

The exhausted-stock row has a different five-assertion contract: both executions must fail; code and message must match; no return record may exist; inventory must remain unchanged; and the workflow must emit zero side effects. It is not scored as a successful return with null result fields.

The seven-scenario suite contains six visible rows plus one verification-only row:

| Partition | Scenario |
|---|---|
| Observed | standard damaged return at 4,500 cents |
| Observed | VIP damaged return at 12,000 cents |
| Counterexample | VIP damaged return at 50,000 cents |
| Counterexample | VIP damaged return at 12,000 cents with zero sellable stock; atomic failure required |
| Boundary | standard damaged return at 49,999 cents |
| Boundary | standard damaged return at 50,000 cents |
| Verification-only | `host-hidden-252b1708e9e9`, materialized after the Codex turn |

The last row names the concrete scenario from this run; it is not a claim that all future verification-only inputs have that identity or value. Every scenario must produce a fresh run ID, proof ID, trace pair, and proof digest. A failed proof remains inspectable, but the migration reaches `passed` only if all seven runs pass with zero mismatches. The champion run produced `7/7` passing scenarios, `35/35` deterministic assertions, and zero mismatches.

## Three execution modes

The caller must choose a mode in `POST /api/migrations`. The server never silently changes it.

### `live-ai`

Runs fresh GPT-5.6 archaeology, host-owned counterexamples, Codex repair, and host verification. Both `TRACEFORGE_ENABLE_GPT56=1` and `TRACEFORGE_ENABLE_CODEX=1` are required. A missing adapter or failed stage ends the job without producing a substitute proof.

### `recorded-replay`

Replays the captured inference and build events from a real model run, preserving original thread IDs, model ID, source run ID, timestamp, and a visible replay disclosure. No model call occurs during playback. Before emitting the replay, the host reads the candidate source format the current runtime will actually execute (`.ts` in source mode or built `.js` in distribution mode) and compares it with the corresponding recorded executable-source digest. A mismatch stops the job with `RECORDED_CANDIDATE_SOURCE_MISMATCH`; no stale replay or fallback proof is substituted. The current host then executes the seven-scenario differential suite and issues fresh artifacts for the replay job.

### `deterministic-only`

Skips Infer, Challenge, and Build, marks those stages as skipped, and runs only the current candidate through the host verifier. Its proof contains no model invocations and adds a limitation stating that no GPT-5.6 or Codex execution is represented.

## API, events, and storage

```text
POST /api/migrations
GET  /api/migrations/:id
GET  /api/migrations/:id/events
GET  /api/migrations/:id/proof
GET  /api/migrations/:id/artifacts
GET  /api/migrations/:id/downloads/:filename
POST /api/proofs/verify-digest
```

`GET /events` returns either Server-Sent Events or JSON. Clients can resume from a server sequence with `Last-Event-ID` or `?after=`. Each event records stage, actor, live/recorded origin, status, evidence and artifact links, payload, and a SHA-256 digest.

The migration endpoint does not offer arbitrary scenario selection. `scenarioIds` must be omitted or contain the complete six-scenario disclosed corpus exactly once; partial, duplicate, mixed-type, and unknown sets fail with `INVALID_SCENARIO_SET`. The server normalizes that set to canonical order. Before issuing a proof it checks that those six disclosed scenarios and exactly one newly materialized verification-only scenario were executed. Every migration scenario persists the digest of its underlying deterministic proof. `scenarioSetDigest` hashes the ordered `{scenarioId, partition, proofDigest}` entries—not IDs alone—so changing proof content beneath an unchanged scenario name changes the set digest. The terminal job, `verification.scope.bound` event, and proof expose the same scenario set and digest.

`MigrationStore` uses SQLite WAL mode. Event rows are inserted with a `(migration_id, sequence)` primary key; migration artifact rows are inserted with unique IDs. A completed run exposes:

- `contract.json` — ordered rules plus initial, resolved, and remaining unknowns;
- `evidence.jsonl` — persisted migration events available when the artifact is issued;
- `candidate.diff` — the accepted module diff, or an explicit no-model marker;
- `commands.json` — host verification command summaries;
- `proof.json` — coverage, model provenance, candidate provenance, scenario results, limitations, and an internal digest.

Downloads include an `X-Content-SHA256` header. The proof's internal digest can be recomputed through `POST /api/proofs/verify-digest`. On the command line, `pnpm proof:verify-current <proof.json>` validates both the canonical object digest and the current schema, including coverage and `scenarioSetDigest`. `pnpm proof:verify-integrity <historical-proof.json>` has the narrower, explicitly named purpose of checking an older object's canonical digest without asserting that it has today's fields.

The unauthenticated showcase has bounded resource use at the application layer: by default one client may make ten migration-start attempts per rolling minute, two jobs may run concurrently, and four more may wait. Additional work fails with `429 MIGRATION_RATE_LIMITED` or `503 MIGRATION_CAPACITY_EXCEEDED` instead of creating an unbounded queue. Terminal jobs, events, and artifacts are pruned together after 72 hours or beyond the newest 100 completed jobs. All limits are configurable through the `TRACEFORGE_MIGRATION_*` and `TRACEFORGE_RETENTION_*` variables documented in `deploy/traceforge.env.example`.

## Evidence and provenance

The checked-in [champion evidence directory](evidence/live-champion-run/README.md) is the export of live migration `migration_efaa0383-628a-4fba-94df-96bfe344bcbe`, backed by four real GPT-5.6 Sol archaeology threads and the real Codex build thread above. It includes the raw redacted model invocations, immutable Codex input artifacts, accepted source and diff, host command logs, and the proof bundle. Its untouched historical proof reports `7/7` scenarios, `35/35` assertions, zero mismatches, and digest:

```text
sha256:4be44d476f222ca492d025a13f296997148142471e2387d532c61479bc3703bc
```

That source proof was issued before `scenarioSetDigest` became a required runtime field. TraceForge does not silently rewrite it into the new schema. [`source-run-envelope-v2.json`](evidence/live-champion-run/source-run-envelope-v2.json) is a derived companion that binds the original proof's canonical digest and exact serialized bytes to the raw-file digest of the checked-in [`recorded-codex-build.generated.json`](../apps/api/src/recorded-codex-build.generated.json). The verifier parses exactly one successful final suite from that artifact and requires the envelope's seven ordered `{scenarioId, partition, proofDigest}` entries to match it byte-for-byte at the value level before recomputing `scenarioSetDigest`. It also cross-checks source-run identity and the `56/56` candidate-safe plus four separate replay-guard split against both historical artifacts. `pnpm proof:verify-envelope` validates those links; fresh hardened proofs use `pnpm proof:verify-current`.

The historical proof digest covers its canonical JSON body. The envelope has its own canonical digest. Artifact metadata has a separate digest computed by the same canonical digest helper over the artifact body string; these values serve different purposes and are intentionally not conflated.

## Current limitations

- The legacy oracle and replacement are separate modules but execute in one TypeScript API process.
- The example is a controlled returns laboratory, not browser capture of an unfamiliar third-party application.
- The supported state surface is REST plus SQLite; external payment settlement and carrier systems are not executed.
- SHA-256 detects accidental or visible tampering when a trusted digest is available, but artifacts are not signed and a database administrator can rewrite local storage.
- Migration jobs are not an authenticated multi-tenant production queue and have no cancellation, durable cross-process scheduling, per-account quota, or human approval workflow. The showcase limits protect availability; they are not tenant isolation.
- The seven executed scenarios support only the bounded claim in the proof; they do not establish universal behavioral equivalence.
