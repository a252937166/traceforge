# Real Local Runner run — v0.1.9

This directory records a complete Local Runner execution captured on 2026-07-12 from a fresh clone of the pinned `local-runner-v0.1.9` tag. The clone was verified at commit `a2ce8b2394caf5d1491c2b142f99a8421f3cec2d` before installation.

This was not the fake client used by unit tests. Headless Playwright consumed the one-time loopback URL and clicked **Start local build** while automatic browser opening was disabled with `TRACEFORGE_LOCAL_NO_BROWSER=1`. That switch is only a capture/testing option; the normal pinned launcher omits it and opens the loopback UI. The tagged Runner used Codex CLI `0.144.1` with `gpt-5.6-sol`, received a real model turn, changed the one permitted candidate file, created a post-turn verification-only input, ran the local verifier, issued the proof, and deleted the session through the UI.

Before approval, v0.1.9 preflight forced a refresh of the dedicated ChatGPT sign-in, checked Codex's server-classified usage-limit state, and confirmed that `gpt-5.6-sol` was advertised. It reached `ready` before the model turn started; no cached account label alone was accepted as proof of usable access.

## Result

| Check | Result |
| --- | --- |
| Local Runner phase | `passed` |
| Focused candidate tests | `15/15` |
| Differential scenarios | `7/7` |
| Business assertions | `35/35` |
| Stock-exhaustion failure assertions | `5/5` |
| Mismatches | `0` |
| Browser page errors | `0` |
| Changed files | `1`, the permitted generated workflow |
| Proof digest | `sha256:0218e92475eb2c08cd875e2a5363ff6a0b71800d17503b5fb5381387d544453b` |
| Diff digest | `sha256:5c51b3f7bd93a75c5dbeeb1d82b47086480d92a49ace52d26dc451479082386f` |
| Session cleanup | all captured checks `true`: session, writer, verifier, worktree registration, lock, and loopback server removed or closed |

The model turn used 30,886 total tokens, including 28,416 cached input tokens. The proof records thread `019f5288-3b94-7a71-a087-032825fff3fa` and turn `019f5288-3bf7-7b71-bd0d-c44b209094f6` without including credentials or raw command output.

## Evidence files

- [`preflight.json`](preflight.json) — runner/fixture identity, Codex version, sign-in boolean, model availability, and loopback boundary before approval.
- [`proof.json`](proof.json) — host-issued local proof with model identifiers, exact runner commit, candidate and diff digests, fixed verification commands, seven scenario results, limitations, and recomputable digest.
- [`candidate.diff`](candidate.diff) — the exact one-file Codex change.
- [`run-summary.json`](run-summary.json) — compact result and independent proof-digest validation.
- [`cleanup.json`](cleanup.json) — post-delete checks for every temporary boundary.
- [`screenshot.png`](screenshot.png) — the actual passing `3200×2938` Local Runner page captured before deletion.

## Provenance boundary

- Behavior archaeology: recorded GPT-5.6 evidence from authenticated source run `migration_efaa0383-628a-4fba-94df-96bfe344bcbe`.
- Build: live local Codex in a temporary writer workspace.
- Verification: live local host in a separate verifier worktree after the Codex turn closed.
- Output: a fresh local diff and digest-bound proof.

The portable gate executes 15 focused candidate tests plus seven differential scenarios. The source champion gate separately contains 56 candidate-safe tests plus four replay-integrity guards. The exhausted-stock scenario proves failure status, exact code and message, no return record, unchanged inventory, and zero side effects.

## Recompute the proof digest

From repository root:

```bash
node --import tsx --input-type=module -e 'import { readFile } from "node:fs/promises"; import { verifyLocalProofDigest } from "./apps/local-runner/src/local-repair.ts"; const proof = JSON.parse(await readFile("docs/evidence/local-runner-v0.1.9/proof.json", "utf8")); if (!verifyLocalProofDigest(proof, "a2ce8b2394caf5d1491c2b142f99a8421f3cec2d")) process.exit(1); console.log(proof.digest);'
```

The archived JSON and diff were scanned before commit for bearer tokens, API keys, GitHub tokens, email addresses, user-home paths, `CODEX_HOME`, auth-file names, passwords, and bootstrap capabilities. No matches were found. Raw stdout, raw stderr, credentials, account labels, and the Runner-owned Codex home are intentionally excluded.
