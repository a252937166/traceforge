import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  getRuntimeCapabilities,
  getMigration,
  getMigrationArtifacts,
  getMigrationProof,
  startMigration,
  subscribeToMigration,
  type MigrationTransport,
} from './api'
import { createMigrationState, reduceMigrationEvent } from './event-reducer'
import {
  migrationStages,
  type ExecutionMode,
  type MigrationArtifact,
  type MigrationEvent,
  type MigrationCandidate,
  type MigrationState,
  type ProofBundle,
  type ReleaseIdentity,
} from './migration-types'

const modeCopy: Record<ExecutionMode, { title: string; label: string; detail: string }> = {
  'recorded-replay': {
    title: 'Replay a verified run',
    label: 'Interactive replay · recorded AI, fresh proof',
    detail: 'Streams the captured GPT-5.6 and Codex events, executes the candidate, and issues a new host-owned proof bundle.',
  },
  'deterministic-only': {
    title: 'Host-only proof',
    label: 'Host verifier · no model',
    detail: 'Runs the deterministic workflow and proof path only. No GPT or Codex execution is claimed.',
  },
  'live-ai': {
    title: 'New live AI run',
    label: 'GPT-5.6 + Codex · credentialled',
    detail: 'Calls the configured models now. If either model is unavailable, the run stops and reports the failure.',
  },
}

const publicModeOrder: ExecutionMode[] = ['recorded-replay', 'deterministic-only']
const repositoryUrl = 'https://github.com/a252937166/traceforge'
const publishedEvidenceCommit = 'f0ede87cb763e3c9f0776f263cbd61ce63d8c770'
const liveRunEvidenceUrl = `${repositoryUrl}/tree/${publishedEvidenceCommit}/docs/evidence/live-champion-run`
const proofVerificationUrl = `${repositoryUrl}/blob/${publishedEvidenceCommit}/README.md#verify-the-proof-digest-locally`
const localRunnerRepository = 'a252937166/traceforge'
const localRunnerTag = 'local-runner-v0.1.9'
const localRunnerCommit = 'a2ce8b2394caf5d1491c2b142f99a8421f3cec2d'
const localRunnerCommitShort = localRunnerCommit.slice(0, 7)
const localRunnerSourceUrl = `https://github.com/${localRunnerRepository}/tree/${localRunnerCommit}`
const localRunnerTagUrl = `https://github.com/${localRunnerRepository}/tree/${localRunnerTag}`
const localRunnerEvidenceUrl = `${repositoryUrl}/tree/${publishedEvidenceCommit}/docs/evidence/local-runner-v0.1.9`

const localRunnerCommand = `EXPECTED_SHA="${localRunnerCommit}" && RUN_DIR="$(mktemp -d)" && git clone --filter=blob:none --branch ${localRunnerTag} https://github.com/${localRunnerRepository}.git "$RUN_DIR/traceforge" && cd "$RUN_DIR/traceforge" && ACTUAL_SHA="$(git rev-parse HEAD)" && { test "$ACTUAL_SHA" = "$EXPECTED_SHA" || { echo "Unexpected TraceForge release commit" >&2; exit 64; }; } && export TRACEFORGE_LOCAL_RELEASE_SHA="$ACTUAL_SHA" && NODE_ARCH="$(node -p 'process.arch')" && npm_config_arch="$NODE_ARCH" corepack pnpm install --frozen-lockfile && npm_config_arch="$NODE_ARCH" node --import tsx apps/local-runner/src/cli.ts`

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('Clipboard access is unavailable.')
}

function formatTime(value?: string): string {
  if (!value) return 'Pending'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { hour12: false })
}

function releaseLabel(release: ReleaseIdentity): string {
  const version = release.version.startsWith('local-runner-')
    ? `Local Runner ${release.version.slice('local-runner-'.length)}`
    : release.version
  return `Release ${release.sha.slice(0, 7)} · ${version}`
}

function formatBytes(value?: number): string {
  if (!value) return 'size pending'
  if (value < 1024) return `${value} B`
  return `${(value / 1024).toFixed(1)} KB`
}

function formatScenarioValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.map(formatScenarioValue).join(' · ')
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key} ${formatScenarioValue(entry)}`)
      .join(' · ')
  }
  return String(value)
}

function formatCount(value?: number): string {
  return value === undefined ? 'Not reported' : value.toLocaleString('en-US')
}

function formatShort(value?: string, visible = 12): string {
  if (!value) return 'Not reported'
  return value.length > visible ? `${value.slice(0, visible)}…` : value
}

function formatDigest(value?: string): string {
  if (!value) return 'Not reported'
  const [algorithm, digest = algorithm] = value.split(':', 2)
  const short = formatShort(digest, 7)
  return value.includes(':') ? `${algorithm}:${short}` : short
}

function displayTerminology(value?: string): string | undefined {
  return value?.replace(/\bheld-out\b/gi, 'verification-only')
}

function scenarioPartitionLabel(scenario: NonNullable<ProofBundle['scenarios']>[number]): string {
  if (scenario.partition === 'held-out') return 'verification-only'
  if (scenario.partition !== 'counterexample') return scenario.partition
  if (scenario.provenance?.source === 'model-proposed') return 'GPT-proposed'
  if (scenario.provenance?.source === 'host-derived') return 'host-derived'
  return 'host verification'
}

function modeDisclosure(mode: ExecutionMode, state: MigrationState): string {
  if (mode === 'recorded-replay') {
    return state.job?.replay
      ? `The authenticated model work was recorded ${formatTime(state.job.replay.recordedAt)}. This replay streams those provenance-bound events, then the host executes all seven scenarios and issues a fresh proof. No model call is made during replay.`
      : 'Run the complete migration now. GPT-5.6 and Codex events replay with their original provenance; the host then executes all seven scenarios and issues a fresh proof. No model call is claimed during replay.'
  }
  return modeCopy[mode].detail
}

function actionLabel(mode: ExecutionMode, again: boolean): string {
  if (mode === 'recorded-replay') return again ? 'Run the verified migration again' : 'Run the verified migration'
  if (mode === 'deterministic-only') return again ? 'Run the host proof again' : 'Run the host proof'
  return again ? 'Start a new live AI run' : 'Start live AI migration'
}

function actionHelper(mode: ExecutionMode): string {
  if (mode === 'recorded-replay') return 'No sign-in · server-paced SSE · fresh proof bundle'
  if (mode === 'deterministic-only') return 'No model · deterministic execution · fresh proof bundle'
  return 'Requires secured GPT-5.6 and Codex access'
}

function transportLabel(transport: MigrationTransport, state: MigrationState): string {
  if (transport === 'sse') return 'SSE live'
  if (transport === 'polling') return 'recovering'
  if (transport === 'connecting') return 'connecting'
  if (state.job?.status === 'passed') return 'proof ready'
  if (state.job?.status === 'failed') return 'stopped'
  return 'ready'
}

function StageRail({ state }: { state: MigrationState }) {
  return (
    <ol className="stage-rail" aria-label="Migration stages">
      {migrationStages.map((stage, index) => {
        const progress = state.stages[stage]
        return (
          <li key={stage} className={`stage-${progress.status}`} aria-current={progress.status === 'active' ? 'step' : undefined}>
            <span className="stage-index">{String(index + 1).padStart(2, '0')}</span>
            <span><strong>{stage}</strong><small>{progress.status}</small></span>
          </li>
        )
      })}
    </ol>
  )
}

function HypothesisLoom({ state }: { state: MigrationState }) {
  return (
    <section className="loom-panel" aria-labelledby="loom-title">
      <header className="section-heading">
        <div><span>Evidence loom</span><h2 id="loom-title">Rules must survive a counterexample</h2></div>
        <small>{state.hypotheses.length} server-issued hypotheses</small>
      </header>
      {state.hypotheses.length === 0 ? (
        <p className="empty-state">No rule has been inferred. Start a migration to populate this surface from server events.</p>
      ) : (
        <div className="hypothesis-threads">
          {state.hypotheses.map((hypothesis) => (
            <article key={hypothesis.id} className={`hypothesis hypothesis-${hypothesis.status}`}>
              <div className="hypothesis-meta">
                <span>R{hypothesis.revision}</span>
                <span>{Math.round(hypothesis.confidence * 100)}% confidence</span>
                <span>{hypothesis.status}</span>
              </div>
              <p>{hypothesis.statement}</p>
              <footer>
                <code>{hypothesis.evidenceIds.join(' · ') || 'evidence pending'}</code>
                {hypothesis.falsifiedByCounterexampleId && (
                  <small>Falsified by {hypothesis.falsifiedByCounterexampleId}</small>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
      <div className="counterexample-rail" aria-label="Counterexamples">
        {state.counterexamples.map((counterexample) => (
          <article key={counterexample.id}>
            <span>{counterexample.status}</span>
            <h3>{counterexample.title}</h3>
            <p>{counterexample.rationale}</p>
            <dl>
              {Object.entries(counterexample.scenario).map(([key, value]) => (
                <div key={key}><dt>{key}</dt><dd>{formatScenarioValue(value)}</dd></div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </section>
  )
}

function ScenarioMatrix({ state }: { state: MigrationState }) {
  const scenarios = state.proof?.scenarios ?? []
  const containsUnattributedCounterexample = scenarios.some(
    (scenario) => scenario.partition === 'counterexample' && !scenario.provenance,
  )
  return (
    <section className="suite-panel" aria-labelledby="suite-title">
      <header className="section-heading">
        <div><span>Differential suite</span><h2 id="suite-title">Every pass is earned</h2></div>
        <small>{state.proof ? `${state.proof.scenariosPassed}/${state.proof.scenariosTotal} passed` : 'Awaiting proof'}</small>
      </header>
      {scenarios.length ? (
        <>
          <div className="scenario-matrix" role="table" aria-label="Verification scenario matrix">
            <div role="row" className="matrix-head">
              <span role="columnheader">Scenario</span><span role="columnheader">Partition</span>
              <span role="columnheader">Assertions</span><span role="columnheader">Result</span>
            </div>
            {scenarios.map((scenario) => (
              <div role="row" key={scenario.scenarioId}>
                <strong role="cell">{scenario.scenarioId}</strong><span role="cell">{scenarioPartitionLabel(scenario)}</span>
                <span role="cell">{scenario.assertionCount}</span>
                <span role="cell" className={`result-${scenario.status.toLowerCase()}`}>
                  {scenario.status}{scenario.mismatchCount ? ` · ${scenario.mismatchCount} mismatches` : ''}
                </span>
              </div>
            ))}
          </div>
          {containsUnattributedCounterexample && (
            <p className="scenario-provenance-note">
              Counterexample rows are host-executed verification scenarios. Model authorship is claimed only when the server reports it.
            </p>
          )}
        </>
      ) : (
        <p className="empty-state">The suite is empty until the host verifier returns a proof bundle.</p>
      )}
    </section>
  )
}

function ProvenanceValue({ value, fullValue }: { value: string; fullValue?: string }) {
  const unavailable = value === 'Not reported'
  return <dd className={unavailable ? 'not-reported' : undefined} title={fullValue}>{value}</dd>
}

function acceptedCandidate(candidates: MigrationCandidate[]): MigrationCandidate | undefined {
  return [...candidates].reverse().find(({ status }) => status === 'accepted')
}

function ReleaseEvidenceStrip({ release }: { release?: ReleaseIdentity }) {
  const productionCommitUrl = release?.sha
    ? `${repositoryUrl}/commit/${release.sha}`
    : '/api/health'

  return (
    <section className="release-evidence-strip" aria-label="Release evidence">
      <a className="release-evidence-item" href={productionCommitUrl} target="_blank" rel="noreferrer">
        <small>Production</small>
        <strong>{release ? release.sha.slice(0, 7) : 'Checking…'}</strong>
        <span>{release ? `API-attested · ${release.version}` : 'Health manifest pending'}</span>
      </a>
      <a className="release-evidence-item" href={`${repositoryUrl}/commit/${localRunnerCommit}`} target="_blank" rel="noreferrer">
        <small>Pinned runner</small>
        <strong>v0.1.9 · {localRunnerCommitShort}</strong>
        <span>Executable source commit · no binary claim</span>
      </a>
      <a className="release-evidence-item evidence-pass" href={localRunnerEvidenceUrl} target="_blank" rel="noreferrer">
        <small>Real local run</small>
        <strong>PASS · 7/7</strong>
        <span>v0.1.9 · 35/35 assertions · archived</span>
      </a>
      <a className="release-evidence-item" href={liveRunEvidenceUrl} target="_blank" rel="noreferrer">
        <small>Source run</small>
        <strong>4 GPT · 1 Codex</strong>
        <span>Recorded model evidence · archived</span>
      </a>
      <a className="release-evidence-item" href="/api/health" target="_blank" rel="noreferrer">
        <small>Deployment</small>
        <strong>traceforge.axiqo.xyz</strong>
        <span>Live, mutable health manifest</span>
      </a>
    </section>
  )
}

function TrustBoundaryDiagram() {
  return (
    <div className="boundary-diagram">
      <article>
        <span>01 · Public website</span>
        <h3>Guide + proof replay</h3>
        <ul>
          <li>Cannot browse local files</li>
          <li>Cannot read Codex credentials or history</li>
          <li>Cannot start a local run by itself</li>
        </ul>
      </article>
      <article>
        <span>02 · Local Runner</span>
        <h3>127.0.0.1 handoff</h3>
        <ul>
          <li>Runs the fixed demo fixture</li>
          <li>Shows scope before the writing turn</li>
          <li>Keeps diff and proof on this machine</li>
        </ul>
      </article>
      <article>
        <span>03 · Codex</span>
        <h3>Explicit bounded build</h3>
        <ul>
          <li>Authenticates locally</li>
          <li>Writes one allowlisted candidate file</li>
          <li>Cannot commit, push, merge, or deploy</li>
        </ul>
      </article>
    </div>
  )
}

function CurrentActivity({ state, mode, transport }: {
  state: MigrationState
  mode: ExecutionMode
  transport: MigrationTransport
}) {
  const activeStage = migrationStages.find((stage) => state.stages[stage].status === 'active')
    ?? state.job?.currentStage
    ?? migrationStages.find((stage) => state.stages[stage].status === 'pending')
  const latestEvent = state.events[state.events.length - 1]
  const terminal = state.job?.status === 'passed' || state.job?.status === 'failed'

  return (
    <div className="run-focus-grid">
      <article className="current-activity" aria-live="polite">
        <span>Current activity</span>
        <h3>{terminal ? (state.job?.status === 'passed' ? 'Proof bundle issued' : 'Run stopped with evidence') : displayTerminology(latestEvent?.title) ?? `Waiting for ${activeStage}`}</h3>
        <p>{displayTerminology(latestEvent?.detail ?? latestEvent?.payload?.message) ?? modeDisclosure(mode, state)}</p>
        <dl>
          <div><dt>Stage</dt><dd>{activeStage ?? state.job?.status ?? 'queued'}</dd></div>
          <div><dt>Transport</dt><dd>{transportLabel(transport, state)}</dd></div>
          <div><dt>Run</dt><dd><code>{formatShort(state.job?.id, 24)}</code></dd></div>
        </dl>
      </article>
      <aside className="run-constraints" aria-label="Run boundaries">
        <span>Boundaries</span>
        <h3>{mode === 'recorded-replay' ? 'Recorded model work · fresh host proof' : 'Host-only deterministic proof'}</h3>
        <ul>
          <li>No local source upload</li>
          <li>No silent mode substitution</li>
          <li>Host-issued events only</li>
          <li>Missing evidence stays unreported</li>
        </ul>
      </aside>
    </div>
  )
}

function ProofOutcome({ state, mode, onInspect }: {
  state: MigrationState
  mode: ExecutionMode
  onInspect: (event: MigrationEvent) => void
}) {
  const proof = state.proof
  if (!proof) return null
  const proofCandidate = proof.candidate
  const candidateEvent = acceptedCandidate(state.candidates)
  const candidateId = proofCandidate?.implementationId ?? candidateEvent?.id
  const changedFiles = proofCandidate?.changedFiles ?? candidateEvent?.changedFiles ?? []
  const sourceDigest = proofCandidate?.sourceDigest ?? state.artifacts.find(({ kind }) => kind === 'source')?.digest
  const diffDigest = proofCandidate?.diffDigest ?? state.artifacts.find(({ kind }) => kind === 'diff')?.digest
  const proofArtifact = state.artifacts.find(({ kind }) => kind === 'proof')
  const passing = proof.status === 'PASSED' && proof.mismatchCount === 0

  return (
    <section className="proof-outcome" aria-labelledby="proof-outcome-title">
      <header className={`proof-verdict ${passing ? 'is-passing' : 'is-failing'}`}>
        <span>{passing ? 'Integrity checks complete' : 'Evidence preserved · review required'}</span>
        <div>
          <h2 id="proof-outcome-title">{proof.status} · {proof.scenariosPassed}/{proof.scenariosTotal} scenarios</h2>
          <p>{proof.mismatchCount} mismatch{proof.mismatchCount === 1 ? '' : 'es'} · proof {formatDigest(proof.digest)}</p>
        </div>
      </header>

      <div className="proof-result-grid">
        <article>
          <span>01</span><h3>What changed</h3>
          <dl>
            <div><dt>Candidate</dt><dd>{candidateId ?? 'Not reported'}</dd></div>
            <div><dt>Files</dt><dd>{changedFiles.length}</dd></div>
            <div><dt>Revisions</dt><dd>{state.candidates.length}</dd></div>
            <div><dt>Diff</dt><dd title={diffDigest}>{formatDigest(diffDigest)}</dd></div>
          </dl>
        </article>
        <article>
          <span>02</span><h3>What passed</h3>
          <dl>
            <div><dt>Host tests</dt><dd>{proof.hostVerification?.testsPassed === undefined || proof.hostVerification.testsTotal === undefined ? 'Not reported' : `${proof.hostVerification.testsPassed}/${proof.hostVerification.testsTotal}`}</dd></div>
            <div><dt>Scenarios</dt><dd>{proof.scenariosPassed}/{proof.scenariosTotal}</dd></div>
            <div><dt>Assertions</dt><dd>{proof.assertionsPassed}/{proof.assertionsTotal}</dd></div>
            <div><dt>Policy</dt><dd>{proof.mismatchCount === 0 ? 'No mismatch' : `${proof.mismatchCount} mismatches`}</dd></div>
          </dl>
        </article>
        <article>
          <span>03</span><h3>What is proven</h3>
          <dl>
            <div><dt>Source</dt><dd title={sourceDigest}>{formatDigest(sourceDigest)}</dd></div>
            <div><dt>Diff</dt><dd title={diffDigest}>{formatDigest(diffDigest)}</dd></div>
            <div><dt>Proof</dt><dd title={proof.digest}>{formatDigest(proof.digest)}</dd></div>
            <div><dt>Scope</dt><dd>{proof.hostVerification?.scope ?? 'Not reported'}</dd></div>
          </dl>
        </article>
      </div>

      <ul className="verification-checklist" aria-label="Verification results">
        <li className={proof.digest ? 'verified' : ''}>Proof digest reported</li>
        <li className={proof.hostVerification ? 'verified' : ''}>Host verification reported</li>
        <li className={proof.scenariosPassed === proof.scenariosTotal ? 'verified' : ''}>Differential scenarios checked</li>
        <li className={diffDigest ? 'verified' : ''}>Candidate diff bound</li>
      </ul>

      <div className="proof-actions">
        <a className="action-primary" href={proofVerificationUrl} target="_blank" rel="noreferrer">Verify proof</a>
        {proofArtifact && <a className="action-secondary" href={proofArtifact.downloadUrl} download>Download proof bundle</a>}
        <a className="action-secondary" href={liveRunEvidenceUrl} target="_blank" rel="noreferrer">Open source evidence</a>
      </div>

      <div className="proof-detail-stack">
        <details className="proof-detail"><summary><span>Reasoning and counterexamples</span><small>{state.hypotheses.length} hypotheses</small></summary><HypothesisLoom state={state} /></details>
        <details className="proof-detail"><summary><span>Differential scenarios</span><small>{proof.scenariosTotal} scenarios</small></summary><ScenarioMatrix state={state} /></details>
        <details className="proof-detail"><summary><span>Chain of custody</span><small>Server-reported</small></summary><ProvenanceStrip state={state} mode={mode} /></details>
        <details className="proof-detail"><summary><span>Candidate history</span><small>{state.candidates.length} revisions</small></summary><CandidateHistory state={state} /></details>
        <details className="proof-detail"><summary><span>Raw run events</span><small>{state.events.length} events</small></summary><EventConsole events={[...state.events].reverse()} onInspect={onInspect} /></details>
        <details className="proof-detail"><summary><span>Evidence artifacts</span><small>{state.artifacts.length} files</small></summary><ArtifactDock artifacts={state.artifacts} /></details>
      </div>
    </section>
  )
}

export function ProvenanceStrip({ state, mode }: { state: MigrationState; mode: ExecutionMode }) {
  const proof = state.proof
  const invocations = proof?.modelInvocations ?? []
  const verifiedInvocations = invocations.filter(({ status }) => status !== 'failed')
  const invocationThreads = new Set(verifiedInvocations.map(({ threadId }) => threadId).filter(Boolean))
  const totalTokens = verifiedInvocations.length && verifiedInvocations.every(({ usage }) => usage?.totalTokens !== undefined)
    ? verifiedInvocations.reduce((total, { usage }) => total + (usage?.totalTokens ?? 0), 0)
    : undefined
  const candidate = proof?.candidate
  const candidateEvent = acceptedCandidate(state.candidates)
  const codexThreadId = candidate?.codexThreadId ?? candidateEvent?.codexThreadId
  const changedFiles = candidate?.changedFiles ?? candidateEvent?.changedFiles
  const sourceDigest = candidate?.sourceDigest ?? state.artifacts.find(({ kind }) => kind === 'source')?.digest
  const diffDigest = candidate?.diffDigest ?? state.artifacts.find(({ kind }) => kind === 'diff')?.digest
  const noModelCall = mode === 'deterministic-only'
  const turnQualifier = 'verified'
  const tokenQualifier = mode === 'recorded-replay' ? 'recorded' : 'reported'
  const recordedAt = state.job?.replay?.recordedAt
  const sourceRunId = state.job?.replay?.sourceRunId
  const replayRunId = state.job?.executionMode === 'recorded-replay' ? state.job.id : undefined

  return (
    <section className="provenance-strip" aria-labelledby="provenance-title">
      <header className="provenance-heading">
        <span>Chain of custody</span>
        <strong id="provenance-title">Server-reported provenance</strong>
        <small>Missing fields stay marked—not inferred.</small>
      </header>
      <div className="provenance-grid">
        <article className="provenance-node">
          <header><span>AI·01</span><h2>GPT-5.6</h2></header>
          {noModelCall && <p>No model call in this run.</p>}
          <dl>
            <div><dt>Turns</dt><ProvenanceValue value={verifiedInvocations.length ? `${verifiedInvocations.length} ${turnQualifier}` : 'Not reported'} /></div>
            <div><dt>Tokens</dt><ProvenanceValue value={totalTokens === undefined ? 'Not reported' : `${formatCount(totalTokens)} ${tokenQualifier}`} /></div>
            <div><dt>Thread IDs</dt><ProvenanceValue value={invocationThreads.size ? `${invocationThreads.size} reported` : 'Not reported'} /></div>
          </dl>
        </article>
        <article className="provenance-node">
          <header><span>BUILD·02</span><h2>Codex</h2></header>
          {noModelCall && <p>No Codex call in this run.</p>}
          <dl>
            <div><dt>Thread</dt><ProvenanceValue value={formatShort(codexThreadId)} fullValue={codexThreadId} /></div>
            <div><dt>Base</dt><ProvenanceValue value={formatShort(candidate?.baseCommit, 7)} fullValue={candidate?.baseCommit} /></div>
            <div><dt>Change</dt><ProvenanceValue value={changedFiles ? `${changedFiles.length} file${changedFiles.length === 1 ? '' : 's'}` : 'Not reported'} /></div>
          </dl>
        </article>
        <article className="provenance-node">
          <header><span>HOST·03</span><h2>Verifier</h2></header>
          <dl>
            <div><dt>Tests</dt><ProvenanceValue
              value={proof?.hostVerification?.testsPassed === undefined || proof.hostVerification.testsTotal === undefined
                ? 'Not reported'
                : `${proof.hostVerification.testsPassed}/${proof.hostVerification.testsTotal}${proof.hostVerification.testsSkipped ? ` · ${proof.hostVerification.testsSkipped} replay-only` : ''}`}
              fullValue={proof?.hostVerification?.scope === 'candidate-safe'
                ? 'Candidate-safe host tests; replay binding guards run in the full release gate.'
                : undefined}
            /></div>
            <div><dt>Scenarios</dt><ProvenanceValue value={proof ? `${proof.scenariosPassed}/${proof.scenariosTotal}` : 'Not reported'} /></div>
            <div><dt>Assertions</dt><ProvenanceValue value={proof ? `${proof.assertionsPassed}/${proof.assertionsTotal}` : 'Not reported'} /></div>
          </dl>
        </article>
        <article className="provenance-node">
          <header><span>HASH·04</span><h2>Integrity</h2></header>
          <dl>
            <div><dt>Source</dt><ProvenanceValue value={formatDigest(sourceDigest)} fullValue={sourceDigest} /></div>
            <div><dt>Diff</dt><ProvenanceValue value={formatDigest(diffDigest)} fullValue={diffDigest} /></div>
            <div><dt>Proof</dt><ProvenanceValue value={formatDigest(proof?.digest)} fullValue={proof?.digest} /></div>
          </dl>
        </article>
      </div>
      {mode === 'recorded-replay' && (
        <div className="provenance-run-link" aria-label="Recorded source and replay run">
          <span className="recorded-date"><small>Recorded</small><strong>{recordedAt ? formatTime(recordedAt) : 'Not reported'}</strong></span>
          <span className="run-identity"><small>Source run</small><code title={sourceRunId}>{formatShort(sourceRunId, 24)}</code></span>
          <span className="run-arrow" aria-hidden="true">→</span>
          <span className="run-identity"><small>Replay run</small><code title={replayRunId}>{formatShort(replayRunId, 24)}</code></span>
        </div>
      )}
    </section>
  )
}

function CandidateHistory({ state }: { state: MigrationState }) {
  return (
    <section className="candidate-panel" aria-labelledby="candidate-title">
      <header className="section-heading">
        <div><span>Build ledger</span><h2 id="candidate-title">Candidate history</h2></div>
        <small>{state.candidates.length} revisions</small>
      </header>
      {state.candidates.length ? (
        <ol className="candidate-list">
          {state.candidates.map((candidate) => (
            <li key={candidate.id} className={`candidate-${candidate.status}`}>
              <span>R{candidate.revision}</span>
              <div><strong>{candidate.summary || candidate.id}</strong><small>{candidate.changedFiles.join(' · ') || 'change list pending'}</small></div>
              <em>{candidate.status}</em>
            </li>
          ))}
        </ol>
      ) : <p className="empty-state">Codex has not returned a candidate.</p>}
    </section>
  )
}

function EventConsole({ events, onInspect }: { events: MigrationEvent[]; onInspect: (event: MigrationEvent) => void }) {
  return (
    <section className="event-console" aria-labelledby="event-title">
      <header className="section-heading">
        <div><span>Server sequence</span><h2 id="event-title">Run events</h2></div>
        <small>{events.length} received</small>
      </header>
      <ol>
        {events.map((event) => (
          <li key={event.sequence}>
            <button type="button" onClick={() => onInspect(event)}>
              <span>{String(event.sequence).padStart(3, '0')}</span>
              <span><strong>{event.title ?? event.type}</strong><small>{displayTerminology(event.detail ?? event.payload?.message ?? event.actor)}</small></span>
              <em>{event.stage ?? 'system'}</em>
            </button>
          </li>
        ))}
      </ol>
      {events.length === 0 && <p className="empty-state">No server events received.</p>}
    </section>
  )
}

function ArtifactDock({ artifacts }: { artifacts: MigrationArtifact[] }) {
  return (
    <section className="artifact-dock" aria-labelledby="artifact-title">
      <header className="section-heading">
        <div><span>Inspection layer</span><h2 id="artifact-title">Download the evidence</h2></div>
        <small>{artifacts.length} artifacts</small>
      </header>
      <div className="artifact-list">
        {artifacts.map((artifact) => (
          <a key={artifact.id} href={artifact.downloadUrl} download>
            <span>{artifact.kind}</span><strong>{artifact.label}</strong><small>{formatBytes(artifact.sizeBytes)}</small>
          </a>
        ))}
      </div>
      {artifacts.length === 0 && <p className="empty-state">Artifacts appear here only after the server issues them.</p>}
    </section>
  )
}

export default function App() {
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('recorded-replay')
  const [state, setState] = useState<MigrationState>(() => createMigrationState())
  const [transport, setTransport] = useState<MigrationTransport>('closed')
  const [error, setError] = useState<string>()
  const [starting, setStarting] = useState(false)
  const [inspectedEvent, setInspectedEvent] = useState<MigrationEvent>()
  const [localRunnerOpen, setLocalRunnerOpen] = useState(false)
  const [runnerStep, setRunnerStep] = useState<0 | 1 | 2>(0)
  const [boundaryOpen, setBoundaryOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [releaseIdentity, setReleaseIdentity] = useState<ReleaseIdentity>()
  const subscription = useRef<(() => void) | undefined>(undefined)
  const evidenceDialogRef = useRef<HTMLDialogElement>(null)
  const localRunnerDialogRef = useRef<HTMLDialogElement>(null)
  const localRunnerShellRef = useRef<HTMLDivElement>(null)
  const boundaryDialogRef = useRef<HTMLDialogElement>(null)

  const active = state.job?.status === 'queued' || state.job?.status === 'running'
  const selectedMode = state.job?.executionMode ?? executionMode

  const latestEvents = useMemo(() => [...state.events].reverse(), [state.events])

  useEffect(() => () => subscription.current?.(), [])

  useEffect(() => {
    let active = true
    void getRuntimeCapabilities()
      .then((capabilities) => {
        if (active) setReleaseIdentity(capabilities.release)
      })
      .catch(() => {
        if (active) setReleaseIdentity(undefined)
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const dialog = evidenceDialogRef.current
    if (!dialog) return

    if (inspectedEvent) {
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') dialog.showModal()
        else dialog.setAttribute('open', '')
      }
      document.documentElement.classList.add('evidence-modal-open')
    } else {
      if (dialog.open) {
        if (typeof dialog.close === 'function') dialog.close()
        else dialog.removeAttribute('open')
      }
      document.documentElement.classList.remove('evidence-modal-open')
    }

    return () => document.documentElement.classList.remove('evidence-modal-open')
  }, [inspectedEvent])

  useEffect(() => {
    const dialog = localRunnerDialogRef.current
    if (!dialog) return

    if (localRunnerOpen) {
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') dialog.showModal()
        else dialog.setAttribute('open', '')
      }
      document.documentElement.classList.add('runner-modal-open')
    } else {
      if (dialog.open) {
        if (typeof dialog.close === 'function') dialog.close()
        else dialog.removeAttribute('open')
      }
      document.documentElement.classList.remove('runner-modal-open')
    }

    return () => document.documentElement.classList.remove('runner-modal-open')
  }, [localRunnerOpen])

  useEffect(() => {
    const dialog = boundaryDialogRef.current
    if (!dialog) return

    if (boundaryOpen) {
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') dialog.showModal()
        else dialog.setAttribute('open', '')
      }
      document.documentElement.classList.add('boundary-modal-open')
    } else {
      if (dialog.open) {
        if (typeof dialog.close === 'function') dialog.close()
        else dialog.removeAttribute('open')
      }
      document.documentElement.classList.remove('boundary-modal-open')
    }

    return () => document.documentElement.classList.remove('boundary-modal-open')
  }, [boundaryOpen])

  useEffect(() => {
    if (!localRunnerOpen) return
    const headingIds = ['runner-install-title', 'runner-review-title', 'runner-proof-title'] as const
    const animationFrame = window.requestAnimationFrame(() => {
      localRunnerShellRef.current?.scrollTo?.({ top: 0, behavior: 'auto' })
      document.getElementById(headingIds[runnerStep])?.focus()
    })
    return () => window.cancelAnimationFrame(animationFrame)
  }, [localRunnerOpen, runnerStep])

  const openLocalRunner = () => {
    setCopyStatus('idle')
    setRunnerStep(0)
    setLocalRunnerOpen(true)
  }

  const continueWithReplay = () => {
    setExecutionMode('recorded-replay')
    setLocalRunnerOpen(false)
  }

  const copyRunnerCommand = async () => {
    try {
      await copyText(localRunnerCommand)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('failed')
    }
  }

  const refreshOutputs = async (jobId: string) => {
    const [jobResult, artifactResult] = await Promise.allSettled([
      getMigration(jobId),
      getMigrationArtifacts(jobId),
    ])
    if (jobResult.status === 'fulfilled') {
      setState((current) => ({ ...current, job: jobResult.value }))
    }
    if (artifactResult.status === 'fulfilled') {
      setState((current) => {
        const artifacts = [...current.artifacts]
        for (const artifact of artifactResult.value) {
          const index = artifacts.findIndex((entry) => entry.id === artifact.id)
          if (index === -1) artifacts.push(artifact)
          else artifacts[index] = artifact
        }
        return { ...current, artifacts }
      })
    }
    if (jobResult.status === 'fulfilled' && jobResult.value.status === 'passed') {
      try {
        const proof = await getMigrationProof(jobId)
        setState((current) => ({ ...current, proof }))
      } catch (proofError) {
        setError(proofError instanceof Error ? proofError.message : 'The proof bundle could not be read.')
      }
    }
  }

  const begin = async (mode: ExecutionMode = executionMode) => {
    subscription.current?.()
    setStarting(true)
    setError(undefined)
    setInspectedEvent(undefined)
    setExecutionMode(mode)
    try {
      const job = await startMigration(mode)
      setState(createMigrationState(job))
      window.requestAnimationFrame(() => {
        const workspace = document.getElementById('run-workspace')
        if (typeof workspace?.scrollIntoView === 'function') workspace.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
      subscription.current = subscribeToMigration(job.id, {
        onEvent: (event) => {
          setState((current) => reduceMigrationEvent(current, event))
          const terminal = event.type === 'job.completed' || event.type === 'job.failed'
          void refreshOutputs(job.id).finally(() => {
            if (terminal) {
              subscription.current?.()
              subscription.current = undefined
            }
          })
        },
        onTransport: setTransport,
        onError: (streamError) => setError(streamError.message),
      })
    } catch (startError) {
      const detail = startError instanceof ApiError ? startError.message : 'The migration could not be started.'
      setError(mode === 'live-ai'
        ? `${detail} Live AI stopped; no recording or deterministic result was substituted.`
        : detail)
      setTransport('closed')
    } finally {
      setStarting(false)
    }
  }

  return (
    <main className="traceforge-page">
      <header className="site-header">
        <a className="site-wordmark" href="#top" aria-label="TraceForge home">TRACEFORGE <span>/ PROOF RECORDER</span></a>
        <div className="site-tools">
          <button type="button" className="local-boundary-trigger" onClick={() => setBoundaryOpen(true)} aria-haspopup="dialog">Local boundary</button>
          <a className="site-release" href={releaseIdentity ? `${repositoryUrl}/commit/${releaseIdentity.sha}` : '/api/health'} target="_blank" rel="noreferrer">
            {releaseIdentity ? releaseIdentity.sha.slice(0, 7) : 'release…'}
          </a>
        </div>
      </header>

      <section className="landing-hero" id="top">
        <div className="landing-copy">
          <span className="hero-kicker">Local migration proof</span>
          <h1>Prove what changed.<br />Keep Codex local.</h1>
          <p>Rebuild one bounded legacy workflow, preserve the failed attempts, and issue a proof that says exactly what the verifier checked.</p>
          <div className="hero-actions">
            <button className="action-primary" type="button" onClick={openLocalRunner} disabled={active || starting}>Start a local proof run <span aria-hidden="true">↗</span></button>
            <button className="action-link" type="button" onClick={() => void begin('recorded-replay')} disabled={active || starting}>
              {starting ? 'Starting judge replay…' : 'Inspect a completed proof'}
            </button>
          </div>
          <p className="hero-assurance">No local files, Codex credentials, generated source, or session history are sent to this website.</p>
        </div>
        <div className="custody-trace" aria-label="Proof custody path">
          <span className="trace-label">Proof path</span>
          <ol>
            <li><i>01</i><span><strong>Recorded evidence</strong><small>Contract + failed proofs</small></span></li>
            <li><i>02</i><span><strong>Local Codex</strong><small>One explicit bounded build</small></span></li>
            <li><i>03</i><span><strong>Host verifier</strong><small>Hidden differential checks</small></span></li>
            <li><i>04</i><span><strong>Proof bundle</strong><small>Diff + scenarios + digests</small></span></li>
          </ol>
        </div>
      </section>

      <ul className="trust-boundary-strip" aria-label="Trust boundaries">
        <li>Local-only Runner</li>
        <li>Explicit Codex approval</li>
        <li>Recomputable proof digest</li>
      </ul>

      <ReleaseEvidenceStrip release={releaseIdentity} />

      {error && <div className="run-error" role="alert"><strong>Run stopped</strong><span>{error}</span></div>}

      {!state.job ? (
        <section className="judge-mode" aria-labelledby="judge-mode-title">
          <header>
            <span>Judge mode</span>
            <div><h2 id="judge-mode-title">One product. Two honest paths.</h2><p>Use the fixed local demo for a real Codex writing turn, or inspect the recorded run without credentials.</p></div>
          </header>
          <div className="judge-path-grid">
            <article>
              <span>Recommended · real local build</span>
              <h3>Rebuild the fixed demo locally</h3>
              <p>The pinned Runner opens its own <code>127.0.0.1</code> page. Review the one-file scope, then approve this Codex run.</p>
              <button type="button" className="action-secondary" onClick={openLocalRunner}>Open local Runner guide</button>
            </article>
            <article>
              <span>No credentials · public replay</span>
              <h3>Inspect a completed proof</h3>
              <p>Replay the provenance-bound GPT-5.6 and Codex events, execute all disclosed scenarios, and issue a fresh host proof.</p>
              <button type="button" className="action-secondary" onClick={() => void begin('recorded-replay')} disabled={starting}>Start judge replay</button>
            </article>
          </div>
          <details className="advanced-modes">
            <summary>Advanced proof modes</summary>
            <div className="sample-mode-selector" aria-label="Execution mode">
              {publicModeOrder.map((mode) => {
                const copy = modeCopy[mode]
                return (
                  <label key={mode} className={executionMode === mode ? 'is-selected' : ''}>
                    <input type="radio" name="execution-mode" value={mode} checked={executionMode === mode} disabled={starting} onChange={() => setExecutionMode(mode)} />
                    <span><strong>{copy.title}</strong><small>{copy.detail}</small></span>
                  </label>
                )
              })}
            </div>
            <div className="advanced-run-action">
              <button type="button" className="action-secondary" onClick={() => void begin(executionMode)} disabled={starting}>{actionLabel(executionMode, false)}</button>
              <span>{actionHelper(executionMode)}</span>
            </div>
          </details>
        </section>
      ) : (
        <section className="run-workspace" id="run-workspace" aria-labelledby="run-workspace-title">
          <header className="run-header">
            <div><span>Judge walkthrough</span><h2 id="run-workspace-title">{modeCopy[selectedMode].title}</h2><p>{modeDisclosure(selectedMode, state)}</p></div>
            <div className="run-identity"><small>Run</small><code title={state.job.id}>{formatShort(state.job.id, 22)}</code><strong>{state.job.status}</strong></div>
          </header>
          <StageRail state={state} />
          <CurrentActivity state={state} mode={selectedMode} transport={transport} />
          {!state.proof && (
            <details className="raw-run-output">
              <summary><span>View raw server output</span><small>{state.events.length} events</small></summary>
              <EventConsole events={latestEvents} onInspect={setInspectedEvent} />
            </details>
          )}
          <ProofOutcome state={state} mode={selectedMode} onInspect={setInspectedEvent} />
        </section>
      )}

      <section className="boundary-callout" aria-labelledby="boundary-callout-title">
        <div><span>Local boundary</span><h2 id="boundary-callout-title">The public site guides. The local Runner executes.</h2></div>
        <p>TraceForge deliberately has no public-to-local pairing or heartbeat. The pinned command opens a private loopback page where scope, sign-in, approval, execution, and proof remain on your machine.</p>
        <button type="button" onClick={() => setBoundaryOpen(true)}>Inspect the boundary</button>
      </section>

      <footer className="product-footer" role="contentinfo">
        <a href={repositoryUrl} target="_blank" rel="noreferrer">Source</a>
        <a href={liveRunEvidenceUrl} target="_blank" rel="noreferrer">Live evidence</a>
        <a href="/api/health" target="_blank" rel="noreferrer">Health manifest</a>
        <span>{releaseIdentity ? `${releaseLabel(releaseIdentity)} · built ${formatTime(releaseIdentity.builtAt)}` : 'Release identity unavailable'}</span>
      </footer>

      <dialog ref={boundaryDialogRef} className="boundary-dialog" aria-labelledby="boundary-dialog-title" onClose={() => setBoundaryOpen(false)} onCancel={() => setBoundaryOpen(false)}>
        {boundaryOpen && <div className="boundary-dialog-shell"><header><div><span>Trust model</span><h2 id="boundary-dialog-title">Where every capability stops.</h2></div><button type="button" onClick={() => setBoundaryOpen(false)} aria-label="Close local boundary" autoFocus>×</button></header><TrustBoundaryDiagram /></div>}
      </dialog>

      <dialog ref={localRunnerDialogRef} className="run-wizard" aria-labelledby="runner-dialog-title" aria-describedby="runner-dialog-description" onClose={() => setLocalRunnerOpen(false)} onCancel={() => setLocalRunnerOpen(false)}>
        {localRunnerOpen && (
          <div className="run-wizard-shell" ref={localRunnerShellRef}>
            <header className="wizard-header">
              <div><span>TraceForge / Local Runner</span><h2 id="runner-dialog-title">Start a bounded proof run.</h2><p id="runner-dialog-description">Current release: fixed damaged-returns demo. It does not browse or modify your own project.</p></div>
              <button type="button" onClick={() => setLocalRunnerOpen(false)} aria-label="Close Local Runner guide">×</button>
            </header>
            <ol className="wizard-steps" aria-label="Local Runner guide steps">
              {(['Start Runner', 'Review locally', 'Collect proof'] as const).map((label, index) => <li key={label} className={runnerStep === index ? 'is-current' : runnerStep > index ? 'is-complete' : ''}><button type="button" onClick={() => setRunnerStep(index as 0 | 1 | 2)} aria-current={runnerStep === index ? 'step' : undefined}><i>{String(index + 1).padStart(2, '0')}</i><span>{label}</span></button></li>)}
            </ol>

            <div className="wizard-step-panel">
              {runnerStep === 0 && <section className="runner-install" aria-labelledby="runner-install-title">
                <div className="wizard-section-heading"><span>01 · Install</span><div><h3 id="runner-install-title" tabIndex={-1}>Launch the pinned source release</h3><p>macOS / Linux · Git, Node.js 22+, Corepack, Codex CLI 0.144.1</p></div></div>
                <div className="runner-command"><code>{localRunnerCommand}</code><button type="button" onClick={() => void copyRunnerCommand()}>{copyStatus === 'copied' ? 'Copied' : 'Copy command'}</button></div>
                <p className={`runner-copy-status status-${copyStatus}`} aria-live="polite">{copyStatus === 'copied' ? 'Command copied. This public page cannot detect the Runner; continue in the localhost tab it opens.' : copyStatus === 'failed' ? 'Clipboard access is blocked. Select the command and copy it manually.' : `Pinned commit ${localRunnerCommit} · source install · no binary checksum claim`}</p>
                <dl className="runner-release-facts"><div><dt>Tag</dt><dd>{localRunnerTag}</dd></div><div><dt>Commit</dt><dd><code>{localRunnerCommit}</code></dd></div><div><dt>Platform</dt><dd>macOS / Linux</dd></div><div><dt>Artifact</dt><dd>Not published · source install</dd></div></dl>
                <details className="command-disclosure"><summary>What this command does</summary><ol><li>Clones the public source tag into a temporary directory.</li><li>Rejects the checkout unless its Git commit equals <code>{localRunnerCommitShort}</code>.</li><li>Installs the lockfile-pinned dependencies for the current Node architecture.</li><li>Starts a random-port server bound only to <code>127.0.0.1</code>.</li><li>Opens a private localhost page; no Codex writing turn starts yet.</li><li>Stops with <code>Ctrl+C</code>; the temporary run directory can then be removed.</li></ol></details>
                <nav className="runner-resource-links" aria-label="Runner resources"><a href={localRunnerSourceUrl} target="_blank" rel="noreferrer">Inspect commit</a><a href={localRunnerTagUrl} target="_blank" rel="noreferrer">Browse tag</a><a href={localRunnerEvidenceUrl} target="_blank" rel="noreferrer">Real run evidence</a><a href={repositoryUrl} target="_blank" rel="noreferrer">Repository</a></nav>
              </section>}

              {runnerStep === 1 && <section className="runner-review" aria-labelledby="runner-review-title">
                <div className="wizard-section-heading"><span>02 · Local review</span><div><h3 id="runner-review-title" tabIndex={-1}>Approve one fixed Codex build on localhost</h3><p>The public site intentionally cannot see whether the Runner is open.</p></div></div>
                <div className="local-handoff-note"><span>Public status</span><strong>Handoff to localhost</strong><p>No pairing, heartbeat, file browser, or approval state crosses this boundary.</p></div>
                <div className="scope-preview">
                  <article><span>Fixed demo</span><h4>Damaged returns v1</h4><p>Recorded contract, failed proofs, disclosed scenarios, incomplete candidate.</p></article>
                  <article><span>Write scope</span><h4>One candidate file</h4><p>Temporary writer workspace · no arbitrary project selection.</p></article>
                  <article><span>Hidden</span><h4>Verifier + post-turn input</h4><p>Legacy source, tests, and verification input are withheld from Codex.</p></article>
                  <article><span>Disabled</span><h4>Git publication + agent command network</h4><p>The Codex service connection remains required; commit, push, merge, and deploy stay blocked.</p></article>
                </div>
                <p className="approval-note"><strong>Approval is explicit.</strong> The localhost button starts this one writing turn only after preflight and local sign-in. This release does not claim a cryptographically signed approval manifest.</p>
              </section>}

              {runnerStep === 2 && <section className="runner-proof-preview" aria-labelledby="runner-proof-title">
                <div className="wizard-section-heading"><span>03 · Proof</span><div><h3 id="runner-proof-title" tabIndex={-1}>Follow the local run to a recomputable result</h3><p>The localhost page streams real session state; the public site receives nothing.</p></div></div>
                <ol className="local-run-stages"><li>Preflight</li><li>Sign in</li><li>Review scope</li><li>Codex build</li><li>Host verify</li><li>Proof</li></ol>
                <div className="proof-preview-grid"><article><span>What changed</span><strong>One changed file + diff digest</strong></article><article><span>What passed</span><strong>15 tests + 7 scenarios + 35 assertions</strong></article><article><span>What is bound</span><strong>Runner commit + input + candidate + output digests</strong></article></div>
                <p className="approval-note">A fresh local bundle includes PASS/FAIL, mismatch counts, SHA-256 digests, diff, command-output digests, and a verification nonce. It does not claim a Runner signature or trusted timestamp.</p>
                <a className="runner-evidence-link" href={localRunnerEvidenceUrl} target="_blank" rel="noreferrer">Inspect the archived v0.1.9 run <span aria-hidden="true">↗</span></a>
              </section>}
            </div>

            <footer className="wizard-actions">
              {runnerStep > 0 && <button type="button" className="action-link" onClick={() => setRunnerStep((runnerStep - 1) as 0 | 1)}>Back</button>}
              {runnerStep < 2 && <button type="button" className="action-secondary" onClick={() => setRunnerStep((runnerStep + 1) as 1 | 2)}>Next: {runnerStep === 0 ? 'review local scope' : 'see proof output'}</button>}
              <button type="button" className="action-link" onClick={() => { continueWithReplay(); void begin('recorded-replay') }}>Inspect completed proof instead</button>
            </footer>
          </div>
        )}
      </dialog>

      <dialog
        ref={evidenceDialogRef}
        className="evidence-dialog"
        aria-labelledby="evidence-dialog-title"
        aria-describedby="evidence-dialog-description"
        onClose={() => setInspectedEvent(undefined)}
        onCancel={() => setInspectedEvent(undefined)}
      >
        {inspectedEvent && (
          <div className="evidence-dialog-shell">
            <header><span>Evidence event {inspectedEvent.sequence}</span><button type="button" onClick={() => setInspectedEvent(undefined)} aria-label="Close evidence drawer">×</button></header>
            <div className="evidence-dialog-content">
              <h2 id="evidence-dialog-title">{inspectedEvent.title ?? inspectedEvent.type}</h2>
              <p id="evidence-dialog-description">{displayTerminology(inspectedEvent.detail ?? inspectedEvent.payload?.message)}</p>
              <dl>
                <div><dt>Stage</dt><dd>{inspectedEvent.stage ?? 'system'}</dd></div>
                <div><dt>Actor</dt><dd>{inspectedEvent.actor ?? 'server'}</dd></div>
                <div><dt>Occurred</dt><dd>{formatTime(inspectedEvent.occurredAt)}</dd></div>
                <div><dt>Digest</dt><dd><code>{inspectedEvent.digest ?? 'not provided'}</code></dd></div>
              </dl>
              <details className="evidence-raw">
                <summary><span>Raw event JSON</span><small>Digest-bound payload · JSON</small></summary>
                <pre>{JSON.stringify(inspectedEvent, null, 2)}</pre>
              </details>
            </div>
          </div>
        )}
      </dialog>
    </main>
  )
}
