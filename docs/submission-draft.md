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
4. **Build** gives Codex the evidence-bounded contract, all three failed proofs, and only disclosed scenarios. Codex may change one workflow file in a detached worktree; it cannot edit the verifier, commit, push, or deploy.
5. **Verify** waits for the writing turn to end, generates one concrete verification-only input, resets legacy and candidate state, and compares decision, status, refund amount, sellable inventory, and quarantine inventory across six scenarios.

The demonstration starts with a $45 standard damaged return and a $120 VIP damaged return. Those observations establish two points, not a general policy. A crossed VIP-at-$45 input separates tier from amount. A high-value trace and deterministic boundary probes then establish an undocumented priority rule: damaged returns at or above $500 enter manual review before payment or inventory side effects, even for VIP customers. Codex repairs the candidate's rule priority and inventory behavior. The host suite passes `6/6` scenarios, `30/30` assertions, and zero mismatches.

## How we built it

- `gpt-5.6-sol` for four read-only, schema-constrained evidence turns: Trace Archaeologist, two Counterexample Hunter turns, and Contract Critic.
- Host validation that rejects unknown evidence IDs and executes every proposed scenario itself.
- Codex SDK for the single code-writing role, isolated in a retained detached Git worktree.
- Immutable repair inputs containing the exact contract, three failed proofs, and disclosed scenario pack.
- TypeScript and Express for migration jobs, REST APIs, native Server-Sent Events, artifact downloads, and execution-mode enforcement.
- SQLite for separate legacy and candidate state partitions plus migration events and artifacts.
- React for a five-stage evidence workbench derived from server events rather than client-side timers.
- SHA-256 digests for model inputs and outputs, replay source, artifacts, candidate source and diff, and recomputable proof bodies.

## Where GPT-5.6 is essential

GPT-5.6 is not a chat layer or a label on deterministic extraction. In the successful live source run it performed four evidence-producing turns totaling `115,565` tokens:

| Role | Thread | Tokens |
|---|---|---:|
| Trace Archaeologist | `019f4fd5-00a1-76c3-bf42-5e821800ad3c` | 22,936 |
| Counterexample Hunter, crossed input | `019f4fd5-cf26-7180-89ee-360a62e3d5b8` | 22,483 |
| Counterexample Hunter, high-value exception | `019f4fd6-6541-7452-b9eb-217a27e54f68` | 24,193 |
| Contract Critic | `019f4fd7-1f71-79c2-b461-33647571d2a7` | 45,953 |

The evidence bundle includes each bounded application prompt, final structured output, thread ID, timing, token usage, input/output digest, evidence IDs, and schema version. The model may propose a scenario or a rule, but it cannot execute the workflow, modify code, or declare verification success.

## Where Codex is essential

Codex thread `019f4fd8-5408-7752-b8fa-f8c6b08b33ef` started from commit `7c1dceeaee7f375beb8d2895fda502f2ad74e039` and changed only `apps/api/src/candidates/generated-return-workflow.ts`.

Its repair input is inspectable: contract digest `sha256:d4dfc557658fc4e2839a4db5809705586e130c6bd9ef3b9e27f14c700eccaa4f`, three failed-proof digests, and the exact disclosed scenario IDs. The accepted source digest is `sha256:b890c0d27c0857e2bc47be608a1ade5619eb10d784a0428f1ae861c7eb1bf708`; the diff digest is `sha256:99d556cd803383557773258d55cdddac12d0aad3c631d31171ceaf27c7e9f49c`.

After the turn, the host ran `42/42` candidate-safe tests. Four replay-source guards were deliberately kept outside the modified candidate worktree gate; the full repository release gate runs them separately. Only then did the host execute six scenarios and issue the final evidence-bounded proof.

## Truthful live, replay, and deterministic modes

- **Live AI** performs fresh GPT-5.6 and Codex work. If either adapter is unavailable, the job fails; TraceForge never substitutes another result.
- **Replay a verified run** visibly streams the successful source run with its original timestamp and provenance. No model call occurs during playback, but the host suite executes again and issues fresh artifacts.
- **Host-only proof** skips all model stages and claims only the host verification it actually runs.

The public deployment keeps write-capable live adapters disabled. Its health response presents **New live AI run** as a deliberately secured capability, while the actionable verified replay remains selected and immediately runnable.

## Challenges we ran into

The hardest challenge was preventing plausible AI output from becoming product truth. We had to make ambiguity a first-class state, constrain outputs to evidence IDs, keep scenario execution on the host, pass actual failed proofs into the writing turn, and stop the code-writing agent from certifying its own work.

The development evidence also preserves failures. One run timed out while starting the SDK child, one correctly refused to extrapolate beyond the contract's evidence boundary, and one correct candidate was falsely rejected because replay-integrity tests had been mixed into the candidate worktree gate. We fixed the gate by separating `42` candidate-safe tests from four replay-only guards; we did not weaken the business assertions or rewrite the failed history.

## Accomplishments we are proud of

- Four real GPT-5.6 turns produce inspectable evidence and an explicit bounded contract rather than a predetermined summary.
- The contract, every failed proof, and the exact disclosed scenario pack are material inputs to the Codex turn.
- Codex repairs a complete workflow module under a one-file allowlist, with no automatic apply, commit, push, or deploy.
- A concrete verification-only input is generated by the host only after the Codex writing turn has ended.
- The candidate passes `42/42` candidate-safe tests; four replay-only integrity guards remain separately visible.
- The final matrix covers two observed, one counterexample, two boundary, and one verification-only scenario.
- The successful live proof reports `6/6` scenarios, `30/30` assertions, zero mismatches, and digest `sha256:4ff6eba63043e50052cab81a6adab5a7a6c49d1bcb19a93c42bee25453a13241`.
- Anyone can inspect the raw bounded GPT and Codex inputs and outputs, contract, failed-proof digests, accepted diff, host command log, and final proof.

## What we learned

Software migration needs an experimental loop, not a single generation prompt. The most valuable model behavior was choosing the next observation that could distinguish plausible rules. The most valuable system behavior was preserving the evidence boundary and refusing to let the writer grade itself.

## What is next

- Capture workflows from a real browser target with DOM/API evidence redaction.
- Run legacy and candidate applications as separate services and database instances.
- Add signed, externally anchored proof manifests and stronger append-only storage.
- Add more workflow and database adapters plus a human approval gate for pull requests and deployment.
- Evaluate behavior-discovery accuracy on unfamiliar applications instead of one controlled laboratory.

## Current limitations

This submission demonstrates one controlled Web returns workflow in a TypeScript process with REST and SQLite. It does not claim universal behavioral equivalence, production-grade multi-tenancy, external payment or carrier verification, arbitrary browser capture, or cryptographically signed proofs. Its proof covers only six executed scenarios and five asserted fields per scenario. The raw proof schema names the final partition `held-out`; the product calls it **verification-only** because that is the precise public claim, not statistical generalization.

## Links

- Demo: [https://traceforge.axiqo.xyz](https://traceforge.axiqo.xyz)
- Source: [https://github.com/a252937166/traceforge](https://github.com/a252937166/traceforge)
- Evidence guide: [`docs/evidence/live-champion-run/README.md`](evidence/live-champion-run/README.md)
- 100-second demo script: [`docs/demo-script.md`](demo-script.md)
