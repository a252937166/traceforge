# TraceForge architecture

## Product claim

TraceForge compiles observed workflow behavior into a replacement application and a reviewable proof bundle. Its guarantee is deliberately bounded:

> For each executed scenario, the replacement produced the asserted API results and business-state transitions recorded by the verifier.

It does not infer that unobserved behavior is equivalent.

## Runtime pipeline

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

### 1. Behavior archaeology — planned GPT-5.6 integration

The Responses API Multi-agent beta will be limited to three read-only roles:

- **Trace archaeologist:** proposes rules and cites evidence IDs.
- **Counterexample hunter:** generates the smallest scenario that separates competing rules.
- **Contract critic:** labels ambiguity, missing coverage, and unsafe assumptions.

The agents cannot write application code or mark verification as passed. Structured output is validated before it enters the behavior contract.

### 2. Candidate builder — planned Codex SDK integration

One Codex session receives the reviewed contract and works in an isolated git worktree. It may edit only the replacement application and tests. Its output is a candidate diff, not an accepted fix.

### 3. Differential verifier — implemented first

The verifier resets the fixture, executes the same scenario against both systems, and compares:

- HTTP status and normalized response fields;
- return disposition and refund amount;
- inventory bucket deltas;
- approval records and audit events;
- declared invariants.

It runs outside the code-writing session. A failure remains failed until a new candidate passes a fresh reset-and-run cycle.

## Evidence model

Every conclusion points to an immutable `evidenceId` with:

- source type (`ui`, `http`, `entity-before`, `entity-after`, `assertion`);
- scenario and step IDs;
- timestamp and content digest;
- redacted payload or local artifact reference.

Rules include confidence, supporting evidence, counterevidence, and a coverage boundary. Unknowns are first-class contract entries rather than guessed defaults.

## Current implementation versus planned capability

| Capability | Status |
|---|---|
| Legacy and replacement returns workflow | In this MVP |
| SQLite state reset and deterministic scenarios | In this MVP |
| Evidence IDs and proof bundle | In this MVP |
| Seeded mutation caught by external verifier | In this MVP |
| GPT-5.6 rule extraction | Planned adapter; requires official access |
| Codex SDK candidate generation | Planned adapter; never simulated as live |
| Browser capture of an arbitrary third-party app | Stretch |
| General proof for arbitrary software | Explicitly out of scope |

