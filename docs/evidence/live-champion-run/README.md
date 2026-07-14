# Champion live-run evidence guide

This directory is the reproducible export of successful `live-ai` migration `migration_efaa0383-628a-4fba-94df-96bfe344bcbe`, completed at `2026-07-11T17:42:15.612Z`.

It is the source run for TraceForge's judge-facing recorded replay. The source run made four real GPT-5.6 Sol analysis calls and one real Codex writing turn. A replay preserves that provenance with an explicit not-live disclosure, then the current host reruns the differential suite and issues a fresh proof.

## Verdict

| Field | Value |
|---|---|
| Execution mode | `live-ai` |
| Model | `gpt-5.6-sol` |
| Status | `PASSED` |
| Contract unknowns | `4 initial → 4 resolved → 0 remaining` |
| Candidate gate | `56/56 candidate-safe tests · 4 replay-only guards` |
| Coverage | `2 observed + 2 counterexamples + 2 boundaries + 1 verification-only` |
| Result | `7/7 scenarios · 35/35 assertions · 0 mismatches` |
| Proof ID | `migration-proof_54c63c5b-f5ca-4675-b0bc-7fedb6956dbb` |
| Historical proof digest | `sha256:4be44d476f222ca492d025a13f296997148142471e2387d532c61479bc3703bc` |
| Derived scenario-set digest | `sha256:142d9123ec2c33e0e48abba37dc184f9f0b6c82162dbdb83fcf50df7d749c0da` |

The final row, `host-hidden-252b1708e9e9`, was materialized only after the Codex turn. The schema calls this partition `held-out`; the public product calls it **verification-only** because one generated input is not evidence of statistical generalization.

## The two closed audit gaps

The contract in [`contract.json`](contract.json) no longer carries blocking questions into a build-ready state. It records the exact lifecycle as `initialUnknowns`, `resolvedUnknowns`, and `remainingUnknowns`; every initial ID is classified once, and `remainingUnknowns` is empty.

The new stock-exhaustion counterexample is an observable failure, not a fabricated success result:

- input: VIP, damaged, 12,000 cents, zero sellable stock;
- legacy result: `INSUFFICIENT_SELLABLE_STOCK`;
- persistence: not attempted;
- return record: absent;
- inventory: unchanged at `0/0`;
- shipment and other side effects: none.

Its five assertions compare execution failure, code plus message, absence of a return record, unchanged inventory, and zero side effects. Successful rows retain the original decision, status, refund, sellable, and quarantine comparisons. Total: `7 × 5 = 35`.

## Real GPT-5.6 provenance

The four bounded GPT-5.6 calls total `121,673` tokens:

| Role | Thread ID | Tokens |
|---|---|---:|
| Trace Archaeologist | `019f5240-6ff5-7c32-ac67-a52975f6e615` | 23,811 |
| Counterexample Hunter, crossed input | `019f5241-653a-72a2-8456-4283f3b6746b` | 23,723 |
| Counterexample Hunter, high-value exception | `019f5242-2a73-7ea1-86e6-b8fc550c5abc` | 24,267 |
| Contract Critic | `019f5242-e670-75f3-8d38-8fb3e8ba448e` | 49,872 |

[`invocations/manifest.json`](invocations/manifest.json) indexes each bounded application prompt, structured output, model/auth metadata, trace and evidence digests, timing, and usage. System and developer context is intentionally excluded.

## Real Codex provenance

| Field | Value |
|---|---|
| Thread ID | `019f5244-7bef-71f2-8f25-8ed1446a539e` |
| Model | `gpt-5.6-sol` |
| Base fixture commit | `eb0e6169974b96bd3bff3b536b38ef5f665127c2` |
| Changed paths | `apps/api/src/candidates/generated-return-workflow.ts` only |
| Repair-input digest | `sha256:afe5ac02691e8929f1600f00bf57247b1915da88b759892087deb3b6e81755b8` |
| Contract digest supplied to Codex | `sha256:235acdcc4a120bf5965035dc8c43658dac534a4f85da7bbc78b26c01fcafc716` |
| Candidate source digest | `sha256:fdf9a85c55e6a007320a5613672ba3354fb785d307c57f7201357bdc7b1c9e74` |
| Accepted diff digest | `sha256:4e2841074c97edaacd151318cdcc1fc8e0b9ba72f50d47c40d0a5c4a6a21577a` |

Codex received the final GPT contract, four failed proofs, and seven disclosed scenario records (six canonical rows plus one covered-high evidence probe). The concrete verification-only input did not yet exist. [`codex/`](codex/) contains the exact bounded input/output, immutable repair inputs, accepted source, and metadata.

