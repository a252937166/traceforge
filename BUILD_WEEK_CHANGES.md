# Build Week change ledger

This ledger separates the pre-event project from the meaningful work completed
during OpenAI Build Week. TraceForge existed before the submission window; the
historical source archaeology and source proof are not presented as event-period
work.

The official Submission Period opened on **2026-07-13 at 09:00 Pacific Time**
(`2026-07-13T16:00:00Z`). Existing projects are evaluated only on meaningful
extensions made after that time, so every event-period claim below is bound to a
dated commit, CI run, or proof artifact.

## Event-start baseline

- Exact `main` commit immediately before the window:
  `131ca0fdc681d964ecbce0234ae249fa340101b2`.
- Baseline commit time: `2026-07-12T06:49:57Z`.
- Baseline subject: `Align runtime with unflagged Node SQLite`.
- Earlier hosted release recorded before the event:
  `652afb576815924607cecf9a632c0eb7f988e195`, built
  `2026-07-12T04:25:07.768Z`.
- Pre-existing work includes the core `Observe -> Infer -> Challenge -> Build ->
  Verify` architecture, the authenticated source GPT-5.6 archaeology, and the
  historical source proof.

Reproduce the baseline selection with:

```bash
git rev-list -1 --before="2026-07-13T16:00:00Z" main
```

## Meaningful extensions completed during Build Week

| UTC time | Commit / artifact | Event-period extension | Verification |
|---|---|---|---|
| `2026-07-14T03:30:02Z` | [PR #2](https://github.com/a252937166/traceforge/pull/2) / `d9b0d853acc7cab36eba859a778763c231e37325` | Hardened Local Runner v0.1.10: fail-closed `OUTSIDE_EVIDENCE_BOUNDARY`, host-owned refusal probe, current-proof verifier, historical v2 envelope verification, Node preflight, immutable tag/commit checks, and one-file writer custody. | API `85/85`; Web `17/17`; Local Runner `56` pass plus one intentional real-server skip; API/UI acceptance; repeatability `3/3`; [CI](https://github.com/a252937166/traceforge/actions/runs/29303663267). |
| `2026-07-14T03:54:26Z` | [PR #3](https://github.com/a252937166/traceforge/pull/3) / `343fbbb5ddad828c18b0f618893c50a6cb1d50a1` | Published the real v0.1.10 Local Runner run: preflight, changed-file diff, proof, cleanup report, summary, and full-resolution loopback screenshot. | Real `gpt-5.6-sol` Codex turn; `16/16` host gates; `7/7` scenarios; `35/35` assertions; stockout `5/5`; zero mismatches; proof `sha256:b67ba62f1e5cae421d96e8b28596a456f5234f8a303a070e67dcf5244832c272`; [CI](https://github.com/a252937166/traceforge/actions/runs/29304635286). |
| `2026-07-14T04:02:34Z` | [PR #4](https://github.com/a252937166/traceforge/pull/4) / `412973de86bdd9ad5253ec8a4cbcee365b704afd` | Activated v0.1.10 across every active reviewer surface and linked the immutable real-run evidence while preserving older versions as historical records. | `pnpm acceptance:all`; final [CI run](https://github.com/a252937166/traceforge/actions/runs/29304969532) completed successfully at `2026-07-14T04:04:52Z`. |
| `2026-07-14T04:03:19.672Z` | Production artifact build | Built the PR #4 commit as `traceforge-v0.1.10`. The public deployment keeps write-capable model adapters disabled and exposes recorded provenance plus fresh host verification. | `https://traceforge.axiqo.xyz/api/health` reports SHA `412973de86bdd9ad5253ec8a4cbcee365b704afd`, version `traceforge-v0.1.10`, and the same build timestamp. Public cutover was confirmed by `2026-07-14T04:06:36.759Z`. |
| `2026-07-14T06:37:54Z` | [Final judge demo](https://youtu.be/xQnKzDhUCl0) | Published a new 2:44 judge film that opens on the writer/verifier separation, shows the counterexamples and rejected candidate, labels recorded versus fresh work, and discloses the pre-existing baseline before describing the Build Week extensions. | Frozen MP4 `sha256:fe2248ee4340a66847313ccf55675a811c8e99a86a6f42e5319dd5a46cfc0a8d`; native 1920x1080 H.264/AAC; 33 burned subtitle cues; no detected black segment over 0.5 seconds; YouTube processing succeeded. |

## Event-period Codex evidence

- Required `/feedback` continuing development session (opened
  `2026-07-10T06:51:10.310Z`, then continued with timestamped event-period work):
  `019f4acb-6066-75b1-b21b-a8fea13719b9`.
- Real Local Runner Codex thread:
  `019f5eb8-3394-7bc0-ae68-0c134f314c7f`.
- Real Local Runner turn:
  `019f5eb8-33c2-7422-97dc-50634eebc484`.
- Pinned Local Runner release: `local-runner-v0.1.10`, peeled to
  `d9b0d853acc7cab36eba859a778763c231e37325`.
- Immutable Local Runner evidence commit:
  `343fbbb5ddad828c18b0f618893c50a6cb1d50a1`.

## Scope statement for judges

> TraceForge existed before the submission window. During Build Week, I
> extended it with the hardened v0.1.10 Local Runner, fail-closed evidence
> boundaries, current proof verification, immutable release checks, and a real
> locally executed Codex proof package.

The event-period work strengthens the judge-runnable Developer Tools experience
and the system's enforcement boundaries. It does not relabel the pre-event
source archaeology as new work.

## Ledger rules

1. Never backdate an entry.
2. Link each event-period claim to a commit, CI run, screenshot, or proof digest.
3. Keep pre-event architecture and evidence clearly identified as pre-existing.
4. Treat the [Official Rules](https://openai.devpost.com/rules) as the source of
   truth for dates and requirements.
