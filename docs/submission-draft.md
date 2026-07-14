# Devpost submission draft

> Draft only. Reconcile the final category, repository visibility, video limit, and eligibility fields with the official rules before submission.

## Project name

TraceForge

## Tagline

Modernize undocumented workflows without guessing.

## One-line pitch

TraceForge uses GPT-5.6 to turn observed workflow behavior into an evidence-bounded contract, gives that contract and its failures to Codex for a constrained rebuild, and lets an independent host verifier decide what actually matches.

## Short description

TraceForge is an evidence-bounded behavior migration system for undocumented business workflows. It observes runtime decisions and database side effects, asks GPT-5.6 Sol to form and challenge evidence-linked hypotheses, gives Codex the resulting contract and failed proofs in an isolated worktree, and issues a downloadable proof only after a deterministic host verifier passes the executed scenarios.

## Inspiration

Teams keep critical legacy systems alive because their real specifications are scattered across UI behavior, database side effects, operator memory, and exceptions nobody documented. A code generator can reproduce a screen, but it cannot tell a team whether a refund, approval, or inventory rule was silently changed.

We built TraceForge around a different question: can an AI system expose what it does not yet know, request the experiment that resolves the ambiguity, rebuild from the resulting evidence, and then submit to a verifier the code-writing agent does not control?

## What it does

TraceForge runs one migration through five server-owned stages:

1. **Observe** captures two legacy traces and their SQLite before/after state.
2. **Infer** asks a read-only GPT-5.6 Sol Trace Archaeologist for bounded rules, invariants, and unknowns. Every claim must cite supplied evidence IDs.
3. **Challenge** asks Counterexample Hunter turns for high-information inputs. The host—not the model—executes them, probes the exact boundary, and gives fresh evidence to a Contract Critic.
4. **Build** gives Codex the evidence-bounded contract, all four failed proofs, and only disclosed scenarios. Codex may change one workflow file in a detached worktree; it cannot edit the verifier, commit, push, or deploy.
5. **Verify** waits for the writing turn to end, generates one concrete verification-only input, resets legacy and candidate state, and runs six visible scenarios plus the new verification-only scenario.

The demonstration starts with a $45 standard damaged return and a $120 VIP damaged return. Those observations establish two points, not a general policy. A crossed VIP-at-$45 input separates tier from amount. A high-value trace and deterministic boundary probes then establish an undocumented priority rule: damaged returns at or above $500 enter manual review before payment or inventory side effects, even for VIP customers. A zero-stock replacement probe establishes a second hidden requirement: fail before persistence with `INSUFFICIENT_SELLABLE_STOCK`, no return record, unchanged inventory, and zero side effects. The unknown lifecycle is visible and enforced: `4` initial blocking unknowns become `4` evidence-linked resolutions with `0` remaining before Build. Codex repairs the candidate's rule priority, inventory behavior, and stockout atomicity. The host suite passes `7/7` scenarios, `35/35` assertions, and zero mismatches.

## How we built it

- `gpt-5.6-sol` for four read-only, schema-constrained evidence turns: Trace Archaeologist, two Counterexample Hunter turns, and Contract Critic.
- Host validation that rejects unknown evidence IDs and executes every proposed scenario itself.
- Codex SDK for the single code-writing role, isolated in a retained detached Git worktree.
- Immutable repair inputs containing the exact contract, four failed proofs, and disclosed scenario pack.
- TypeScript and Express for migration jobs, REST APIs, native Server-Sent Events, artifact downloads, and execution-mode enforcement.
- SQLite for separate legacy and candidate state partitions plus migration events and artifacts.
- React for a five-stage evidence workbench derived from server events rather than client-side timers.
- SHA-256 digests for model inputs and outputs, replay source, artifacts, candidate source and diff, and recomputable proof bodies.

## Where GPT-5.6 is essential

GPT-5.6 is not a chat layer or a label on deterministic extraction. In successful live migration `migration_efaa0383-628a-4fba-94df-96bfe344bcbe` it performed four evidence-producing turns totaling `121,673` tokens:

| Role | Thread | Tokens |
|---|---|---:|
| Trace Archaeologist | `019f5240-6ff5-7c32-ac67-a52975f6e615` | 23,811 |
| Counterexample Hunter, crossed input | `019f5241-653a-72a2-8456-4283f3b6746b` | 23,723 |
| Counterexample Hunter, high-value exception | `019f5242-2a73-7ea1-86e6-b8fc550c5abc` | 24,267 |
| Contract Critic | `019f5242-e670-75f3-8d38-8fb3e8ba448e` | 49,872 |

The evidence bundle includes each bounded application prompt, final structured output, thread ID, timing, token usage, input/output digest, evidence IDs, and schema version. The model may propose a scenario or a rule, but it cannot execute the workflow, modify code, or declare verification success.

## Where Codex is essential

Codex thread `019f5244-7bef-71f2-8f25-8ed1446a539e` started from commit `eb0e6169974b96bd3bff3b536b38ef5f665127c2` and changed only `apps/api/src/candidates/generated-return-workflow.ts`.

