# TraceForge

**Show the workflow. Ship the replacement—with evidence.**

TraceForge runs a controlled legacy reference and a separately coded replacement path against the same scenario, derives an evidence-bounded behavior contract, and verifies their observed outcomes. An opt-in Codex SDK adapter can repair one whitelisted candidate file; the host verifier—not the code-writing agent—decides whether the covered behavior matches.

**Hosted showcase:** [traceforge.axiqo.xyz](https://traceforge.axiqo.xyz) — live differential runs with the public-safe reference fallback; Codex execution stays disabled on the internet.

This repository starts with a deliberately narrow returns-workflow laboratory:

- Web UI + REST + SQLite only.
- A synthetic but executable legacy reference and separately coded replacement path.
- Evidence IDs attached to captured inputs, outputs, and state transitions.
- Deterministic workflow-result and SQLite state assertions.
- An intentionally seeded inventory-side-effect mutation that the verifier must catch.
- A retained-worktree Codex repair adapter with a one-file write allowlist and no automatic apply, commit, push, or deploy.
- No claim of universal equivalence: the proof applies only to executed scenarios.

## Quick start

Requires Node.js 22.5+ and pnpm 10.33.2. Node 22 is recommended because the API uses `node:sqlite`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:5174>. The API runs on <http://localhost:8787>.

Run the current typecheck, unit/integration tests, and production builds:

```bash
pnpm check
```

Run the complete release gate, including real Chrome-to-live-API acceptance and ten repeatability runs:

```bash
pnpm acceptance:all
```

The individual acceptance commands and their exact claims are documented in [docs/acceptance-tests.md](docs/acceptance-tests.md).

## Repository map

```text
apps/api   Legacy target, replacement, trace capture, behavior contract, verifier
apps/web   Judge-facing proof console and staged trace visualization
docs       Architecture, threat model, demo plan, and submission material
```

## Integrity boundary

The deterministic contract extractor does not call GPT-5.6. Codex repair is opt-in with `TRACEFORGE_ENABLE_CODEX=1`; the default demo receives `501` and uses an explicitly labelled reference candidate. SDK installation and enablement appear in health status, while authentication or entitlement failures are preserved only after an attempted repair. Sample data can never seal a proof.

To reproduce the isolated Codex path, authenticate the installed Codex SDK in your environment, then start the local services explicitly:

```bash
TRACEFORGE_ENABLE_CODEX=1 pnpm dev
curl http://127.0.0.1:8787/api/adapters/codex
```

The adapter creates a detached retained worktree, permits a change to only `apps/api/src/candidates/generated-repair.ts`, strips unrelated host secrets from child processes, requires the generated metadata to bind to the exact failed proof digest, and runs verification outside the model-writing turn. It never applies, commits, pushes, merges, or deploys the candidate.

One real Codex SDK run produced a whitelisted repair and a fresh passing proof after an earlier verification failure exposed a host-test defect. The exact evidence and limitations are recorded in [docs/evidence/codex-repair-run.md](docs/evidence/codex-repair-run.md).

See [docs/architecture.md](docs/architecture.md) for the implemented boundary and the still-planned GPT-5.6 behavior-archaeology layer.
