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

`Run proof` first posts `candidateVersion: "buggy"` to `/api/demo/run`. When that live run returns a failed `proofBundle.proofId`, the frontend posts the proof ID to `/api/adapters/codex/repair` and permits up to five minutes for the isolated SDK turn.

- A successful Codex response seals only when HTTP `200`, explicit execution, a fresh generated run/proof pair, `PASSED` with zero mismatches, the one-file whitelist, a non-empty diff, and a retained worktree are all present. The UI displays `CODEX EXECUTED`, the short thread ID, the real changed file, and lines from the returned diff.
- `501` is the only response that triggers the explicitly labelled `fixed` reference fallback.
- `422`, `502`, timeouts, and malformed successful responses end unresolved and never silently switch to the reference candidate.
- If the initial runner is offline, sample evidence is displayed, but no repair request is made and no proof can be sealed.

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
    "proofId": "proof_...",
    "candidateVersion": "fixed",
    "assertions": [],
    "mismatches": []
  },
  "traces": {}
}
```

The interface credits Codex only when the repair endpoint returns the full integrity evidence above. Reused IDs or malformed `200` responses stay unresolved. If the demo API cannot be reached, the initial runner switches to a conspicuous **Sample data · API fallback** state and uses a deterministic fixture. A fixture replay can never call repair or seal a proof; it ends with guidance to start the live runner.

## Checks

```bash
npm test
npm run build
```

The layout includes visible keyboard focus, semantic landmarks and live status text, responsive rearrangement, and reduced-motion behavior.
