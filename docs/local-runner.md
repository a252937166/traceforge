# TraceForge Local Runner

TraceForge Local Runner lets a reviewer rebuild the bounded demo workflow with **their own local Codex sign-in** and receive a fresh proof from their own machine.

It is intentionally a hybrid run:

```text
recorded GPT-5.6 archaeology
        -> live local Codex build
        -> live local host verification
        -> fresh local proof + diff
```

The public browser page cannot silently start, inspect, or control a process on a reviewer's computer. The first launch therefore requires one pinned terminal command. Launch clones and installs the pinned release, prepares the fixture and private configuration, starts the loopback server, and checks Codex access. No Codex writing turn or verifier command runs before the reviewer presses **Start local build**. The zero-install [public replay](https://traceforge.axiqo.xyz) remains available when local execution is not possible.

## One-command launch

Open **Build live with your local Codex** on the public site, copy the command for the current platform, and run it in a terminal.

macOS or Linux:

```bash
EXPECTED_SHA="88fd9faa613f0b7280a584a79e209fae800272d9" && RUN_DIR="$(mktemp -d)" && git clone --filter=blob:none --branch local-runner-v0.1.6 https://github.com/a252937166/traceforge.git "$RUN_DIR/traceforge" && cd "$RUN_DIR/traceforge" && ACTUAL_SHA="$(git rev-parse HEAD)" && { test "$ACTUAL_SHA" = "$EXPECTED_SHA" || { echo "Unexpected TraceForge release commit" >&2; exit 64; }; } && export TRACEFORGE_LOCAL_RELEASE_SHA="$ACTUAL_SHA" && NODE_ARCH="$(node -p 'process.arch')" && npm_config_arch="$NODE_ARCH" corepack pnpm install --frozen-lockfile && npm_config_arch="$NODE_ARCH" node --import tsx apps/local-runner/src/cli.ts
```

The command clones the pinned `local-runner-v0.1.6` tag into a new temporary directory and refuses to continue unless it resolves to commit `88fd9faa613f0b7280a584a79e209fae800272d9`. After that comparison succeeds, it exports the checked-out SHA as `TRACEFORGE_LOCAL_RELEASE_SHA`. The Runner independently compares that full value with `git rev-parse HEAD` before preparing a session, then binds the same SHA into `proof.runner.releaseCommit`. It then installs both x64 and arm64 variants of required optional native tools and starts the Runner directly under the active Node binary so `Ctrl-C` remains owned by its cleanup handler. It binds a random-port server to `127.0.0.1` and opens its one-time bootstrap URL. The Runner fetches only the exact `local-runner-fixture-v0.1.4` tag if the pinned historical fixture commit is absent, then verifies that the tag peels to the manifest SHA before use. If the browser does not open, use the localhost URL printed in the terminal.

The two release identities have separate meanings. The **hosted demo release SHA** shown in the public footer and `/api/health` identifies the deployed API/web package. The **local executable release SHA** shown by the launcher, localhost preflight, and local proof identifies the exact checked-out Runner code that executed on the reviewer's machine. They may differ because the hosted deployment can move without changing an immutable Local Runner tag.

This is a one-terminal-command launch, not a browser-to-Codex connection. There is no public WebSocket into Codex, no custom protocol handler, and no cloud relay of the generated source, diff, proof, or credentials in this release.

## Verified real run

The complete `local-runner-v0.1.6` path has been executed from a fresh temporary checkout by clicking **Start local build** on the loopback page. That historical run's captured `gpt-5.6-sol` turn passed `13/13` focused tests, `6/6` differential scenarios, and `30/30` assertions with zero mismatches; UI-triggered deletion then removed the session, writer, verifier, worktree, and Codex lock. The sanitized [proof, diff, preflight, cleanup checks, and full-resolution screenshot](evidence/local-runner-v0.1.6/README.md) remain committed as historical evidence, not as a claim about the updated source profile.

