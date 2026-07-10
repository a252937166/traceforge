# Devpost submission draft

> Draft only. Tracks, prize categories, video limits, repository visibility, and eligibility must be reconciled with the official rules when published.

## Project name

TraceForge

## Tagline

Show the workflow. Ship the replacement—with evidence.

## Short description

TraceForge executes a controlled legacy workflow and replacement candidate, turns runtime evidence into a bounded behavior contract, can use an opt-in Codex SDK turn to repair one candidate file, and independently verifies the fresh result.

## Inspiration

Teams keep critical workflows alive because the real rules live in UI behavior, database side effects, and operator memory—not in documentation. Code generation can create a new interface, but it cannot by itself prove that refunds, approvals, or inventory still behave correctly.

## What it does

The current MVP executes a synthetic legacy reference and separately coded candidate against the same damaged-return scenario. It records workflow events and SQLite before/after state, derives a deterministic evidence-linked contract, and compares five business fields. An opt-in Codex SDK endpoint can edit one whitelisted generated-candidate file in a retained worktree. The host then runs tests and a fresh verification before the proof console can seal the result. The earlier failed proof remains evidence.

## How it was built

- Planned, not active: GPT-5.6 Responses Multi-agent for read-only rule archaeology and counterexample generation.
- Codex SDK as the single candidate-code writer in a retained worktree, restricted to one file and disabled by default.
- TypeScript services with SQLite fixtures and deterministic differential verification.
- React proof console for staged trace, mismatch, repair, and proof visualization.

Any capability not active in the submitted build will be removed or labeled as planned before submission.

## Challenges

The hardest problem is not generating code. It is separating observed facts from plausible guesses and preventing the system that writes a candidate from certifying its own work.

## Accomplishments

- Evidence-linked rules rather than free-form summaries.
- A mutation test that proves the verifier can catch a business-side-effect regression.
- Explicit coverage boundaries and unresolved unknowns.
- A real Codex SDK repair attempt whose first host-verification failure was preserved and whose retry produced a fresh zero-mismatch proof.
- A reproducible API proof loop with a separately tested React presentation; browser-to-live-API E2E remains pending.

## What is next

Add browser-extension capture, signed proof bundles, additional database adapters, and maintainer-approved pull-request publication.
