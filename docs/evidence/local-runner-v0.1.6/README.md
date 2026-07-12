# HISTORICAL — Local Runner v0.1.6 — DO NOT USE AS CURRENT SUBMISSION EVIDENCE

> The current exercised Local Runner is [`../local-runner-v0.1.9/`](../local-runner-v0.1.9/) with `15/15` focused tests, `7/7` scenarios, and `35/35` assertions. This directory preserves the original v0.1.6 facts only; do not upload or relabel them as current.

## Original v0.1.6 run

This directory records a complete Local Runner execution captured on 2026-07-11 from a fresh temporary clone of the pinned `local-runner-v0.1.6` tag, verified at commit `88fd9faa613f0b7280a584a79e209fae800272d9` before installation.

This was not the fake build client used by unit tests. Headless Playwright loaded the loopback-only page and clicked **Start local build**. The tagged Runner then used Codex CLI `0.144.1` with `gpt-5.6-sol`, received a real model turn, changed the one permitted candidate file, created the post-turn verification input, ran the local verifier, issued the proof, and deleted the session through the UI.

## Result

| Check | Result |
| --- | --- |
| Local Runner phase | `passed` |
| Focused candidate tests | `13/13` |
| Differential scenarios | `6/6` |
| Business assertions | `30/30` |
| Mismatches | `0` |
| Browser page errors | `0` |
| Changed files | `1`, the permitted generated workflow |
| Proof digest | `sha256:dd29511b4089b9080033321aa096518967ef332a8b9d55b63d4e23692e208d31` |
| Diff digest | `sha256:00b56d9c593d156045f61c99e02f5bf111af647e1ce61834b65fc559f9a3f675` |
| Session cleanup | session, writer, verifier, worktree, lock, and server all removed or closed |

The model turn used 24,162 total tokens, including 22,272 cached input tokens. The proof records the real thread and turn identifiers without including credentials or raw command output.

## Evidence files

- [`preflight.json`](preflight.json) — release, fixture, Codex version, sign-in boolean, model availability, and loopback boundary before approval.
- [`proof.json`](proof.json) — the host-issued local proof with model identifiers, candidate and diff digests, fixed verification commands, six scenario results, limitations, and recomputable digest.
- [`candidate.diff`](candidate.diff) — the exact one-file Codex change.
- [`run-summary.json`](run-summary.json) — compact results and proof-digest validation from the captured run.
- [`cleanup.json`](cleanup.json) — post-delete checks for every temporary session boundary.
- [`screenshot.png`](screenshot.png) — the actual passing Local Runner page captured before deletion; `proof.json` remains the primary machine-checkable record.

## Provenance boundary

- Behavior archaeology: recorded GPT-5.6 evidence from the authenticated source run.
- Build: live local Codex in the temporary writer workspace.
- Verification: live local host, after the Codex turn, in a separate verifier worktree.
- Output: a fresh local diff and proof.

The portable Local Runner gate is deliberately smaller than the repository champion gate: it executes 13 focused candidate tests plus six differential scenarios. The repository source gate separately executes 42 candidate-safe tests plus four replay-integrity guards. Both numbers are displayed together in the Local Runner UI.

## Recompute the proof digest

From the repository root:

```bash
node --import tsx --input-type=module -e 'import { readFile } from "node:fs/promises"; import { verifyLocalProofDigest } from "./apps/local-runner/src/local-repair.ts"; const proof = JSON.parse(await readFile("docs/evidence/local-runner-v0.1.6/proof.json", "utf8")); if (!verifyLocalProofDigest(proof)) process.exit(1); console.log(proof.digest);'
```

The archived JSON and diff were scanned before commit for bearer tokens, API keys, GitHub tokens, email addresses, user-home paths, `CODEX_HOME`, auth-file names, passwords, and secrets. No matches were found. Raw stdout, raw stderr, credentials, and the Runner-owned Codex home are intentionally excluded.
