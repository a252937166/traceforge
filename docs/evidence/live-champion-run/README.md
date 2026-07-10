# Champion run evidence guide

This directory is a reproducible export of migration `migration_4fb1757b-3d44-4a8d-bcac-c246cf9699e0`.

The exported job used `recorded-replay`. That distinction matters: the GPT-5.6 Sol and Codex calls were real, but they occurred at the recorded source run time. The replay does not call either model again. It replays their disclosed events, reruns the deterministic six-scenario host suite, and issues a fresh migration proof and artifact set.

## Verdict

| Field | Value |
|---|---|
| Replay migration | `migration_4fb1757b-3d44-4a8d-bcac-c246cf9699e0` |
| Source live run | `migration_57dcf6ff-c7b0-4842-8a66-a74e08565b7b` |
| Model | `gpt-5.6-sol` |
| Candidate | `replacement.return-workflow.generated-candidate` |
| Status | `PASSED` |
| Coverage | `2 observed + 1 counterexample + 2 boundary + 1 held-out` |
| Result | `6/6 scenarios passed · 30/30 assertions · 0 mismatches` |
| Proof ID | `migration-proof_a6997431-bc83-4a07-ade1-a30de3c17dce` |
| Internal proof digest | `sha256:9c4bf000d0b9ae67ef311cb93dd97cf43df914412fdee51f8d6f8ebce59f5fb2` |

The proof claim is exactly: “Behavioral conformance for the executed observed, counterexample, boundary, and held-out scenarios only.”

## Real GPT-5.6 Sol provenance

The proof contains four successful model invocation records. Each record includes role, model, ChatGPT auth path, thread ID, token total, input trace IDs, input/output digests, and schema version.

| Role | Thread ID | Tokens recorded |
|---|---:|---:|
| Trace Archaeologist | `019f4cf8-e79c-7af0-8a2a-9ade019a5d7b` | 23,559 |
| Counterexample Hunter, crossed input | `019f4cf9-f48d-77a1-a6d4-a5c54894e138` | 23,689 |
| Counterexample Hunter, high-value exception | `019f4cfa-af8a-7592-b3d7-1a055683863d` | 25,769 |
| Contract Critic | `019f4cfb-aab9-7e41-a8a2-aa4157748559` | 46,005 |

These invocations produced competing hypotheses, two counterexamples, and the evidence-bounded contract in [`contract.json`](contract.json). The contract's highest-priority rule states that returns at or above 50,000 cents enter manual review with no inventory movement.

## Real Codex provenance

| Field | Value |
|---|---|
| Thread ID | `019f4d12-9228-78c1-95fc-3a13d8e1919f` |
| Model | `gpt-5.6-sol` |
| Base commit | `899ff7ac5f6151b58129559a1d760177a1243136` |
| Changed paths | `apps/api/src/candidates/generated-return-workflow.ts` only |
| Candidate source digest | `sha256:33dae444638bf3e7015aa743711358a19e330ca98d1fec8b98d044a106132773` |
| Accepted diff digest | `sha256:71a28fc581b0a0ce146d596f88b125bc21f7736a7f61b6956144ef757ca7a68c` |

[`candidate.diff`](candidate.diff) shows a complete-module repair: it moves the 50,000-cent review rule ahead of VIP handling and sends damaged refunds to quarantine instead of sellable inventory.

The host, outside the Codex writing turn, recorded these successful checks in [`commands.json`](commands.json):

- offline frozen install, with 278 packages reused and no network downloads;
- 37/37 API tests;
- 6/6 generated-candidate scenarios, each with a unique persisted proof and zero mismatches.

## File inventory

| File | Purpose |
|---|---|
| [`job.json`](job.json) | Execution mode, replay disclosure, source run, lifecycle, and API links |
| [`events.jsonl`](events.jsonl) | Final 33-event API sequence, including all five stages and terminal job event |
| [`evidence.jsonl`](evidence.jsonl) | Server-issued evidence artifact captured before final artifact and completion events |
| [`contract.json`](contract.json) | Ordered behavior rules, unknowns, and `READY_FOR_BUILD` disposition |
| [`candidate.diff`](candidate.diff) | Accepted one-file Codex diff |
| [`commands.json`](commands.json) | Host command summaries and exit codes |
| [`proof.json`](proof.json) | Model/candidate provenance, six scenario outcomes, limitations, and internal digest |
| [`artifacts.json`](artifacts.json) | Download metadata, byte lengths, and exact artifact-body digests |

The `proof.json` internal digest and the `proof.json` download artifact digest are different on purpose:

- `sha256:9c4b…f5fb2` covers the proof object's canonical body with its `digest` field removed;
- `sha256:2a25…e99c` in `artifacts.json` is computed by TraceForge's canonical digest helper over the serialized download body string.

## Verify locally

From the repository root:

```bash
pnpm install --frozen-lockfile
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

To inspect the stage sequence:

```bash
jq -r '[.sequence, .stage, .type, .origin, .actor, .status] | @tsv' \
  docs/evidence/live-champion-run/events.jsonl
```

To compare the accepted diff with its recorded base:

```bash
git show 899ff7ac5f6151b58129559a1d760177a1243136:apps/api/src/candidates/generated-return-workflow.ts \
  > /tmp/traceforge-candidate-before.ts
git apply --stat docs/evidence/live-champion-run/candidate.diff
```

## Limits of this evidence

- It covers exactly the six named Web returns scenarios and five asserted fields per scenario.
- The model events are a replay with real provenance, not fresh calls at export time.
- The legacy oracle and candidate are separate modules in the same TypeScript API process.
- External payment settlement, carrier systems, arbitrary browser targets, and databases other than SQLite are outside the proof.
- SHA-256 makes the bundle recomputable but not cryptographically signed or externally anchored.