## File inventory

| Path | Purpose |
|---|---|
| [`job.json`](job.json) | Live job lifecycle and source ID |
| [`events.jsonl`](events.jsonl) | Append-only 36-event five-stage ledger |
| [`contract.json`](contract.json) | Evidence-linked rules and closed unknown lifecycle |
| [`candidate.diff`](candidate.diff) | Accepted one-file Codex diff |
| [`commands.json`](commands.json) | Redacted host commands and raw TAP/suite output |
| [`proof.json`](proof.json) | Untouched historical proof: model, candidate, host gate, seven rows, and its original internal digest |
| [`source-run-envelope-v2.json`](source-run-envelope-v2.json) | Derived v2 commitment to the original proof bytes, checked-in recorded verifier artifact, seven exact per-scenario proof digests, scenario-set digest, and split host gate |
| [`artifacts.json`](artifacts.json) | Serialized download digests and sizes |
| [`invocations/`](invocations/) | Four bounded GPT input/output/metadata triples |
| [`codex/`](codex/) | Codex prompt, output, inputs, source, and metadata |

Canonical object digests and serialized artifact digests have different scopes. The proof object's internal digest is `sha256:4be44d…03bc`; the serialized `proof.json` download digest in `artifacts.json` is `sha256:0ac36f…f518`.

`proof.json` is deliberately preserved byte-for-byte from the source run. It predates the runtime's `scenarioSetDigest` hardening, so object-integrity verification of that historical file is not a claim that it satisfies the current `MigrationProofBundle` schema. The adjacent v2 envelope closes that version boundary without rewriting history: it binds the original internal digest and raw-file digest; the exact bytes of [`recorded-codex-build.generated.json`](../../../apps/api/src/recorded-codex-build.generated.json) under digest `sha256:d807b17687bbbe16baa380034137d59dd3d60cfb19b44086cff6ff3f52c05fc1`; the ordered `{scenarioId, partition, proofDigest}` rows parsed from that artifact's unique final verifier suite; the recomputable scenario-set digest; `56/56` candidate-safe tests; and four separately run replay guards.

## Verify

```bash
pnpm proof:verify-integrity docs/evidence/live-champion-run/proof.json
pnpm proof:verify-envelope docs/evidence/live-champion-run/source-run-envelope-v2.json
jq '[.invocations[].usage.total_tokens] | {turns: length, totalTokens: add}' \
  docs/evidence/live-champion-run/invocations/manifest.json
jq '{threadId, baseCommit, changedFiles, repairInput, sourceDigest, diffDigest}' \
  docs/evidence/live-champion-run/codex/metadata.json
```

Both verifier commands must return `valid: true`. The integrity command reports matching historical proof digests `sha256:4be44d476f222ca492d025a13f296997148142471e2387d532c61479bc3703bc`. The envelope command additionally checks the raw proof bytes, the recorded verifier artifact's raw bytes and source-run identity, exactly one passing final suite, exact ordered scenario tuples, coverage, host gate, `scenarioSetDigest`, and envelope digest. Replacing a per-row digest and recomputing the envelope's own digests still fails unless it matches the checked-in verifier suite.

For a proof freshly issued by the hardened runtime, use `pnpm proof:verify-current <proof.json>`. That command requires the current schema and recomputes coverage and `scenarioSetDigest`; it is intentionally not used to relabel the older source-run object.

## Preserved evidence history

- [`../superseded-champion-run-v1-20260711/`](../superseded-champion-run-v1-20260711/) preserves the original six-scenario champion run. It is historical evidence and must not be used as the current submission source.
- [`../superseded-champion-run-missing-host-gate-20260712/`](../superseded-champion-run-missing-host-gate-20260712/) preserves the otherwise-passing seven-scenario run whose proof omitted the host test totals because the parser did not recognize modern TAP markers.
- The earlier failed-run directories remain unchanged; TraceForge does not rewrite failed attempts as successes.

## Limits

- The claim covers exactly the seven listed Web-return scenarios.
- Successful rows and the stockout row use different, explicitly named five-assertion sets.
- The four GPT and one Codex turns were live only in this source run; replay is not a fresh model call.
- The verification-only input is post-turn but is still one case, not a benchmark.
- The legacy oracle and candidate are separate modules in one TypeScript process backed by isolated SQLite partitions.
- External payment settlement, carriers, arbitrary browser targets, and non-SQLite databases are outside this proof.
- SHA-256 gives recomputable integrity, not a signature, identity attestation, or trusted timestamp.
