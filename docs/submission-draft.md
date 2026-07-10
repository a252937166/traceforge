# Devpost submission draft

> Draft only. Reconcile the final category, repository visibility, video limit, and eligibility fields with the official rules before submission.

## Project name

TraceForge

## Tagline

Modernize undocumented workflows without guessing.

## One-line pitch

Show TraceForge a legacy workflow, and it uses GPT-5.6 to uncover hidden rules, Codex to rebuild the workflow, and an independent verifier to prove exactly which behaviors match.

## Short description

TraceForge is a behavior-to-software compiler for undocumented business workflows. It observes runtime decisions and state changes, asks GPT-5.6 Sol to form and challenge evidence-linked hypotheses, lets Codex repair a replacement module in an isolated worktree, and issues a downloadable proof only after a deterministic host verifier passes observed, counterexample, boundary, and held-out scenarios.

## Inspiration

Teams keep critical legacy systems alive because their real specifications are scattered across UI behavior, database side effects, operator memory, and exceptions nobody documented. A code generator can reproduce a screen, but it cannot tell a team whether a refund, approval, or inventory rule was silently changed.

We built TraceForge around a different question: can an AI system expose what it does not yet know, ask for the one experiment that resolves the ambiguity, and then prove the rebuilt behavior with evidence the code-writing agent does not control?

## What it does

TraceForge runs one migration through five server-owned stages:

1. **Observe** captures two legacy traces and their SQLite before/after state.
2. **Infer** asks a read-only GPT-5.6 Sol Trace Archaeologist for competing rules, invariants, and unknowns. Every claim must cite supplied evidence IDs.
3. **Challenge** asks a Counterexample Hunter for high-information inputs. The host—not the model—executes them, searches the exact boundary, and gives the fresh traces to a Contract Critic.
4. **Build** rejects an incomplete first candidate, then lets Codex repair the complete replacement workflow in a detached worktree with a one-file write allowlist and no network access.
5. **Verify** resets legacy and candidate state and compares decision, status, refund amount, sellable inventory, and quarantine inventory across six scenarios, including an exact boundary and a held-out priority check.

The demonstration starts with a $45 standard damaged return and a $120 VIP damaged return. Those observations permit several plausible explanations. GPT-5.6 chooses crossed-tier and high-value counterexamples, exposing an undocumented rule: returns at or above $500 must enter manual review before any payment or inventory side effect, even for VIP customers. Codex then repairs the candidate's rule priority and damaged-item disposition. The host suite passes `6/6` scenarios with zero mismatches.

## How we built it

- `gpt-5.6-sol` through the Codex SDK for three read-only, schema-constrained roles: Trace Archaeologist, Counterexample Hunter, and Contract Critic.
- Host validation that rejects unknown evidence IDs and executes every model-proposed scenario itself.
- Codex SDK for the single code-writing role, isolated in a retained detached Git worktree.
- TypeScript and Express for migration jobs, REST APIs, Server-Sent Events, artifact downloads, and mode enforcement.
- SQLite for separate legacy and candidate state partitions plus migration events and artifacts.
- React for a five-stage evidence workbench that derives hypotheses, candidate history, proof coverage, and downloads from server events rather than timers.
- SHA-256 digests for events, artifacts, candidate source/diff provenance, and recomputable proof bodies.

## Where GPT-5.6 is essential

GPT-5.6 is not a chat layer or a label on deterministic extraction. In the real recorded run it performed four evidence-producing turns:

| Role | Thread |
|---|---|
| Trace Archaeologist | `019f4cf8-e79c-7af0-8a2a-9ade019a5d7b` |
| Counterexample Hunter, crossed input | `019f4cf9-f48d-77a1-a6d4-a5c54894e138` |
| Counterexample Hunter, high-value exception | `019f4cfa-af8a-7592-b3d7-1a055683863d` |
| Contract Critic | `019f4cfb-aab9-7e41-a8a2-aa4157748559` |

The model outputs carry input/output digests, trace IDs, schema version, token usage, and the `gpt-5.6-sol` model ID. The model may propose a scenario or a rule, but it cannot execute the workflow, modify code, or declare verification success.

## Where Codex is essential

Codex thread `019f4d12-9228-78c1-95fc-3a13d8e1919f` started from commit `899ff7ac5f6151b58129559a1d760177a1243136` and changed only `apps/api/src/candidates/generated-return-workflow.ts`.

It repaired a complete decision-and-side-effect module rather than flipping a configuration value. The accepted diff moved the high-value rule ahead of VIP handling and routed damaged refunds to quarantine. After the turn, the host performed an offline frozen install, ran 37 API tests, and produced six unique passing scenario proofs.

## Truthful live, replay, and deterministic modes

- **Live AI** performs fresh GPT-5.6 and Codex work. If either adapter is unavailable, the job fails; TraceForge never substitutes another result.
- **Recorded replay** visibly replays a verified real model run with its original timestamp and provenance. No model call occurs during playback, but the host suite executes again and issues fresh artifacts.
- **Deterministic proof** skips all model stages and claims only the host verification it actually runs.

This separation lets judges inspect the complete product story without confusing a reliable short replay with a live invocation.

## Challenges we ran into

The hardest challenge was preventing plausible AI output from becoming product truth. We had to make ambiguity a first-class state, constrain outputs to evidence IDs, keep scenario execution on the host, and stop the code-writing agent from certifying its own work.

We also learned that provenance has to be visible at the interaction level. A replay label, model thread IDs, server event origins, downloadable diffs, and recomputable digests matter more than an animated “agent working” indicator.

## Accomplishments we are proud of

- GPT-5.6 discovers and then narrows a real hidden priority rule instead of summarizing a predetermined contract.
- The first candidate visibly fails; the successful result is earned through counterexamples and a fresh host rerun.
- Codex repairs the full workflow module under a one-file allowlist, with no automatic apply, commit, push, or deploy.
- The final matrix covers two observed, one counterexample, two exact-boundary, and one held-out scenario.
- The checked-in proof reports `6/6` passing scenarios, zero mismatches, and digest `sha256:9c4bf000d0b9ae67ef311cb93dd97cf43df914412fdee51f8d6f8ebce59f5fb2`.
- Anyone can download the contract, event evidence, accepted diff, host command log, and proof, then recompute the proof digest locally.

## What we learned

Software migration needs an experimental loop, not a single generation prompt. The most valuable model behavior was not writing more code; it was choosing the next observation that could falsify a confident but unsupported rule. The most valuable system behavior was refusing to let that same model decide that its own answer was correct.

## What is next

- Capture workflows from a real browser target with DOM/API evidence redaction.
- Run the legacy and candidate applications as separate services and database instances.
- Add signed, externally anchored proof manifests and stronger append-only storage.
- Add more workflow and database adapters plus a human approval gate for pull requests and deployment.
- Evaluate behavior-discovery accuracy on unfamiliar applications instead of one controlled laboratory.

## Current limitations

This submission demonstrates one controlled Web returns workflow in a TypeScript process with REST and SQLite. It does not claim universal behavioral equivalence, production-grade multi-tenancy, external payment or carrier verification, arbitrary browser capture, or cryptographically signed proofs. Its proof covers only the six scenarios named in the bundle.

## Links

- Demo: [https://traceforge.axiqo.xyz](https://traceforge.axiqo.xyz)
- Source: [https://github.com/a252937166/traceforge](https://github.com/a252937166/traceforge)
- Evidence guide: [`docs/evidence/live-champion-run/README.md`](evidence/live-champion-run/README.md)
- 100-second demo script: [`docs/demo-script.md`](demo-script.md)
