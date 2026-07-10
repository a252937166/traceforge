# Threat model and trust boundaries

## Main risks

### Prompt injection in captured software

Future DOM text, logs, comments, and API payloads must be treated as untrusted evidence and quoted as data rather than instructions. Arbitrary browser capture and the read-only archaeology agents are not implemented in this milestone.

### Sensitive business data

The synthetic MVP contains no production business data. Field allowlists, redaction before model calls, and retention controls are release blockers before connecting a real system; they are not yet implemented.

### Self-certifying code

The Codex writer can edit only `apps/api/src/candidates/generated-repair.ts` in a detached worktree. The host enforces the allowlist and runs the tests and fresh verification. Evidence carries IDs and digests, but the current SQLite store is not append-only.

### False equivalence claims

Every proof bundle identifies the executed scenario, assertions, mismatches, limitations, and evidence links. The UI uses covered-scenario language, never “the systems are identical.”

### Unsafe external effects

The MVP operates on a synthetic returns application. Future integrations require allowlisted hosts, disposable test tenants, isolated worktrees, and human approval before deployment or pull-request publication.

## Demo integrity

The seeded mutation is visible in source control and is not presented as a surprise production bug. Its purpose is to demonstrate that the verifier can reject an incorrect candidate. Live model activity, deterministic fixtures, and prerecorded sequences must be visually distinguished.