Its repair input is inspectable: aggregate digest `sha256:afe5ac02691e8929f1600f00bf57247b1915da88b759892087deb3b6e81755b8`, contract digest `sha256:235acdcc4a120bf5965035dc8c43658dac534a4f85da7bbc78b26c01fcafc716`, four failed-proof digests, and the exact disclosed scenario IDs. The accepted source digest is `sha256:fdf9a85c55e6a007320a5613672ba3354fb785d307c57f7201357bdc7b1c9e74`; the diff digest is `sha256:4e2841074c97edaacd151318cdcc1fc8e0b9ba72f50d47c40d0a5c4a6a21577a`.

After the turn, the host ran `56/56` candidate-safe tests. Four replay-source guards were deliberately kept outside the modified candidate worktree gate; the full repository release gate runs them separately. Only then did the host execute seven scenarios and issue the final evidence-bounded proof.

## Truthful live, replay, and deterministic modes

- **Live AI** performs fresh GPT-5.6 and Codex work. If either adapter is unavailable, the job fails; TraceForge never substitutes another result.
- **Replay a verified run** visibly streams the successful source run with its original timestamp and provenance. No model call occurs during playback, but the host suite executes again and issues fresh artifacts.
- **Host-only proof** skips all model stages and claims only the host verification it actually runs.

The public deployment does not expose an anonymous live-model trigger. It leads with a disclosed replay that streams recorded GPT-5.6 and Codex provenance, then executes a fresh host proof. Reviewers who want a fresh Codex writing turn use the separately pinned, loopback-only Local Runner on their own machine.

## Challenges we ran into

The hardest challenge was preventing plausible AI output from becoming product truth. We had to make ambiguity a first-class state, constrain outputs to evidence IDs, keep scenario execution on the host, pass actual failed proofs into the writing turn, and stop the code-writing agent from certifying its own work.

The development evidence also preserves failures. One run timed out while starting the SDK child, one correctly refused to extrapolate beyond the contract's evidence boundary, and one correct candidate was falsely rejected because replay-integrity tests had been mixed into the candidate worktree gate. We fixed the gate by separating `56` candidate-safe tests from four replay-only guards; we did not weaken the business assertions or rewrite the failed history.

## Accomplishments we are proud of

- Four real GPT-5.6 turns produce inspectable evidence and an explicit bounded contract rather than a predetermined summary.
- The contract exposes `4` initial, `4` resolved, and `0` remaining unknowns; the host blocks Build if an in-scope blocking unknown survives.
- The contract, every failed proof, and the exact disclosed scenario pack are material inputs to the Codex turn.
- Codex repairs a complete workflow module under a one-file allowlist, with no automatic apply, commit, push, or deploy.
- A concrete verification-only input is generated by the host only after the Codex writing turn has ended.
- The candidate passes `56/56` candidate-safe tests; four replay-only integrity guards remain separately visible.
- The final matrix covers two observed, two counterexample, two boundary, and one verification-only scenario.
- Six successful rows compare decision, status, refund, sellable inventory, and quarantine inventory; the stockout row compares failure status, code plus message, no return record, unchanged inventory, and zero side effects.
- The successful live proof reports `7/7` scenarios, `35/35` assertions, zero mismatches, and digest `sha256:4be44d476f222ca492d025a13f296997148142471e2387d532c61479bc3703bc`.
- Anyone can inspect the raw bounded GPT and Codex inputs and outputs, contract, failed-proof digests, accepted diff, host command log, and final proof.
- Reviewers can optionally execute Build + Verify through the pinned Local Runner. The exercised release produced a fresh Codex thread, a one-file diff, a post-turn verification-only input, `15/15` focused tests, `7/7` scenarios, `35/35` assertions, and a digest-bound local proof.

## What we learned

Software migration needs an experimental loop, not a single generation prompt. The most valuable model behavior was choosing the next observation that could distinguish plausible rules. The most valuable system behavior was preserving the evidence boundary and refusing to let the writer grade itself.

## What is next

- Capture workflows from a real browser target with DOM/API evidence redaction.
- Run legacy and candidate applications as separate services and database instances.
- Add signed, externally anchored proof manifests and stronger append-only storage.
- Add more workflow and database adapters plus a human approval gate for pull requests and deployment.
- Evaluate behavior-discovery accuracy on unfamiliar applications instead of one controlled laboratory.

## Current limitations

This submission demonstrates one controlled Web returns workflow in a TypeScript process with REST and SQLite. It does not claim universal behavioral equivalence, production-grade multi-tenancy, external payment or carrier verification, arbitrary browser capture, or cryptographically signed proofs. Its proof covers only seven executed scenarios and five deterministic assertions per scenario, with success fields and failure atomicity kept distinct. The raw proof schema names the final partition `held-out`; the product calls it **verification-only** because that is the precise public claim, not statistical generalization.

## Links

- Demo: [https://traceforge.axiqo.xyz](https://traceforge.axiqo.xyz)
- Source: [https://github.com/a252937166/traceforge](https://github.com/a252937166/traceforge)
- Evidence guide: [`docs/evidence/live-champion-run/README.md`](evidence/live-champion-run/README.md)
- 100-second demo script: [`docs/demo-script.md`](demo-script.md)
