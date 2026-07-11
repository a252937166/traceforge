# Superseded live run: host gate count omitted

Migration `migration_651820ef-13ee-4084-96a4-74a79b4bcfa6` was a real GPT-5.6/Codex run that passed all seven scenarios and 35 assertions. It is not the canonical source run because `proof.hostVerification` was absent.

The raw command log proves the candidate test command completed successfully, but Node's current TAP reporter emitted summary lines as `ℹ tests`, `ℹ pass`, and `ℹ skipped`; the host parser recognized only the older `# tests` form. TraceForge preserved this export, added a regression test for both formats, and reran the complete live pipeline. The replacement canonical run is [`../live-champion-run/`](../live-champion-run/).

No scenario assertion was weakened and this run is not presented as the final proof.
