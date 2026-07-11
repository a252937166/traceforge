# TraceForge architecture

## Implemented product claim

TraceForge converts observed workflow traces into an evidence-bounded behavior contract, challenges that contract before code generation, builds a replacement candidate in an isolated worktree, and independently verifies the candidate against the legacy oracle.

Its guarantee is intentionally narrow:

> For the six scenarios listed in a proof bundle, the candidate matched the legacy decision, return status, refund amount, sellable quantity, and quarantine quantity observed by the host verifier.

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
                 │             6 scenarios × 5 assertions               │
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

`BehaviorArchaeologyAdapter` starts a read-only `gpt-5.6-sol` Codex SDK thread with network and Web search disabled. The **Trace Archaeologist** returns schema-constrained hypotheses, invariants, and unknowns.

The host rejects output that cites an evidence ID outside the supplied trace pack. A plausible sentence without a valid evidence reference cannot enter the contract.

### 3. Challenge

The **Counterexample Hunter** proposes one valid input at a time but cannot predict, fabricate, or execute its result. The host validates the input, runs it against the legacy oracle, and adds the fresh trace to the next model call.

After a high-information example reveals manual-review behavior, the host performs deterministic adjacent probes to find the exact `49,999 / 50,000`-cent boundary. It also executes two visible priority checks before the writing turn: `VIP + DAMAGED + 50,000 cents` and `VIP + DAMAGED + 75,000 cents`. The first becomes the final suite's host-derived counterexample; the second bounds the disclosed high-value interval supplied to Codex. The **Contract Critic** then audits every rule and returns one of three dispositions:

- `NEEDS_COUNTEREXAMPLE` — execute another host-owned check;
- `READY_FOR_BUILD` — the evidence supports an ordered contract;
- `STOP_UNSUPPORTED` — stop rather than guess.

The implemented contract gives the high-value review boundary priority over customer-tier handling and leaves inventory and money untouched while review is pending.

### 4. Build

The host first runs the seeded candidate and preserves **every** failed proof. `CodexRepairAdapter` accepts exactly three classes of writer-visible input:

1. the GPT-5.6 behavior contract;
2. all failed candidate proofs;
3. only scenarios already disclosed before the writing turn.

For the champion run, those inputs were materialized as immutable `.traceforge/behavior-contract.json`, `.traceforge/failed-proofs.json`, and `.traceforge/visible-scenarios.json`. Their aggregate repair-input digest is `sha256:aea099f69b03e2a1905443eb4ff7044813c11d50248d8e31eadb6b8fa80c3542`. The visible corpus contained the two observations, the `VIP + DAMAGED + 50,000` counterexample, the two exact STANDARD boundary cases, and the disclosed `VIP + DAMAGED + 75,000` trace. It did not contain the final verification-only scenario.

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

The champion build used Codex thread `019f4fd8-5408-7752-b8fa-f8c6b08b33ef` from base commit `7c1dceeaee7f375beb8d2895fda502f2ad74e039` and changed only the allowed module. The host, not Codex, then performed the offline install and verification.

### 5. Verify

Only after the Codex SDK turn has returned does the host create fresh entropy and materialize the concrete final verification input. The input never exists in the prompt, immutable artifacts, or worktree during the writing turn. Public surfaces call it **verification-only**; the proof schema retains the internal partition value `held-out` for compatibility.

The host then performs an offline frozen install, runs `42/42` candidate-safe API tests, and executes the generated candidate suite. Four replay-only tests are deliberately skipped inside the candidate worktree: replay source-digest enforcement, replay pacing, recorded replay provenance, and invocation-manifest consistency. They are release guards for the repository runtime, not tests the candidate is allowed to inspect or satisfy during its writing turn.

Each scenario resets the isolated `legacy` and `replacement` SQLite partitions and compares five fields:

1. decision;
2. return status;
3. refund amount in cents;
4. final sellable quantity;
5. final quarantine quantity.

