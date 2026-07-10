# Threat model and trust boundaries

TraceForge separates observation, model inference, code writing, and verification so that no AI role can both create and certify the same claim. This document describes the controls implemented in the current returns-workflow laboratory and the risks that remain.

## Trust boundary summary

| Component | May read | May write or execute | May declare a pass |
|---|---|---|---|
| GPT-5.6 Trace Archaeologist | Supplied trace pack | Schema-constrained hypotheses only | No |
| GPT-5.6 Counterexample Hunter | Supplied traces and hypotheses | One proposed input only | No |
| GPT-5.6 Contract Critic | Supplied traces and candidate rules | Evidence-linked contract output only | No |
| Codex builder | Failed proof and repository worktree | One generated candidate module | No |
| Host runner and verifier | Validated inputs, both implementations, SQLite state | Test fixtures, events, artifacts, and proof | Yes, for executed assertions only |
| React workbench | Migration API and SSE | Browser presentation state | No |

## Prompt injection and untrusted trace content

Captured workflow data must be treated as data, never as model instructions. The implemented archaeology prompt marks the model read-only and includes only a structured trace pack. Its Codex SDK thread uses a temporary working directory, read-only sandbox, no network access, and disabled Web search.

The current laboratory uses synthetic, validated inputs rather than arbitrary DOM or log capture. Before connecting to a third-party application, TraceForge still needs field allowlists, instruction/data delimiting, content redaction, and adversarial capture tests.

## Fabricated evidence and unsupported rules

A model could cite a nonexistent trace, over-generalize two observations, or return a confident rule unsupported by the input.

Implemented controls:

- structured JSON schemas per archaeology role;
- an allowlist of evidence IDs from the supplied trace pack;
- rejection of any output that references an unknown evidence ID;
- explicit unknowns and critic dispositions;
- model-proposed inputs executed only by the host;
- deterministic adjacent probes for the exact review threshold.

These controls establish provenance, not semantic omniscience. A model can still interpret valid evidence incorrectly, so the final claim remains limited to the host-executed suite.

## Model-executed side effects

The Counterexample Hunter is not authorized to run the legacy application. The host validates its proposed `ReturnWorkflowInput`, executes the legacy module, reads SQLite state back, and supplies the resulting trace to the next turn.

The current domain validation permits only known customer tiers, conditions, positive integer amounts, and non-negative inventory. A production capture runner would also require target-host allowlists, disposable tenants, rate limits, external-effect mocks, and explicit human approval.

## Self-certifying code

Codex receives a failed proof but cannot decide that the repair passed. It runs in a detached retained worktree with network and Web search disabled. The host permits changes only to:

```text
apps/api/src/candidates/generated-return-workflow.ts
```

Change inspection covers tracked, staged, untracked, and relevant ignored paths. Codex is instructed not to install dependencies or run verification. After the model turn, the host performs the offline frozen install, API tests, six-scenario generated-candidate verification, proof linkage checks, and diff collection.

The adapter never applies the worktree change to the caller's branch and never commits, pushes, merges, deploys, or publishes it.

Remaining risk: the test harness and verifier are part of the trusted computing base. A defect in host assertions can accept incorrect behavior even when the model boundary is intact.

## Secret exposure and ambient credentials

Child processes receive an operational environment allowlist rather than the entire API environment. Only credential-free loopback proxy values are forwarded. Ambient `OPENAI_API_KEY` and `CODEX_API_KEY` values are ignored.

The adapters use `TRACEFORGE_CODEX_API_KEY` only when explicitly provided; otherwise the Codex SDK reuses the operator's existing ChatGPT login. This reduces accidental leakage but does not replace host-level secret isolation, short-lived credentials, audit logging, or per-tenant keys in a production service.

## Replay confusion and provenance laundering

A prerecorded success could be presented as a fresh model run.

Implemented controls:

- the request chooses exactly one of `live-ai`, `recorded-replay`, or `deterministic-only`;
- the server never changes modes after a failure;
- replay jobs carry `recordedAt`, `sourceRunId`, model ID, and an explicit disclosure;
- every event records `origin: live` or `origin: recorded`;
- model invocations retain role, model, auth path, thread ID, token usage, input/output digest, and schema version;
- deterministic-only proofs contain no model invocation and state that no model execution is represented.

The checked-in champion export is a recorded replay backed by real model threads. It must never be described as a model call occurring at replay time.

## False equivalence claims

The host compares five fields per scenario: decision, return status, refund amount, sellable quantity, and quarantine quantity. The proof names all six executed scenarios and partitions them as observed, counterexample, boundary, or held out.

The claim does not cover unexecuted inputs, UI rendering, latency, concurrency, external payment settlement, carrier behavior, other databases, or arbitrary applications. The UI and submission use “behavioral conformance for the executed scenarios,” never “the systems are identical.”

## Artifact integrity and storage tampering

Migration events are inserted with unique IDs and per-job sequence keys. Migration artifacts are inserted with unique IDs. Each event, artifact body, candidate source, candidate diff, contract, and proof carries a SHA-256 digest. Downloads include `X-Content-SHA256`, and proof bodies can be recomputed locally or through the API.

This is tamper-evident only when the verifier compares against a trusted digest. The artifacts are not digitally signed or externally timestamped. A database administrator can rewrite local SQLite content and its digest, and the older trace/contract/proof artifact table still uses replacement semantics by ID. The product therefore says **verification passed** and exposes a recomputable digest; it does not claim cryptographic sealing or non-repudiation.

Planned hardening includes signed manifests, externally anchored roots, stricter append-only database permissions, backup verification, and key rotation.

## Denial of service and resource use

Live archaeology and Codex runs are expensive and can run for minutes. The adapters enforce bounded turn timeouts, and the archaeology sandbox has no network access. The current API does not yet implement authentication, quotas, concurrency limits, cancellation, or a durable production queue. Live mode should therefore remain disabled on an unauthenticated public deployment.

## Sensitive business data

The current corpus is synthetic and contains no production customer data. Redaction, data classification, retention controls, tenant isolation, deletion workflows, and regional processing policy are not implemented. They are release blockers before using real business traces.

## Unsafe publication or deployment

No automated path applies a candidate to the source branch or publishes it. Future pull-request and deployment integrations must require a human to review the evidence, accepted diff, verifier scope, unresolved unknowns, and destination before any external state change.
