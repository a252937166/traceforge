# 100-second demo script

Use **Replay a verified run** for the judged video so the complete experiment fits in 100 seconds. Keep the disclosure visible: the archaeology and build events come from successful live migration `migration_efaa0383-628a-4fba-94df-96bfe344bcbe`, while the host verifier executes the seven-scenario suite again and issues a fresh proof. Never describe replayed events as live calls.

## 0–9 seconds — the migration risk

**Screen:** TraceForge hero and the legacy-workflow problem statement.

**Narration:**

> Critical workflows survive for years with no trustworthy specification. Rebuilding the screens is easy. Preserving the hidden business behavior without guessing is not.

## 9–17 seconds — make the truth mode explicit

**Screen:** Keep **Replay a verified run — interactive replay, recorded AI, fresh proof** selected, then click **Run the verified migration**. Keep the disclosure that no model call occurs during replay and the separate Local Runner evidence link in frame.

**Narration:**

> This is an accelerated replay of a successful real GPT-5.6 Sol and Codex run. Its model threads, base commit, digests, and timestamp remain attached. No model call is running during playback.

## 17–30 seconds — Observe

**Screen:** The Observe stage receives two server events.

- Standard, damaged, $45 → refund; the unit enters quarantine.
- VIP, damaged, $120 → replacement; sellable stock decreases and the returned unit enters quarantine.

Open one evidence event to show its actor, digest, and evidence IDs.

**Narration:**

> TraceForge captures decisions and SQLite side effects, not just clicks. These traces show what happened at two input points, but they do not yet establish a general rule.

## 30–45 seconds — Infer

**Screen:** The Evidence Loom shows bounded hypotheses, their cited evidence IDs, and the lifecycle from `4 initial` unknowns to `4 resolved · 0 remaining`.

**Narration:**

> GPT-5.6 Sol preserves uncertainty instead of hiding it. Four blocking questions enter the archaeology loop; the host will not permit Build until evidence resolves all four or marks unsupported scope explicitly.

## 45–61 seconds — Challenge

**Screen:** Show the crossed VIP-at-$45 counterexample, the $500 high-value counterexample and exact boundary evidence, then the zero-sellable-stock failure row. Show `4 resolved · 0 remaining` before the accepted contract.

**Narration:**

> A Counterexample Hunter chooses high-information inputs, but only the host executes them. The crossed input separates tier from amount; boundary probes find the exact $500 review rule. A stockout probe establishes that replacement must fail atomically: no return record, no inventory change, and no side effect. Only then does the host open Build.

## 61–76 seconds — Build

**Screen:** Candidate history changes from rejected to accepted. Show the provenance strip and open `candidate.diff` or the diff preview.

**Narration:**

> Codex receives the evidence-bounded contract, all four failed proofs, and only disclosed scenarios. Thread `019f5244…539e` repairs one allowed workflow file from base `eb0e616…27c2`. It cannot edit the verifier, commit, push, or deploy.

## 76–93 seconds — Verify

**Screen:** The seven-row matrix fills from server events. Keep the stockout row and the last row's public label **verification-only** visible. Land on `7/7 PASSED`, `35/35` assertions, zero mismatches, and the host-gate split.

**Narration:**

> After the writing turn ends, the host generates a concrete verification-only input and resets both SQLite partitions. Successful rows compare five business results; the stockout row compares five failure and atomicity facts. The candidate passes 56 of 56 candidate-safe tests and all seven scenarios; four replay-only guards remain separate.

## 93–100 seconds — handoff, not a promise

**Screen:** Download dock with `contract.json`, `evidence.jsonl`, `candidate.diff`, `commands.json`, and `proof.json`. Briefly show the proof digest and raw provenance links.

**Narration:**

> The result is code plus a recomputable, evidence-bounded proof—not a universal equivalence claim. TraceForge modernizes undocumented workflows without guessing.

## On-screen facts to keep legible

- System: `evidence-bounded behavior migration system`.
- Mode: `recorded-replay` and “not live” disclosure.
- Source live run: `migration_efaa0383-628a-4fba-94df-96bfe344bcbe`.
- GPT-5.6 Sol: `4 real turns · 121,673 tokens`.
- Unknown lifecycle: `4 initial · 4 resolved · 0 remaining`.
- Codex thread: `019f5244-7bef-71f2-8f25-8ed1446a539e`.
- Candidate base: `eb0e6169974b96bd3bff3b536b38ef5f665127c2`.
- Repair input: `sha256:afe5ac02691e8929f1600f00bf57247b1915da88b759892087deb3b6e81755b8`.
- Host gate: `56/56 candidate-safe · 4 replay-only`.
- Coverage: `2 observed · 2 counterexample · 2 boundary · 1 verification-only`.
- Verdict: `7/7 PASSED · 35/35 assertions · 0 mismatches`.
- Source proof digest: `sha256:4be44d476f222ca492d025a13f296997148142471e2387d532c61479bc3703bc`.

## Capture notes

- Record at 1440×900 or 1920×1080; keep browser zoom at 100%.
- Use one uninterrupted run so stage order, SSE sequence numbers, and artifacts remain visibly connected.
- Avoid terminal footage until the final digest check; the product surface should carry the story.
- Do not say a hypothesis was falsified unless that status is visibly present in the current recording; this source run challenges narrow hypotheses and then accepts a refined contract.
- Call the final row **verification-only** in narration. `held-out` is an internal proof-schema partition name, not a generalization claim.
- If a fresh live run is shown as a bonus clip, keep it separate and show the `live-ai` label from creation through completion. A failure must remain visible rather than switching modes.