The six-scenario suite contains:

| Partition | Scenario |
|---|---|
| Observed | standard damaged return at 4,500 cents |
| Observed | VIP damaged return at 12,000 cents |
| Counterexample | VIP damaged return at 50,000 cents |
| Boundary | standard damaged return at 49,999 cents |
| Boundary | standard damaged return at 50,000 cents |
| Verification-only | `host-hidden-831ee69e3cd9`, materialized after the Codex turn |

The last row names the concrete scenario from this run; it is not a claim that all future verification-only inputs have that identity or value. Every scenario must produce a fresh run ID, proof ID, trace pair, and proof digest. A failed proof remains inspectable, but the migration reaches `passed` only if all six runs pass with zero mismatches. The champion run produced `6/6` passing scenarios, `30/30` field assertions, and zero mismatches.

## Three execution modes

The caller must choose a mode in `POST /api/migrations`. The server never silently changes it.

### `live-ai`

Runs fresh GPT-5.6 archaeology, host-owned counterexamples, Codex repair, and host verification. Both `TRACEFORGE_ENABLE_GPT56=1` and `TRACEFORGE_ENABLE_CODEX=1` are required. A missing adapter or failed stage ends the job without producing a substitute proof.

### `recorded-replay`

Replays the captured inference and build events from a real model run, preserving original thread IDs, model ID, source run ID, timestamp, and a visible replay disclosure. No model call occurs during playback. Before emitting the replay, the host reads the candidate source format the current runtime will actually execute (`.ts` in source mode or built `.js` in distribution mode) and compares it with the corresponding recorded executable-source digest. A mismatch stops the job with `RECORDED_CANDIDATE_SOURCE_MISMATCH`; no stale replay or fallback proof is substituted. The current host then executes the six-scenario differential suite and issues fresh artifacts for the replay job.

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

`MigrationStore` uses SQLite WAL mode. Event rows are inserted with a `(migration_id, sequence)` primary key; migration artifact rows are inserted with unique IDs. A completed run exposes:

- `contract.json` — ordered rules and explicit unknowns;
- `evidence.jsonl` — persisted migration events available when the artifact is issued;
- `candidate.diff` — the accepted module diff, or an explicit no-model marker;
- `commands.json` — host verification command summaries;
- `proof.json` — coverage, model provenance, candidate provenance, scenario results, limitations, and an internal digest.

Downloads include an `X-Content-SHA256` header. The proof's internal digest can be recomputed through `POST /api/proofs/verify-digest` or `pnpm proof:verify <proof.json>`.

## Evidence and provenance

The checked-in [champion evidence directory](evidence/live-champion-run/README.md) is the export of live migration `migration_77f7a45d-a07f-43c6-a0bd-cf4555ed7996`, backed by four real GPT-5.6 Sol archaeology threads and the real Codex build thread above. It includes the raw redacted model invocations, immutable Codex input artifacts, accepted source and diff, host command logs, and the proof bundle. Its proof reports `6/6` scenarios passed and digest:

```text
sha256:4ff6eba63043e50052cab81a6adab5a7a6c49d1bcb19a93c42bee25453a13241
```

The proof digest covers its canonical JSON body. Artifact metadata has a separate digest computed by the same canonical digest helper over the artifact body string; these values serve different purposes and are intentionally not conflated.

## Current limitations

- The legacy oracle and replacement are separate modules but execute in one TypeScript API process.
- The example is a controlled returns laboratory, not browser capture of an unfamiliar third-party application.
- The supported state surface is REST plus SQLite; external payment settlement and carrier systems are not executed.
- SHA-256 detects accidental or visible tampering when a trusted digest is available, but artifacts are not signed and a database administrator can rewrite local storage.
- Migration jobs are not a multi-tenant production queue and have no rate-limiting or human approval workflow.
- The six executed scenarios support only the bounded claim in the proof; they do not establish universal behavioral equivalence.
