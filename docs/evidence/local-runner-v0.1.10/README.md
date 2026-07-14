# Real Local Runner run — v0.1.10

This directory records a complete Local Runner execution captured on 2026-07-14 from a fresh clone of the immutable `local-runner-v0.1.10` tag. The annotated tag was independently peeled to commit `d9b0d853acc7cab36eba859a778763c231e37325` before installation and again by the Runner before proof issuance.

This was not the fake client used by unit tests. Headless Playwright consumed the one-time loopback capability and clicked **Start local build** while automatic browser opening was disabled with `TRACEFORGE_LOCAL_NO_BROWSER=1`. The tagged Runner used Node.js `22.23.1`, pnpm `10.33.2`, Codex CLI `0.144.1`, and a real `gpt-5.6-sol` turn. Codex changed one permitted candidate file; a separate host workspace then created the post-turn verification-only input, executed the candidate gates, issued a fresh proof, and deleted the session through the UI.

Before approval, preflight forced a refresh of the dedicated ChatGPT sign-in, checked the server-classified usage-limit state, and confirmed that `gpt-5.6-sol` was available. It reached `ready` with no Codex thread, verifier result, or proof before the capture clicked Start.

## Result

| Check | Result |
| --- | --- |
| Local Runner phase | `passed` |
| Focused candidate tests | `15/15` |
| Evidence-boundary probe | `1/1`: SELLABLE refused with `OUTSIDE_EVIDENCE_BOUNDARY`, no result, no side effects |
| Total host gates | `16/16` |
| Differential scenarios | `7/7` DAMAGED scenarios |
| Business assertions | `35/35` |
| Stock-exhaustion failure assertions | `5/5` |
| Mismatches | `0` |
| Browser page errors | `0` |
| Changed files | `1`, the permitted generated workflow |
| Proof digest | `sha256:b67ba62f1e5cae421d96e8b28596a456f5234f8a303a070e67dcf5244832c272` |
| Diff digest | `sha256:5b996c8e70acf203fd41e0c8062ea8714397b22059e080738a6d3da293e37567` |
| Session cleanup | all captured checks `true`: session, writer, verifier, worktree registration, lock, and loopback server removed or closed |

The real model turn used `30,494` total tokens, including `28,416` cached input tokens. The proof records thread `019f5eb8-3394-7bc0-ae68-0c134f314c7f` and turn `019f5eb8-33c2-7422-97dc-50634eebc484` without credentials, account identifiers, or raw command output.

## Evidence files

- [`preflight.json`](preflight.json) — Runner/fixture identity, Codex version, sign-in boolean, model availability, and loopback boundary before approval.
- [`proof.json`](proof.json) — host-issued local proof binding the exact Runner tag and commit, model turn, candidate, diff, fixed verification commands, evidence-boundary refusal, seven scenarios, limitations, and recomputable digest.
- [`candidate.diff`](candidate.diff) — the exact one-file Codex change.
- [`run-summary.json`](run-summary.json) — compact result plus independent proof-digest validation.
- [`cleanup.json`](cleanup.json) — post-delete checks for every temporary boundary.
- [`screenshot.png`](screenshot.png) — the actual passing `3200×2972` Local Runner page captured before deletion.

## Provenance boundary

- Behavior archaeology: recorded GPT-5.6 evidence from authenticated source run `migration_efaa0383-628a-4fba-94df-96bfe344bcbe`.
- Build: live local Codex in a minimized temporary writer workspace.
- Verification: live local host in a separate verifier worktree after the Codex turn closed.
- Boundary check: the host directly invoked the repaired candidate with a SELLABLE input and required the exact typed refusal before any result or side effect.
- Output: a fresh one-file diff and digest-bound local proof.

The source champion gate remains a separate fact: `56/56` candidate-safe tests plus four replay-integrity guards. This portable run uses `15/15` focused candidate tests plus the independent SELLABLE refusal check, then executes the same seven DAMAGED business scenarios and `35/35` deterministic assertions.

## Recompute the proof digest

From repository root in a checkout containing this evidence directory (the verifier source is the same source bound to `local-runner-v0.1.10`):

```bash
node --import tsx --input-type=module -e 'import { readFile } from "node:fs/promises"; import { verifyLocalProofDigest } from "./apps/local-runner/src/local-repair.ts"; const proof = JSON.parse(await readFile("docs/evidence/local-runner-v0.1.10/proof.json", "utf8")); if (!verifyLocalProofDigest(proof, "d9b0d853acc7cab36eba859a778763c231e37325")) process.exit(1); console.log(proof.digest);'
```

The proof digest was independently recomputed after capture, and the diff file's raw SHA-256 exactly matches `proof.candidate.diffDigest`. The archived JSON and diff were scanned before commit for bearer tokens, API keys, GitHub tokens, email addresses, user-home paths, `CODEX_HOME`, auth-file names, passwords, and bootstrap capabilities. No matches were found. Raw stdout, raw stderr, credentials, account labels, and the Runner-owned Codex home are intentionally excluded.
