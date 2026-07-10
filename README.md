# TraceForge

[![verify](https://github.com/a252937166/traceforge/actions/workflows/ci.yml/badge.svg)](https://github.com/a252937166/traceforge/actions/workflows/ci.yml)

**Modernize undocumented workflows without guessing.**

TraceForge turns observed workflow behavior into an evidence-linked contract, challenges that contract with counterexamples, lets Codex rebuild the workflow in an isolated worktree, and gives the final decision to a deterministic host verifier.

**Hosted showcase:** [traceforge.axiqo.xyz](https://traceforge.axiqo.xyz)

The current executable laboratory is deliberately narrow: one Web returns workflow, REST, and SQLite. It is not a claim that arbitrary software can already be migrated. It demonstrates the hard part of that product honestly: preserving uncertainty, finding a hidden priority rule, rejecting an incomplete implementation, and issuing a proof limited to the scenarios actually executed.

## The five-stage run

1. **Observe** — capture two SQLite-backed legacy traces: a $45 standard damaged return and a $120 VIP damaged return.
2. **Infer** — GPT-5.6 Sol proposes competing, schema-constrained hypotheses and cites trace evidence IDs.
3. **Challenge** — GPT-5.6 Sol proposes discriminating inputs; the host executes them, searches the exact $500 review boundary, and asks a contract critic to narrow the rules.
4. **Build** — the seeded candidate is rejected. Codex may edit the complete replacement module in a detached worktree, with a one-file allowlist and no network access.
5. **Verify** — the host resets state and compares legacy and candidate behavior across six observed, counterexample, boundary, and held-out scenarios. The agent that writes code never decides whether it passed.

The workbench is driven by server events from those stages. It does not advance through client-side timers or preload a successful result.

## Reproducible evidence

The checked-in [champion run evidence](docs/evidence/live-champion-run/README.md) records:

- four real `gpt-5.6-sol` archaeology invocations, each with a thread ID and content digests;
- Codex thread `019f4d12-9228-78c1-95fc-3a13d8e1919f` editing only `apps/api/src/candidates/generated-return-workflow.ts` from base commit `899ff7ac5f6151b58129559a1d760177a1243136`;
- a fresh host verification covering `2 observed + 1 counterexample + 2 boundary + 1 held-out` scenarios;
- `6/6` passing scenarios, five deterministic assertions per scenario, and zero mismatches;
- proof digest `sha256:9c4bf000d0b9ae67ef311cb93dd97cf43df914412fdee51f8d6f8ebce59f5fb2`.

The checked-in job is an explicitly disclosed **recorded replay** of the real model work. No GPT or Codex call is implied to be running while that recording is replayed. The differential suite and proof are executed again by the host during the replay.

Verify the proof digest locally:

```bash
pnpm proof:verify docs/evidence/live-champion-run/proof.json
```

Expected result:

```json
{
  "valid": true,
  "claimedDigest": "sha256:9c4bf000d0b9ae67ef311cb93dd97cf43df914412fdee51f8d6f8ebce59f5fb2",
  "computedDigest": "sha256:9c4bf000d0b9ae67ef311cb93dd97cf43df914412fdee51f8d6f8ebce59f5fb2"
}
```

## Run it

Requires Node.js 22.5 or newer and pnpm 10.33.2. Node 22 is recommended because the API uses `node:sqlite`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:5174>. The API listens on <http://localhost:8787>.

Run the CI-equivalent typecheck, tests, and production builds:

```bash
pnpm check
```

Run the complete migration acceptance gate:

```bash
pnpm acceptance:all
```

See [docs/acceptance-tests.md](docs/acceptance-tests.md) for the exact claim behind each gate.

## Three explicit execution modes

| Mode | What runs | What it claims |
|---|---|---|
| `live-ai` | Fresh GPT-5.6 Sol archaeology, host-executed counterexamples, a Codex SDK repair, and host verification | Live model work only when both adapters are explicitly enabled; otherwise the job fails and no other mode is substituted |
| `recorded-replay` | Recorded model events with original provenance, followed by a fresh host differential suite and artifact export | The model work happened at the disclosed recording time; it is not happening now |
| `deterministic-only` | Current candidate and host verifier only; Infer, Challenge, and Build are marked skipped | No GPT-5.6 or Codex execution |

Enable live model work only in an authenticated local environment:

```bash
TRACEFORGE_ENABLE_GPT56=1 TRACEFORGE_ENABLE_CODEX=1 pnpm dev
```

The adapters reuse the operator's existing Codex ChatGPT login unless `TRACEFORGE_CODEX_API_KEY` is set explicitly. Ambient `OPENAI_API_KEY` and `CODEX_API_KEY` values are not forwarded.

## API and artifacts

```text
POST /api/migrations
GET  /api/migrations/:id
GET  /api/migrations/:id/events
GET  /api/migrations/:id/proof
GET  /api/migrations/:id/artifacts
GET  /api/migrations/:id/downloads/:filename
POST /api/proofs/verify-digest
```

`/events` supports Server-Sent Events, sequence-based replay, and JSON inspection. A completed job exposes `contract.json`, `evidence.jsonl`, `candidate.diff`, `commands.json`, and `proof.json` as downloadable artifacts with SHA-256 headers.

Export one completed migration:

```bash
node scripts/export-migration.mjs \
  http://127.0.0.1:8787 \
  migration_your_id \
  .traceforge/export
```

## Repository map

```text
apps/api   Legacy oracle, candidate modules, GPT archaeology, Codex adapter,
           migration jobs, SSE, SQLite evidence, and host verifier
apps/web   Five-stage migration workbench driven by server events
docs       Architecture, threat model, demo, acceptance, submission, evidence
scripts    Browser/API acceptance and evidence export helpers
```

## Claim boundary

TraceForge proves behavioral conformance only for the six executed scenarios and the five fields checked in each scenario: decision, return status, refund amount, sellable quantity, and quarantine quantity. External payments, carrier systems, arbitrary browser capture, other databases, cryptographic signatures, and universal behavioral equivalence are outside the current claim.

Read [docs/architecture.md](docs/architecture.md) for the implemented trust boundaries and [docs/threat-model.md](docs/threat-model.md) for the remaining risks.
