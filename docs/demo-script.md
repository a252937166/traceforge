# 100-second demo script

## 0–12 seconds — the fear

Show the controlled legacy returns panel and one sentence: “The workflow runs the business, but its rules were never documented.” Start the damaged-return proof run.

## 12–30 seconds — evidence, not a transcript

TraceForge records the workflow input, decision, side effects, and SQLite inventory before/after state. Point to “Refunded damage never returns to sellable stock,” its evidence IDs, and confidence.

## 30–48 seconds — bounded contract

Show the two evidence-linked rules and the explicit coverage boundary. Say “This proof covers the observed branch; TraceForge does not claim universal equivalence.”

## 48–66 seconds — candidate build

Show `CODEX RUNNING`, the isolated-worktree boundary, and the single writable generated-candidate file. Then show the returned thread ID and actual two-line configuration diff.

## 66–84 seconds — rejection

Replay the seeded candidate first: it incorrectly restores damaged inventory to sellable stock. The proof ledger turns orange and shows two mismatched state fields. Make clear that this failure predates the repair.

## 84–96 seconds — repair and independent rerun

Codex patches only the generated candidate file. The host runs API tests, resets both partitions, and verifies again. Seal only after a new run ID and proof ID report `PASSED` with zero mismatches; retain the earlier failure and worktree.

## 96–100 seconds — handoff

End on the replacement, source diff, and proof bundle: “Show the workflow. Ship the replacement—with evidence.”