The planned v0.1.7 source profile binds recorded archaeology to live migration `migration_efaa0383-628a-4fba-94df-96bfe344bcbe`, with `4` initial unknowns, `4` resolved unknowns, and `0` remaining. Its immutable repair input is `sha256:afe5ac02691e8929f1600f00bf57247b1915da88b759892087deb3b6e81755b8`, based on source commit `eb0e6169974b96bd3bff3b536b38ef5f665127c2`. The updated local gate is `15/15` focused tests plus six visible scenarios and one post-turn verification-only scenario (`7/7`, `35/35`, zero mismatches when passing). A new v0.1.7 real-run artifact must be captured before those planned-release facts are described as a tagged end-to-end run.

## First-run requirements

- Git.
- Node.js `22.5.0` or newer; Node 22 is recommended.
- Corepack and the repository-pinned pnpm `10.33.2`.
- Codex CLI exactly `0.144.1`, available as `codex` on `PATH`. Check with `codex --version`. To select a specific verified binary, set `TRACEFORGE_CODEX_BIN` to its executable path before launch.
- A ChatGPT account whose Codex model list includes `gpt-5.6-sol`.
- Internet access for the initial clone/install, ChatGPT sign-in, and the Codex service connection. Commands executed by the agent remain network-disabled.
- macOS or Linux, with a browser. A printed localhost URL is the fallback when automatic opening is unavailable. Windows is not supported by this verified release.

The Runner fails closed on a different Codex version. For example, an unsupported binary produces `LOCAL_CODEX_VERSION_UNSUPPORTED:expected=0.144.1:actual=...`; it does not silently continue with an unverified protocol or substitute another model.

## What is recorded and what is live

| Stage | Provenance in the local proof | What the reviewer is observing |
|---|---|---|
| Observe / Infer / Challenge | `recorded-gpt-5.6` | The checked, digest-bound source evidence from the successful GPT-5.6 archaeology run. These model calls are not rerun locally. |
| Build | `live-local-codex` | A new `gpt-5.6-sol` Codex thread on the reviewer's machine edits the incomplete replacement. |
| Verify | `live-local-host` | After the Codex turn closes, the Runner creates a fresh verification-only nonce and executes the deterministic test and differential suites locally. |
| Proof | fresh local artifact | A new `traceforge.local-proof.v1` bundle binds the exact Local Runner executable commit, input, Codex thread/turn, candidate, diff, commands, suite, and limitations by SHA-256 digest. |

This proves that the local build and verification happened during this run. It does not claim that the recorded GPT-5.6 archaeology happened again.

## Dedicated Codex sign-in

The Runner does **not** reuse, copy, or inspect the reviewer's global `~/.codex` directory or `~/.codex/auth.json`. It starts Codex App Server with a dedicated Runner-owned `CODEX_HOME`:

```text
~/.traceforge/local-runner/codex-home
```

On the first run, the localhost page offers **Sign in with ChatGPT**. The Runner opens only an OpenAI- or ChatGPT-owned HTTPS authentication URL and waits for Codex App Server to report completion. The dedicated sign-in persists for later Local Runner sessions. Codex conversation history is configured with `persistence = none`. Build and verification also receive separate private `HOME` and `TMPDIR` roots; the verification App Server uses a second, temporary `CODEX_HOME` with no build credentials.

Set `TRACEFORGE_LOCAL_CODEX_HOME` only when a different dedicated directory is required. The Runner rejects the global `~/.codex`, any directory inside the repository, and any directory inside the temporary session. A PID-bound `0600` lock serializes use of the persistent Runner-owned `CODEX_HOME`; a second active Runner fails closed instead of racing to rewrite the same config.

## Exact local trust boundary

| Component | May read | May write | Network | Git boundary |
|---|---|---|---|---|
| Public website | Public showcase data only | Nothing on the local machine | Public HTTPS only | None |
| Runner host | Pinned manifest, contract, four failed proofs, disclosed scenarios, fixture source, and verifier needed to prepare the run | Private session directories, the Runner-owned Codex config, the temporary verifier candidate, dependencies, and final in-memory artifacts | Clone/install, login, and Codex transport require outbound access | Creates a temporary writer repository and a detached verifier worktree, then removes the verifier worktree during cleanup |
| Build Codex | A minimal writer fixture containing the contract, failed proofs, disclosed scenarios, and incomplete candidate; required runtime/tool roots | Repository write access to `apps/api/src/candidates/generated-return-workflow.ts` only, plus private session `HOME`/`TMPDIR` | Agent/tool command network is disabled; Codex App Server still needs its service transport | Cannot commit, push, merge, deploy, create/check out worktrees, or change the source checkout |
| Verification App Server | A separate detached verifier checkout and required runtime/tool roots | Repository is read-only; only private session `HOME`/`TMPDIR` are writable to its commands | Disabled | Cannot mutate Git state |

