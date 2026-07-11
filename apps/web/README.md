# TraceForge web

The Migration Loom is the judge-facing workbench for one TraceForge job. It renders five server-driven stages, evidence-linked hypotheses, falsifying counterexamples, candidate history, a six-scenario differential matrix, append-only events, and downloadable artifacts.

## Run

```bash
pnpm --filter @traceforge/web dev
```

Vite serves `http://localhost:5174` and proxies `/api` to `http://localhost:8787`. Override the API during local QA with:

```bash
VITE_API_TARGET=http://127.0.0.1:8877 pnpm --filter @traceforge/web dev
```

## Product behavior

- The public-safe default is `recorded-replay`, labelled with its original timestamp and an explicit “not live” disclosure.
- `live-ai` and `deterministic-only` are separate user choices with different claims.
- Progress comes from sequence-numbered SSE events, with JSON polling only as a transport recovery path.
- Terminal jobs close their event subscription.
- No successful state is preloaded, and the client does not advance stages with timers.
- Proof and artifact content comes from the API, not from a bundled fixture.

The layout is responsive at 390px without document-level horizontal overflow, preserves keyboard focus, and respects reduced-motion preferences.

## Checks

```bash
pnpm --filter @traceforge/web typecheck
pnpm --filter @traceforge/web test
pnpm --filter @traceforge/web build
```

The component tests cover all three execution modes, fail-closed live behavior, the named `migration` SSE channel, healthy terminal close without polling fallback, streamed hypotheses and counterexamples, proof rendering, object-valued scenario fields, artifact links, and the evidence dialog. `pnpm acceptance:ui` adds a real Playwright Chromium run over the compiled API and browser client.
