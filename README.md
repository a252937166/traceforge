# TraceForge

**Show the workflow. Ship the replacement—with evidence.**

TraceForge turns captured runtime behavior into an evidence-bounded behavior contract, asks Codex to build or repair a replacement, and then runs the original and replacement through the same scenarios. The verifier—not the code-writing agent—decides whether the covered behavior matches.

This repository starts with a deliberately narrow returns-workflow laboratory:

- Web UI + REST + SQLite only.
- A real legacy workflow and a separately implemented replacement.
- Evidence IDs attached to captured inputs, outputs, and state transitions.
- Deterministic API and database assertions.
- An intentionally seeded inventory-side-effect mutation that the verifier must catch.
- No claim of universal equivalence: the proof applies only to executed scenarios.

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:5173>. The API runs on <http://localhost:8787>.

Run the complete verification suite:

```bash
pnpm check
```

## Repository map

```text
apps/api   Legacy target, replacement, trace capture, behavior contract, verifier
apps/web   Judge-facing proof console and synchronized replay
docs       Architecture, threat model, demo plan, and submission material
```

## Integrity boundary

The first milestone is a deterministic proof engine. AI integration is intentionally kept behind an adapter and is reported as unavailable when credentials or entitlement are missing. Sample/demo data is labeled as such; the UI must never present a fixture as a live GPT-5.6 or Codex result.

See [docs/architecture.md](docs/architecture.md) for the planned GPT-5.6 Responses Multi-agent and Codex SDK boundaries.