The build Codex is not given the legacy implementation, verifier implementation, tests, or the post-turn verification-only input. The Runner also blocks turn-supplied sandbox overrides, arbitrary App Server methods, inherited shell environment, login shells, hooks, plugins, apps, browser/computer use, multi-agent features, and persistent history.

The trusted Runner host performs a frozen, offline dependency check before verification and copies the already-policy-checked candidate into the temporary verifier worktree. The verifier then executes only these two bounded commands through the read-only verification profile:

```text
corepack pnpm --filter @traceforge/api exec node --test --import tsx tests/champion-workflow.test.ts tests/workflow.test.ts
corepack pnpm --filter @traceforge/api exec node --import tsx scripts/verify-generated.ts
```

The first command is the socket-free candidate gate (`15/15` focused tests in the planned v0.1.7 profile). The second emits the seven-scenario suite: six visible scenarios plus one host-generated verification-only scenario. Both run with `network.enabled = false`; the Runner does not enable local binding as a shortcut.

The localhost confirmation and result views show this comparison explicitly:

- **Local gate:** `15` focused candidate tests plus seven differential scenarios.
- **Source champion gate:** `56` candidate-safe tests plus four separate replay-integrity guards.

The local profile removes socket-requiring API harness checks so it can stay network-denied. It still executes the same seven business scenarios and `35` deterministic assertions used for the evidence-bounded conformance claim. Six successful rows compare decision, return status, refund amount, sellable quantity, and quarantine quantity. The exhausted-stock row instead compares failure status, failure code plus message, no return record, unchanged inventory, and zero side effects.

No generated code, diff, proof, token, or Codex history is uploaded to the public TraceForge site.

## Review flow

1. Run the pinned launch command.
2. Review the localhost permission summary. The page shows the fixed repository scope, inputs, hidden verifier material, one writable candidate path, disabled agent network, and Git restrictions.
3. If requested, complete the dedicated ChatGPT sign-in.
4. Confirm that preflight reports Codex CLI `0.144.1`, `gpt-5.6-sol`, and **Ready**.
5. Press **Start local build**.
6. Watch the new Codex thread, candidate-policy check, post-turn input creation, candidate-safe tests, and seven-scenario differential verification.
7. On success, open **Open proof bundle** and **Inspect diff** before deleting the session.
8. Press **Cancel and delete session**, or stop the terminal with `Ctrl-C`.

A failed Codex turn, changed immutable input, unexpected changed file, candidate-policy violation, command failure, malformed suite, or mismatch produces a failed state. The Runner does not issue a passing claim in those cases.

## Proof and diff artifacts

While the localhost session is active, the result page exposes:

- `/api/proof?view=html` as a readable proof view, with `/api/proof?download=1` for `traceforge-local-proof.json`;
- `/api/diff?view=html` as a readable diff view, with `/api/diff?download=1` for `traceforge-local-codex.diff`.

The proof includes provenance, source-run ID, Runner tag and exact executable commit (`runner.releaseCommit`), permission profiles, Codex model/thread/turn and usage, input digests, candidate/source/diff digests, changed files, command exit codes and output digests, the generated verification nonce digest, test totals, the seven-scenario suite, and explicit limitations. The Runner validates `runner.releaseCommit` against the actual checkout SHA before preparation; it is distinct from the hosted deployment SHA.

Save either browser response before deleting the session if a durable copy is needed. The endpoints are local and become unavailable after deletion. SHA-256 makes the proof recomputable for integrity; it is not a digital signature, trusted timestamp, identity attestation, or proof of universal behavioral equivalence. The claim remains limited to the seven executed scenarios and their five scenario-appropriate assertions.

