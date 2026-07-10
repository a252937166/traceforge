# Devpost submission draft

> Draft only. Tracks, prize categories, video limits, repository visibility, and eligibility must be reconciled with the official rules when published.

## Project name

TraceForge

## Tagline

Show the workflow. Ship the replacement—with evidence.

## Short description

TraceForge observes a legacy business workflow, turns runtime evidence into a bounded behavior contract, uses Codex to build or repair a replacement, and independently verifies both systems against the same scenarios.

## Inspiration

Teams keep critical workflows alive because the real rules live in UI behavior, database side effects, and operator memory—not in documentation. Code generation can create a new interface, but it cannot by itself prove that refunds, approvals, or inventory still behave correctly.

## What it does

TraceForge captures UI, HTTP, and entity-state evidence; associates each inferred rule with its sources and uncertainty; gives a reviewed contract to one Codex code-writing agent; and then runs the original and candidate side by side. Deterministic assertions verify business state, while the proof bundle preserves both failures and successful reruns.

## How it was built

- GPT-5.6 Responses Multi-agent for read-only rule discovery and counterexample generation, when officially available.
- Codex SDK as the single candidate-code writer in an isolated worktree.
- TypeScript services with SQLite fixtures and deterministic differential verification.
- React proof console for synchronized replay and evidence drill-down.

Any capability not active in the submitted build will be removed or labeled as planned before submission.

## Challenges

The hardest problem is not generating code. It is separating observed facts from plausible guesses and preventing the system that writes a candidate from certifying its own work.

## Accomplishments

- Evidence-linked rules rather than free-form summaries.
- A mutation test that proves the verifier can catch a business-side-effect regression.
- Explicit coverage boundaries and unresolved unknowns.
- A reproducible end-to-end returns workflow rather than a prerecorded chat.

## What is next

Add browser-extension capture, signed proof bundles, additional database adapters, and maintainer-approved pull-request publication.

