# TraceForge web

The TraceForge workbench presents one migration proof run as a forensic instrument panel: captured workflow and behavior rules on the left, synchronized original/replacement playback in the center, and an evidence ledger on the right.

## Run locally

```bash
npm install
npm run dev
```

Vite serves the interface at `http://localhost:5173`. Requests under `/api` proxy to `http://localhost:8787` by default. Override the target when needed:

```bash
VITE_API_TARGET=http://localhost:3000 npm run dev
```

## Demo contract

`Run proof` sends two `POST` requests to `/api/demo/run`. It first runs `candidateVersion: "buggy"` to verify that the deliberate mutation is detected, then runs `candidateVersion: "fixed"` after the repair phase. Both calls use `scenarioId: "damaged-small-refund"`. The UI seals a proof only when the fixed response is live, `PASSED`, and reports zero mismatches.

The frontend accepts both a top-level response and `{ data: ... }` / `{ result: ... }` envelopes. The backend's stable response includes:

```json
{
  "runId": "run_...",
  "status": "PASSED",
  "source": "deterministic-local-demo",
  "events": [],
  "rules": [],
  "proofs": [],
  "proofBundle": {
    "candidateVersion": "fixed",
    "assertions": [],
    "mismatches": []
  },
  "traces": {}
}
```

The interface credits Codex only when the API explicitly returns `codexExecuted: true` (or `patch.generatedBy: "codex"`). If the API cannot be reached, it switches to a conspicuous **Sample data · API fallback** state and uses a deterministic fixture. A fixture replay can never seal a proof; it ends with guidance to start the live runner.

## Checks

```bash
npm test
npm run build
```

The layout includes visible keyboard focus, semantic landmarks and live status text, responsive rearrangement, and reduced-motion behavior.
