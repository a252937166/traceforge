# Threat model and trust boundaries

## Main risks

### Prompt injection in captured software

DOM text, logs, comments, and API payloads are untrusted evidence. They are quoted data, never agent instructions. Read-only archaeology tools cannot change files, execute shell commands, or access credentials.

### Sensitive business data

Capture uses field allowlists and redaction before model calls. Raw database snapshots stay local by default. Proof bundles contain digests and minimal excerpts rather than whole tables.

### Self-certifying code

The writer cannot edit the verifier, approve its own patch, or change expected legacy outcomes. Verification runs from a clean fixture and produces append-only evidence.

### False equivalence claims

Every proof bundle lists scenarios executed, contract rules exercised, uncovered rules, and unresolved unknowns. The UI uses “covered scenarios passed,” never “the systems are identical.”

### Unsafe external effects

The MVP operates on a synthetic returns application. Future integrations require allowlisted hosts, disposable test tenants, isolated worktrees, and human approval before deployment or pull-request publication.

## Demo integrity

The seeded mutation is visible in source control and is not presented as a surprise production bug. Its purpose is to demonstrate that the verifier can reject an incorrect candidate. Live model activity, deterministic fixtures, and prerecorded sequences must be visually distinguished.

