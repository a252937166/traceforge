# TraceForge

[![verify](https://github.com/a252937166/traceforge/actions/workflows/ci.yml/badge.svg)](https://github.com/a252937166/traceforge/actions/workflows/ci.yml)

**Modernize undocumented workflows without guessing.**

TraceForge is an **evidence-bounded behavior migration system**. It turns observed workflow behavior into an evidence-linked contract, challenges that contract with counterexamples, lets Codex rebuild the workflow in an isolated worktree, and gives the final decision to a deterministic host verifier.

**Hosted showcase:** [traceforge.axiqo.xyz](https://traceforge.axiqo.xyz)

The current executable laboratory is deliberately narrow: one Web returns workflow, REST, and SQLite. It is not a claim that arbitrary software can already be migrated. It demonstrates the hard part of that product honestly: preserving uncertainty, finding a hidden priority rule, rejecting an incomplete implementation, and issuing a proof limited to the scenarios actually executed.

**Migration Loom** is the name of TraceForge's judge-facing product experience: the evidence-custody path from recorded behavior to a bounded candidate and fresh host proof. TraceForge is built by **ouyangduning** as a solo project; the GitHub organization/account and video channel linked below are publication surfaces for the same entry.

## How Codex & GPT-5.6 were used

| System | Real role in the project | Verifiable output |
| --- | --- | --- |
| **GPT-5.6 Sol** | Four read-only, schema-constrained behavior-archaeology turns: propose competing hypotheses, choose discriminating counterexamples, and critique the final evidence-linked contract. The host—not the model—executes every proposed input. | `121,673` tokens of bounded inputs and structured outputs, with thread IDs, cited evidence IDs, and content digests in the [champion run evidence](docs/evidence/live-champion-run/README.md). |
| **OpenAI Codex SDK** | One isolated code-writing turn receives the resolved contract, four preserved failed proofs, and disclosed scenarios. It may repair only `apps/api/src/candidates/generated-return-workflow.ts`; it cannot edit the verifier, commit, push, deploy, or decide that it passed. | Codex thread `019f5244-7bef-71f2-8f25-8ed1446a539e`, its exact immutable inputs, accepted one-file diff, and host command log are checked in with the evidence. |
| **TraceForge host verifier** | Materializes a concrete verification-only input after the Codex turn, resets both systems, and compares deterministic decisions plus SQLite side effects. | `7/7` scenarios, `35/35` assertions, zero mismatches, and a downloadable digest-bound proof. |

GPT-5.6 is therefore the behavior investigator, Codex is the constrained implementer, and neither is allowed to certify its own result.

## The five-stage run

1. **Observe** — capture two SQLite-backed legacy traces: a $45 standard damaged return and a $120 VIP damaged return.
2. **Infer** — GPT-5.6 Sol proposes competing, schema-constrained hypotheses and cites trace evidence IDs.
3. **Challenge** — GPT-5.6 Sol proposes discriminating inputs; the host executes them, searches the exact $500 review boundary, and asks a contract critic to narrow the rules.
4. **Build** — the seeded candidate is rejected. Codex receives the evidence-bounded contract, all four failed proofs, and only the disclosed scenarios. It may edit the complete replacement module in a detached worktree, with a one-file allowlist and no network access.
5. **Verify** — after the Codex writing turn ends, the host generates one concrete verification-only input, resets state, and compares legacy and candidate behavior across six visible scenarios plus that verification-only scenario. The agent that writes code never sees that final input and never decides whether it passed.

The workbench is driven by server events from those stages. It does not advance through client-side timers or preload a successful result.

### Source-run and Local Runner isolation are different

The checked-in source run gave Codex a detached repository worktree and restricted legacy-oracle and verifier reads through the repair prompt. The host technically enforced the accepted **write** boundary—only `apps/api/src/candidates/generated-return-workflow.ts` could change—and rejected verifier-relevant tampering. That source run should not be described as filesystem-level read isolation.

The optional Local Runner has the stronger read boundary: it prepares a minimized writer workspace that omits the legacy implementation, verifier, hidden input, and private host files, then verifies the resulting candidate in a separate host-owned workspace. In both paths, Codex never decides whether its own output passed.

## Reproducible evidence

The checked-in [champion run evidence](docs/evidence/live-champion-run/README.md) records:

- source live migration `migration_efaa0383-628a-4fba-94df-96bfe344bcbe`;
- four real `gpt-5.6-sol` archaeology invocations totaling `121,673` tokens, with raw bounded inputs, structured outputs, thread IDs, and content digests;
- an explicit unknown lifecycle: `4` initial blocking unknowns, `4` evidence-linked resolutions, and `0` remaining unknowns before the host permits `READY_FOR_BUILD`;
- Codex thread `019f5244-7bef-71f2-8f25-8ed1446a539e` editing only `apps/api/src/candidates/generated-return-workflow.ts` from base commit `eb0e6169974b96bd3bff3b536b38ef5f665127c2`;
- the exact contract, four failed proofs, and disclosed scenarios supplied to Codex under repair-input digest `sha256:afe5ac02691e8929f1600f00bf57247b1915da88b759892087deb3b6e81755b8`;
- a post-turn host verification covering `2 observed + 2 counterexample + 2 boundary + 1 verification-only` scenarios;
- `56/56` candidate-safe tests, with four replay-only guards separated from the candidate worktree gate;
- `7/7` passing scenarios, `35/35` deterministic assertions, and zero mismatches;
- proof digest `sha256:4be44d476f222ca492d025a13f296997148142471e2387d532c61479bc3703bc`.

Six successful rows compare decision, return status, refund amount, sellable quantity, and quarantine quantity. The exhausted-stock counterexample instead compares five failure and atomicity facts: failure status, failure code plus message, no return record, unchanged inventory, and zero side effects.

The checked-in evidence directory is the successful **live-ai** source run. The public UI leads with **Replay a verified run** (`recorded-replay`): it streams the disclosed model events with their original provenance, then executes the differential suite again and issues fresh artifacts. No GPT or Codex call is implied to be running during replay. A new live run remains a secured, credentialled capability rather than an anonymous public trigger.

Verify the untouched historical proof and its derived v2 scenario-set envelope locally:

```bash
pnpm proof:verify-integrity docs/evidence/live-champion-run/proof.json
pnpm proof:verify-envelope docs/evidence/live-champion-run/source-run-envelope-v2.json
```

Both commands return `valid: true`. The first checks only the original object's canonical digest; the second binds its exact bytes and the checked-in recorded verifier artifact's exact bytes to the seven ordered per-scenario proof digests, then parses the artifact's unique final suite and recomputes coverage, scenario-set digest, and the split `56/56 + 4 replay guards` host gate. Fresh proofs issued by the hardened runtime use `pnpm proof:verify-current <proof.json>`.

Historical integrity result:

```json
{
  "valid": true,
  "claimedDigest": "sha256:4be44d476f222ca492d025a13f296997148142471e2387d532c61479bc3703bc",
  "computedDigest": "sha256:4be44d476f222ca492d025a13f296997148142471e2387d532c61479bc3703bc"
}
```

## Run the build with your own Codex

Reviewers can run the bounded **Build + Verify** stages with their own local Codex sign-in. The public site copies one pinned macOS/Linux command. Launch clones and installs the pinned release, prepares the fixture and private configuration, starts the loopback server, and checks Codex access. No Codex writing turn or verifier command runs until the reviewer approves the disclosed scope.

macOS or Linux:

```bash
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 13)) { console.error(`TraceForge Local Runner requires Node.js >=22.13.0; found ${process.versions.node}. Install Node.js 22.23.1, then rerun. No clone or installation was started.`); process.exit(64); }' && EXPECTED_SHA="d9b0d853acc7cab36eba859a778763c231e37325" && RUN_DIR="$(mktemp -d)" && git clone --filter=blob:none --branch local-runner-v0.1.10 https://github.com/a252937166/traceforge.git "$RUN_DIR/traceforge" && cd "$RUN_DIR/traceforge" && ACTUAL_SHA="$(git rev-parse HEAD)" && { test "$ACTUAL_SHA" = "$EXPECTED_SHA" || { echo "Unexpected TraceForge release commit" >&2; exit 64; }; } && export TRACEFORGE_LOCAL_RELEASE_SHA="$ACTUAL_SHA" && NODE_ARCH="$(node -p 'process.arch')" && npm_config_arch="$NODE_ARCH" corepack pnpm install --frozen-lockfile && npm_config_arch="$NODE_ARCH" node --import tsx apps/local-runner/src/cli.ts
```

The leading gate rejects Node.js 22.12 and older with exit code 64 before cloning or installing anything. The command then verifies that the pinned `local-runner-v0.1.10` tag resolves to commit `d9b0d853acc7cab36eba859a778763c231e37325` before installation, exports that checked-out SHA, and binds it into the local proof. The resulting provenance is explicit: GPT-5.6 archaeology is recorded source evidence, while the `gpt-5.6-sol` Codex build, post-turn verification-only input, deterministic host verification, diff, and proof are fresh on the reviewer's machine. Preflight forces a credential refresh and fails closed when Codex reports a reached usage limit. The Runner uses a dedicated ChatGPT sign-in, never reads global `~/.codex/auth.json`, permits one candidate file to change, and disables agent command network and Git publication operations.

The pinned v0.1.10 Local Runner executes `15` focused candidate tests plus one host-owned SELLABLE refusal probe (`16/16` host gates), followed by seven differential scenarios with `35/35` assertions. The source champion gate separately contains `56` candidate-safe tests plus four replay-integrity guards. The linked v0.1.9 and v0.1.6 evidence directories remain explicitly historical rather than proof of the current profile.

The optional hands-on path has been exercised from a fresh `local-runner-v0.1.10` clone through the actual loopback UI with a real `gpt-5.6-sol` Codex turn. It passed `15/15` focused tests plus the host-owned refusal probe (`16/16` host gates), `7/7` scenarios, and `35/35` assertions—including `5/5` exhausted-stock failure assertions—with zero mismatches. Proof `sha256:b67ba62f1e5cae421d96e8b28596a456f5234f8a303a070e67dcf5244832c272` binds thread `019f5eb8-3394-7bc0-ae68-0c134f314c7f`; diff `sha256:5b996c8e70acf203fd41e0c8062ea8714397b22059e080738a6d3da293e37567` binds the one allowed change. UI deletion removed the session, writer, verifier, worktree registration, lock, and loopback server. See the [sanitized v0.1.10 run evidence](docs/evidence/local-runner-v0.1.10/README.md); the [v0.1.9](docs/evidence/local-runner-v0.1.9/README.md) and [v0.1.6](docs/evidence/local-runner-v0.1.6/README.md) evidence is retained as historical context.

Requires Node.js `>=22.13.0`, Corepack/pnpm `10.33.2`, Git, Codex CLI exactly `0.144.1`, and access to `gpt-5.6-sol`. Node `22.23.1` is pinned in `.nvmrc` and CI and is the recommended reviewer version; Node 22.13 is the minimum because it is the first Node 22 release that exposes `node:sqlite` without a command-line flag. A public browser cannot silently start local Codex, so the terminal launch is required on first use. Windows is not supported by this verified release. See [docs/local-runner.md](docs/local-runner.md) for exact read/write/network/Git boundaries, artifacts, cleanup, and troubleshooting. The [hosted replay](https://traceforge.axiqo.xyz) remains the zero-install fallback.

## Run it

Requires Node.js `>=22.13.0` and pnpm `10.33.2`; Node `22.23.1` is pinned for development and CI. The minimum is required because the API uses the unflagged `node:sqlite` module.

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

TraceForge proves behavioral conformance only for the seven executed scenarios. Six successful rows check decision, return status, refund amount, sellable quantity, and quarantine quantity; the exhausted-stock failure row checks failure status, code plus message, absence of a return record, unchanged inventory, and zero side effects. The raw proof schema calls its final partition `held-out`; the judge-facing product deliberately labels it **verification-only**, which is the precise claim: its concrete input is generated by the host after the Codex turn, not evidence of statistical generalization. External payments, carrier systems, arbitrary browser capture, other databases, cryptographic signatures, and universal behavioral equivalence are outside the current claim.

Read [docs/architecture.md](docs/architecture.md) for the implemented trust boundaries and [docs/threat-model.md](docs/threat-model.md) for the remaining risks.

Impact claims are tracked separately in [docs/impact-validation.md](docs/impact-validation.md). The current repository contains a controlled technical validation, not invented customer adoption or production-savings claims. The pre-event baseline and in-window work are separated in [BUILD_WEEK_CHANGES.md](BUILD_WEEK_CHANGES.md).
