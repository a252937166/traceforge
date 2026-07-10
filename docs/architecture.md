# TraceForge architecture

## Target product claim

TraceForge compiles observed workflow behavior into a replacement application and a reviewable proof bundle. Its guarantee is deliberately bounded:

> For each executed scenario, the replacement produced the asserted API results and business-state transitions recorded by the verifier.

It does not infer that unobserved behavior is equivalent.

The current MVP does not yet reconstruct an arbitrary application from browser capture. It exercises a synthetic legacy reference and separately coded candidate in one TypeScript service, records their SQLite-backed state transitions, and proves five concrete outcome fields for one controlled returns scenario.

## Target runtime pipeline

```text
operator action
      │
      ▼
capture envelope ──► evidence store ──► behavior contract
  UI / API / DB          immutable IDs      rules + unknowns
                                               │
                                               ▼
                              isolated candidate worktree
                              Codex SDK is sole writer
                                               │
                                               ▼
legacy runner ───────────── differential verifier ───────── replacement runner
                              │ deterministic assertions
                              │ optional vision checks
                              ▼
                         proof bundle
```

## Separation of powers

## Current executable pipeline

```text
POST controlled scenario
        │
        ├──► in-process legacy reference ──► SQLite rows partitioned as legacy
        │
        └──► replacement candidate ────────► SQLite rows partitioned as replacement
                                                    │
                                                    ▼
                           deterministic contract + five field assertions
                                                    │
                                                    ▼
                               evidence-linked proof bundle with SHA-256 digest
```

The React workbench is a staged visualization of these traces, not a recording of two external user interfaces.

### 1. Behavior archaeology — planned GPT-5.6 integration

The Responses API Multi-agent beta will be limited to three read-only roles:

- **Trace archaeologist:** proposes rules and cites evidence IDs.
- **Counterexample hunter:** generates the smallest scenario that separates competing rules.
- **Contract critic:** labels ambiguity, missing coverage, and unsafe assumptions.

The agents cannot write application code or mark verification as passed. Structured output is validated before it enters the behavior contract.

### 2. Candidate builder — implemented opt-in Codex SDK adapter

When explicitly enabled, one Codex SDK thread receives the failed proof and works in a retained detached git worktree. It may edit only `apps/api/src/candidates/generated-repair.ts`. The host enforces the allowlist, performs an offline install, runs API tests, runs the generated-candidate verifier, and returns a candidate diff plus evidence. Nothing is automatically applied, committed, pushed, deployed, or published.

A real local SDK attempt has passed this boundary. Its evidence is in [evidence/codex-repair-run.md](evidence/codex-repair-run.md). The exact underlying model name was not exposed by the recorded result, so the repository does not label that turn as GPT-5.6.

### 3. Differential verifier — implemented first

The verifier resets the fixture, executes the same scenario against both in-process workflow paths, and compares:

- decision;
- return status;
- refund amount in cents;
- final sellable quantity;
- final quarantine quantity.

It is implemented in the same API service but runs outside the code-writing session. A failure remains failed until a new candidate passes a fresh reset-and-run cycle with new run and proof IDs.

## Evidence model

Captured events receive random `evidenceId` values and stable content digests. Current event types include implementation selection, input capture, state before/after, applied rule, recorded decision, side effects, repair configuration, and database round-trip. Proof bundles link assertion rows back to legacy and candidate evidence IDs.

The SQLite artifact store currently permits replacement by ID; append-only enforcement and signed proof bundles remain future work. Rules currently contain confidence and supporting evidence IDs. Counterevidence, structured uncertainty, and redaction before model calls are planned rather than shipped.

## Current implementation versus planned capability

| Capability | Status |
|---|---|
| Legacy and replacement returns workflow | In this MVP |
| SQLite state reset and deterministic scenarios | In this MVP |
| Evidence IDs and proof bundle | In this MVP |
| Seeded mutation caught by external verifier | In this MVP |
| GPT-5.6 rule extraction | Not implemented; deterministic extractor is clearly labelled |
| Codex SDK candidate repair | Opt-in adapter implemented; one real local passing run evidenced |
| One-file allowlist and retained worktree | Implemented |
| Automatic apply, push, PR, or deploy | Deliberately not implemented |
| Browser capture of an arbitrary third-party app | Stretch |
| General proof for arbitrary software | Explicitly out of scope |