## Cleanup

**Cancel and delete session**, `Ctrl-C`, and `SIGTERM` close both App Server processes and remove the temporary writer/verifier workspaces and in-memory proof/diff. Closing only the browser tab does not stop the terminal process or delete the session.

Two items deliberately outlive session deletion:

1. The pinned repository clone created by the launch command remains under the OS temporary directory. From the same shell, remove it after the Runner exits:

   ```bash
   rm -rf "$RUN_DIR"
   ```

2. The dedicated Codex sign-in remains at `~/.traceforge/local-runner/codex-home` so the next run does not require another login. Delete that directory only when the dedicated Local Runner credentials and configuration should be removed:

   ```bash
   rm -rf "${TRACEFORGE_LOCAL_CODEX_HOME:-$HOME/.traceforge/local-runner/codex-home}"
   ```

An ungraceful process kill or power loss can leave a temporary session directory or stale worktree metadata. Remove the corresponding OS-temp `traceforge-local-*` directory and run `git worktree prune` inside the pinned checkout if needed.

## Troubleshooting

| Symptom or code | Meaning and next check |
|---|---|
| `codex: command not found` or `LOCAL_CODEX_VERSION_CHECK_FAILED` | Install/activate the verified Codex CLI, confirm `codex --version`, or point `TRACEFORGE_CODEX_BIN` to the executable. |
| `LOCAL_CODEX_VERSION_UNSUPPORTED` | The installed CLI is not exactly `0.144.1`. Use the verified release; the Runner intentionally has no compatibility fallback. |
| `LOCAL_CODEX_HOME_IN_USE` | Another live Local Runner owns the dedicated Codex home. Finish or cancel that session before retrying. A stale dead-process lock is recovered once automatically. |
| `LOCAL_MODEL_UNAVAILABLE` | The signed-in ChatGPT account did not advertise `gpt-5.6-sol`. Use an eligible account; no alternate model is substituted. |
| `LOCAL_LOGIN_FAILED` or `LOCAL_LOGIN_INCOMPLETE` | Retry preflight/sign-in, finish the OpenAI/ChatGPT browser flow, and check that the Codex service is reachable. |
| Browser did not open | Open the one-time `http://127.0.0.1:...` URL printed by the terminal. The Runner is not exposed on the LAN. |
| `LOCAL_CODEX_HOME_MUST_BE_DEDICATED` | Remove an unsafe override. Use the default directory or a dedicated path outside `~/.codex`, the repository, and the session. |
| `LOCAL_RELEASE_SHA_REQUIRED`, `LOCAL_RELEASE_SHA_INVALID`, or `LOCAL_RELEASE_SHA_MISMATCH` | The executable checkout was not bound to the verified full release SHA. Stop and launch with the pinned public command; do not set this variable manually to bypass the tag check. |
| `LOCAL_FIXTURE_DIGEST_MISMATCH`, `LOCAL_REPAIR_INPUT_DIGEST_MISMATCH`, or `LOCAL_BASE_CANDIDATE_DIGEST_MISMATCH` | The pinned fixture no longer matches its manifest. Stop; do not bypass the check. Re-clone the pinned tag. |
| `LOCAL_APP_SERVER_PERMISSION_PROFILE_MISMATCH` or another permission-policy error | The hardened App Server profile was not applied exactly. Stop and use a clean pinned checkout with the verified Codex version. |
| Build or verification ends in **Failed** | Inspect the displayed error, proof (when available), and diff. A failure is an honest result, not a request to weaken the gate. |

## Zero-install fallback

If a reviewer cannot install software, cannot sign in, lacks the exact Codex version/model, or is on a locked-down machine, use [traceforge.axiqo.xyz](https://traceforge.axiqo.xyz). **Replay a verified run** requires no local Codex and no credentials. It replays the recorded GPT-5.6/Codex events with disclosed provenance, then reruns the deterministic host differential suite and emits fresh hosted artifacts. It is the default judging path; Local Runner is an optional stronger hands-on proof.
