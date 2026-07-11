# 100-second demo script

Use **Recorded replay** for the judged video so the complete experiment fits in 100 seconds. Keep the disclosure visible: the archaeology and build events come from a successful real run completed on 2026-07-11, while the host verifier executes the six-scenario suite again. Never describe replayed events as live calls.

## 0–9 seconds — the migration risk

**Screen:** TraceForge hero and the legacy-workflow problem statement.

**Narration:**

> Critical workflows survive for years with no trustworthy specification. Rebuilding the screens is easy. Preserving the hidden business behavior without guessing is not.

## 9–17 seconds — make the truth mode explicit

**Screen:** Select **Recorded replay — verified recording, not live**, then click **Start migration**. Keep the Live AI availability indicator in frame.

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

**Screen:** The Evidence Loom shows two bounded hypotheses and their cited evidence IDs.

**Narration:**

> GPT-5.6 Sol preserves that uncertainty. It states only what each observed point supports, cites supplied evidence IDs, and records the unanswered questions instead of inventing a complete policy.

## 45–61 seconds — Challenge

**Screen:** Show the crossed VIP-at-$45 counterexample, then the $500 high-value counterexample and exact boundary evidence. Show the three accepted, priority-ordered rules.

**Narration:**

> A Counterexample Hunter chooses high-information inputs, but only the host executes them. The crossed input separates tier from amount. The high-value trace and deterministic boundary probes establish that manual review begins at exactly $500 and outranks tier-specific processing.

## 61–76 seconds — Build

**Screen:** Candidate history changes from rejected to accepted. Show the provenance strip and open `candidate.diff` or the diff preview.

**Narration:**

> Codex receives the evidence-bounded contract, all three failed proofs, and only the disclosed scenarios. Thread `019f4fd8…33ef` repairs one allowed workflow file from base `7c1dce…e039`. It cannot edit the verifier, commit, push, or deploy.

## 76–93 seconds — Verify

**Screen:** The six-row matrix fills from server events. Keep the last row's public label **verification-only** visible. Land on `6/6 PASSED`, `30/30` assertions, zero mismatches, and the host-gate split.

**Narration:**

> After the writing turn ends, the host generates a concrete verification-only input, resets both SQLite partitions, and runs five deterministic assertions per scenario. The candidate passes 42 of 42 candidate-safe tests and all six scenarios; four replay-only guards remain separate from the candidate worktree gate.

## 93–100 seconds — handoff, not a promise

**Screen:** Download dock with `contract.json`, `evidence.jsonl`, `candidate.diff`, `commands.json`, and `proof.json`. Briefly show the proof digest and raw provenance links.

**Narration:**

> The result is code plus a recomputable, evidence-bounded proof—not a universal equivalence claim. TraceForge modernizes undocumented workflows without guessing.

## On-screen facts to keep legible

- System: `evidence-bounded behavior migration system`.
- Mode: `recorded-replay` and “not live” disclosure.
- Source live run: `migration_77f7a45d-a07f-43c6-a0bd-cf4555ed7996`.
- GPT-5.6 Sol: `4 turns · 115,565 tokens`.
- Codex thread: `019f4fd8-5408-7752-b8fa-f8c6b08b33ef`.
- Candidate base: `7c1dceeaee7f375beb8d2895fda502f2ad74e039`.
- Host gate: `42/42 candidate-safe · 4 replay-only`.
- Coverage: `2 observed · 1 counterexample · 2 boundary · 1 verification-only`.
- Verdict: `6/6 PASSED · 30/30 assertions · 0 mismatches`.
- Source proof digest: `sha256:4ff6eba63043e50052cab81a6adab5a7a6c49d1bcb19a93c42bee25453a13241`.

## Capture notes

- Record at 1440×900 or 1920×1080; keep browser zoom at 100%.
- Use one uninterrupted run so stage order, SSE sequence numbers, and artifacts remain visibly connected.
- Avoid terminal footage until the final digest check; the product surface should carry the story.
- Do not say a hypothesis was falsified unless that status is visibly present in the current recording; this source run challenges narrow hypotheses and then accepts a refined contract.
- Call the final row **verification-only** in narration. `held-out` is an internal proof-schema partition name, not a generalization claim.
- If a fresh live run is shown as a bonus clip, keep it separate and show the `live-ai` label from creation through completion. A failure must remain visible rather than switching modes.
