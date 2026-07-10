# TraceForge executable release gate

TraceForge makes a bounded claim: for each executed scenario, the replacement produced the API result and SQLite state transitions recorded by the independent verifier. The project does not claim equivalence for behavior it did not execute.

## One-command gate

From a clean checkout with Node.js 22.5 or newer and pnpm 10.33.2:

```bash
pnpm install --frozen-lockfile
pnpm acceptance:all
```

`acceptance:all` runs type checking, unit/integration tests, production builds, two live API acceptance runs, a real Chrome browser-to-API flow, and ten clean repeatability runs. It exits non-zero on any failed gate.

Generated evidence is retained under `.traceforge/acceptance/` and is intentionally excluded from Git.

## Command surface

```bash
pnpm acceptance:api -- --mode baseline
pnpm acceptance:api -- --mode mutation
pnpm acceptance:ui
pnpm acceptance:repeat -- --runs 10
pnpm acceptance:all
```

| Command | What it proves |
|---|---|
| `acceptance:api -- --mode baseline` | The legacy and reference replacement execute independently from reset SQLite partitions, return fresh IDs and evidence, and match all five asserted fields. |
| `acceptance:api -- --mode mutation` | The known replacement mutation is detected as exactly two inventory mismatches. A transport-level `201` cannot be mistaken for a passing proof. |
| `acceptance:ui` | A real installed Chrome binary loads the Vite application, calls the live API with no network mocks, preserves the failed candidate, receives the expected disabled-Codex `501`, runs the reference candidate, and seals only a fresh zero-mismatch proof. |
| `acceptance:repeat -- --runs 10` | Ten clean executions have identical normalized business semantics while run, proof, trace, and evidence IDs remain unique. |

## Fixed fixture

| Item | Value |
|---|---|
| Scenario | `damaged-small-refund` |
| Return | `RET-1001`, damaged, standard customer, refund `45.00` |
| Initial inventory | sellable `10`, quarantine `0` |
| Correct result | `REFUNDED`, refund `45.00`, sellable `10`, quarantine `1` |
| Seeded mutation | damaged unit is restored to sellable inventory |
| Mutated result | sellable `11`, quarantine `0` |

The legacy and replacement traces must have different trace IDs, implementation IDs, and evidence namespaces. Every event must carry an `ev_` ID and `sha256:<64 hex>` digest.

## Browser acceptance sequence

The browser gate checks the same path a judge uses:

1. Click **Run proof**.
2. Receive a fresh failed `buggy` run from `POST /api/demo/run`.
3. Preserve `D-01 FOUND` and the failed values.
4. Receive `501 CODEX_ADAPTER_NOT_CONFIGURED` from the public-safe repair boundary.
5. Run the independently coded `fixed` reference candidate.
6. Display `LIVE RUN`, `REFERENCE PATCH`, `VERIFIED`, and `Proof sealed` only after a fresh passing run.

The expected repair `501` is part of this public-safe test, not an ignored error. Actual Codex execution is separately opt-in and is never exposed by the hosted showcase.

## Honest limits

The executable gate does not yet prove:

- append-only persistence across an API restart;
- separate HTTP processes for legacy and replacement targets;
- arbitrary external workflows or databases;
- automatic behavior discovery with GPT-5.6;
- universal behavioral equivalence.

These remain hardening or future-product work and must not be described as completed in the submission.
