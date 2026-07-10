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
  retained detached worktree  ◄──  Build: Codex repairs complete candidate module
  one-file write allowlist          no network / no apply / no commit / no deploy
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

After a high-information example reveals manual-review behavior, the host performs deterministic adjacent probes to find the exact `49,999 / 50,000`-cent boundary. The **Contract Critic** then audits every rule and returns one of three dispositions:

- `NEEDS_COUNTEREXAMPLE` — execute another host-owned check;
- `READY_FOR_BUILD` — the evidence supports an ordered contract;
- `STOP_UNSUPPORTED` — stop rather than guess.

The implemented contract gives the high-value review boundary priority over customer-tier handling and leaves inventory and money untouched while review is pending.

### 4. Build

The host first runs the seeded candidate and records its rejection. It then passes an existing failed proof to `CodexRepairAdapter`.

Codex runs with:

- model `gpt-5.6-sol`;
- a detached worktree retained for inspection;
- workspace write access but no network or Web search;
- exactly one allowed repository path: `apps/api/src/candidates/generated-return-workflow.ts`;
- a structured response schema;
- no authority to install, test, apply, commit, push, merge, deploy, or publish.

The writable unit is a complete replacement workflow module, not a configuration switch. The host collects tracked, staged, untracked, and relevant ignored-path changes before accepting the diff.

The recorded champion build used Codex thread `019f4d12-9228-78c1-95fc-3a13d8e1919f` from base commit `899ff7ac5f6151b58129559a1d760177a1243136` and changed only the allowed module.

### 5. Verify

After the model turn ends, the host performs an offline frozen install, runs the API tests, and executes the generated candidate suite. Each scenario resets the isolated `legacy` and `replacement` SQLite partitions and compares five fields:

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
| Counterexample | standard damaged return at 100,000 cents |
| Boundary | standard damaged return at 49,999 cents |
| Boundary | standard damaged return at 50,000 cents |
| Held out | VIP damaged return at 50,000 cents |

Every scenario must produce a fresh run ID, proof ID, trace pair, and proof digest. A failed proof remains inspectable, but the migration reaches `passed` only if all six runs pass with zero mismatches.

## Three execution modes

The caller must choose a mode in `POST /api/migrations`. The server never silently changes it.

### `live-ai`

Runs fresh GPT-5.6 archaeology, host-owned counterexamples, Codex repair, and host verification. Both `TRACEFORGE_ENABLE_GPT56=1` and `TRACEFORGE_ENABLE_CODEX=1` are required. A missing adapter or failed stage ends the job without producing a substitute proof.

### `recorded-replay`

Replays the captured inference and build events from a real model run, preserving original thread IDs, model ID, source run ID, timestamp, and a visible replay disclosure. No model call occurs during playback. The current host still executes the six-scenario differential suite and issues fresh artifacts for the replay job.

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

The checked-in [champion evidence directory](evidence/live-champion-run/README.md) contains a recorded-replay export backed by four real GPT-5.6 Sol archaeology threads and one real Codex build thread. Its proof reports `6/6` scenarios passed and digest:

```text
sha256:9c4bf000d0b9ae67ef311cb93dd97cf43df914412fdee51f8d6f8ebce59f5fb2
```

The proof digest covers its canonical JSON body. Artifact metadata has a separate digest computed by the same canonical digest helper over the artifact body string; these values serve different purposes and are intentionally not conflated.

## Current limitations

- The legacy oracle and replacement are separate modules but execute in one TypeScript API process.
- The example is a controlled returns laboratory, not browser capture of an unfamiliar third-party application.
- The supported state surface is REST plus SQLite; external payment settlement and carrier systems are not executed.
- SHA-256 detects accidental or visible tampering when a trusted digest is available, but artifacts are not signed and a database administrator can rewrite local storage.
- Migration jobs are not a multi-tenant production queue and have no rate-limiting or human approval workflow.
- The six executed scenarios support only the bounded claim in the proof; they do not establish universal behavioral equivalence.
