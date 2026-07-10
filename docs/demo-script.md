# 100-second demo script

Use **Recorded replay** for the judged video so the entire experiment fits in 100 seconds. Keep its disclosure visible: the inference and build events come from a recorded real run, while the host verifier executes the six-scenario suite again. Do not describe replayed events as live calls.

## 0–9 seconds — the migration risk

**Screen:** TraceForge hero and the legacy-workflow problem statement.

**Narration:**

> Critical workflows survive for years with no trustworthy specification. Rebuilding the screens is easy. Rebuilding the hidden business behavior without guessing is not.

## 9–17 seconds — make the truth mode explicit

**Screen:** Select **Recorded replay — verified recording, not live**, then click **Start migration**.

**Narration:**

> This is an accelerated replay of a real GPT-5.6 Sol and Codex run. The original model IDs, thread IDs, and timestamp remain attached. No model call is running during playback.

## 17–31 seconds — Observe

**Screen:** The Observe stage receives two server events.

- Standard, damaged, $45 → refund; the unit enters quarantine.
- VIP, damaged, $120 → replacement; the unit enters quarantine.

Open one evidence event to show its actor, digest, and evidence IDs.

**Narration:**

> TraceForge captures decisions and SQLite side effects, not just clicks. Two traces explain what happened, but they do not prove whether tier, amount, or condition caused it.

## 31–46 seconds — Infer

**Screen:** The Evidence Loom shows four competing hypotheses from the Trace Archaeologist.

**Narration:**

> GPT-5.6 Sol proposes evidence-linked explanations and preserves ambiguity. Every rule must cite an ID from the supplied trace pack; invented evidence is rejected by the host.

## 46–62 seconds — Challenge

**Screen:** Show the crossed-tier counterexample, then the high-value $750 example. Let the two amount-banded hypotheses visibly become falsified. Show the refined rule at the top of the loom.

**Narration:**

> A Counterexample Hunter chooses the next high-information input, but only the host executes it. The high-value return reveals manual review with no money or inventory movement. Deterministic probes then locate the exact $500 boundary, which outranks VIP treatment.

## 62–76 seconds — Build

**Screen:** Candidate history changes from **Candidate 01 rejected** to **Candidate 02 accepted**. Open `candidate.diff` or show the diff preview.

**Narration:**

> The observed-only candidate fails both rule priority and damaged inventory disposition. Codex thread `019f4d12…1919f` repairs the complete workflow module in a detached worktree. It can change one file and cannot test, commit, push, or deploy.

## 76–93 seconds — Verify

**Screen:** The six-row matrix fills from server events: two observed, one counterexample, two boundary, and one held-out VIP scenario. Land on `6/6 PASSED`, zero mismatches.

**Narration:**

> After the writing turn ends, the host resets both SQLite partitions and runs five deterministic assertions per scenario. The held-out VIP-at-$500 check proves the review rule really has priority. Six fresh proofs pass with zero mismatches.

## 93–100 seconds — handoff, not a promise

**Screen:** Download dock with `contract.json`, `evidence.jsonl`, `candidate.diff`, `commands.json`, and `proof.json`. Briefly show the proof digest.

**Narration:**

> The result is code plus a recomputable, evidence-bounded proof—not a universal equivalence claim. TraceForge: modernize undocumented workflows without guessing.

## On-screen facts to keep legible

- Mode: `recorded-replay` and “not live” disclosure.
- Model: `gpt-5.6-sol`.
- Codex thread: `019f4d12-9228-78c1-95fc-3a13d8e1919f`.
- Candidate base: `899ff7ac5f6151b58129559a1d760177a1243136`.
- Coverage: `2 observed · 1 counterexample · 2 boundary · 1 held-out`.
- Verdict: `6/6 PASSED · 0 mismatches`.
- Proof digest: `sha256:9c4bf000d0b9ae67ef311cb93dd97cf43df914412fdee51f8d6f8ebce59f5fb2`.

## Capture notes

- Record at 1440×900 or 1920×1080; keep browser zoom at 100%.
- Use one uninterrupted run so stage order, server sequence numbers, and artifacts remain visibly connected.
- Avoid terminal footage until the final digest check; the product surface should carry the story.
- If a live run is shown as a bonus clip, keep its duration separate and show the `live-ai` label from job creation through completion. A failure must remain visible rather than switching modes.
