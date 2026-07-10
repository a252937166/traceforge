# TraceForge

**Show the workflow. Ship the replacement—with evidence.**

TraceForge runs a controlled legacy reference and a separately coded replacement path against the same scenario, derives an evidence-bounded behavior contract, and verifies their observed outcomes. An opt-in Codex SDK adapter can repair one whitelisted candidate file; the host verifier—not the code-writing agent—decides whether the covered behavior matches.

This repository starts with a deliberately narrow returns-workflow laboratory:

- Web UI + REST + SQLite only.
- A synthetic but executable legacy reference and separately coded replacement path.
- Evidence IDs attached to captured inputs, outputs, and state transitions.
- Deterministic workflow-result and SQLite state assertions.
- An intentionally seeded inventory-side-effect mutation that the verifier must catch.
- A retained-worktree Codex repair adapter with a one-file write allowlist and no automatic apply, commit, push, or deploy.
- No claim of universal equivalence: the proof applies only to executed scenarios.

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:5173>. The API runs on <http://localhost:8787>.

Run the current typecheck, unit/integration tests, and production builds:

```bash
pnpm check
```

## Repository map

```text
apps/api   Legacy target, replacement, trace capture, behavior contract, verifier
apps/web   Judge-facing proof console and staged trace visualization
docs       Architecture, threat model, demo plan, and submission material
```

## Integrity boundary

The deterministic contract extractor does not call GPT-5.6. Codex repair is opt-in with `TRACEFORGE_ENABLE_CODEX=1`; the default demo receives `501` and uses an explicitly labelled reference candidate. SDK installation and enablement appear in health status, while authentication or entitlement failures are preserved only after an attempted repair. Sample data can never seal a proof.

One real Codex SDK run produced a whitelisted repair and a fresh passing proof after an earlier verification failure exposed a host-test defect. The exact evidence and limitations are recorded in [docs/evidence/codex-repair-run.md](docs/evidence/codex-repair-run.md).

See [docs/architecture.md](docs/architecture.md) for the implemented boundary and the still-planned GPT-5.6 behavior-archaeology layer.
