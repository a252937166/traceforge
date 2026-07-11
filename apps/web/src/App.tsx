import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError,
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
const liveRunEvidenceUrl = 'https://github.com/a252937166/traceforge/tree/main/docs/evidence/live-champion-run'
const localRunnerRepository = 'a252937166/traceforge'
const localRunnerTag = 'local-runner-v0.1.3'
const localRunnerSourceUrl = `https://github.com/${localRunnerRepository}/tree/${localRunnerTag}`

const localRunnerCommand = `RUN_DIR="$(mktemp -d)" && git clone --filter=blob:none --branch ${localRunnerTag} https://github.com/${localRunnerRepository}.git "$RUN_DIR/traceforge" && cd "$RUN_DIR/traceforge" && NODE_ARCH="$(node -p 'process.arch')" && npm_config_arch="$NODE_ARCH" corepack pnpm install --frozen-lockfile && npm_config_arch="$NODE_ARCH" corepack pnpm local:run`

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
      ? `The authenticated model work was recorded ${formatTime(state.job.replay.recordedAt)}. This replay streams those provenance-bound events, then the host executes all six scenarios and issues a fresh proof. No model call is made during replay.`
      : 'Run the complete migration now. GPT-5.6 and Codex events replay with their original provenance; the host then executes all six scenarios and issues a fresh proof. No model call is claimed during replay.'
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
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const subscription = useRef<(() => void) | undefined>(undefined)
  const evidenceDialogRef = useRef<HTMLDialogElement>(null)
  const localRunnerDialogRef = useRef<HTMLDialogElement>(null)

  const active = state.job?.status === 'queued' || state.job?.status === 'running'
  const selectedMode = state.job?.executionMode ?? executionMode
  const proofHeadline = state.proof
    ? `${state.proof.status} · ${state.proof.scenariosPassed}/${state.proof.scenariosTotal} scenarios`
    : 'No proof issued'

  const latestEvents = useMemo(() => [...state.events].reverse(), [state.events])

  useEffect(() => () => subscription.current?.(), [])

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

  const openLocalRunner = () => {
    setCopyStatus('idle')
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

  const begin = async () => {
    subscription.current?.()
    setStarting(true)
    setError(undefined)
    setInspectedEvent(undefined)
    try {
      const job = await startMigration(executionMode)
      setState(createMigrationState(job))
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
      setError(executionMode === 'live-ai'
        ? `${detail} Live AI stopped; no recording or deterministic result was substituted.`
        : detail)
      setTransport('closed')
    } finally {
      setStarting(false)
    }
  }

  return (
    <main className="migration-workbench">
      <header className="hero">
        <nav aria-label="TraceForge identity">
          <a className="wordmark" href="#top" aria-label="TraceForge home">TRACEFORGE <span>/ MIGRATION LOOM</span></a>
          <span className={`transport transport-${transport}`}>{transportLabel(transport, state)}</span>
        </nav>
        <div className="hero-copy" id="top">
          <span className="eyebrow">Behavior → contract → software → proof</span>
          <h1>Modernize undocumented workflows without guessing.</h1>
          <p>GPT-5.6 proposes and challenges rules from evidence. Codex rebuilds the bounded workflow. An independent host verifier proves what matches—and exposes what does not.</p>
        </div>
        <div className="mode-selector" aria-label="Execution mode">
          {publicModeOrder.map((mode) => {
            const copy = modeCopy[mode]
            return (
              <label
                key={mode}
                className={executionMode === mode ? 'is-selected' : ''}
              >
                <input
                  type="radio"
                  name="execution-mode"
                  value={mode}
                  checked={executionMode === mode}
                  disabled={active || starting}
                  onChange={() => setExecutionMode(mode)}
                />
                <span>
                  <strong>{copy.title}</strong>
                  <small>{copy.label}</small>
                </span>
              </label>
            )
          })}
          <button
            className="local-runner-entry"
            type="button"
            onClick={openLocalRunner}
            disabled={active || starting}
            aria-haspopup="dialog"
          >
            <span className="local-runner-sigil" aria-hidden="true">↗</span>
            <span>
              <strong>Build live with my Codex</strong>
              <small>Recorded GPT-5.6 · local Codex · fresh local proof</small>
            </span>
            <em>local</em>
          </button>
        </div>
        <div className="run-controls">
          <button className="primary-action" type="button" onClick={begin} disabled={active || starting}>
            {starting
              ? 'Starting…'
              : active
                ? 'Migration running'
                : actionLabel(executionMode, state.job?.executionMode === executionMode)}
          </button>
          <span>{state.job ? `Job ${state.job.id} · ${state.job.status}` : actionHelper(executionMode)}</span>
        </div>
        <div className={`mode-disclosure mode-${executionMode}`}>
          <strong>{modeCopy[executionMode].label}</strong>
          <div className="mode-disclosure-body">
            <p>{modeDisclosure(executionMode, state)}</p>
            {executionMode === 'recorded-replay' && (
              <a href={liveRunEvidenceUrl} target="_blank" rel="noreferrer">Inspect the authenticated live-run evidence ↗</a>
            )}
          </div>
        </div>
        {error && <div className="error-banner" role="alert"><strong>Run stopped</strong><span>{error}</span></div>}
      </header>

      <StageRail state={state} />

      <section className="proof-summary" aria-label="Current verification summary">
        <span><small>Mode</small><strong>{modeCopy[selectedMode].title}</strong></span>
        <span><small>Model</small><strong>{state.job?.modelId ?? (selectedMode === 'deterministic-only' ? 'No model' : 'Pending')}</strong></span>
        <span><small>Proof</small><strong>{proofHeadline}</strong></span>
        <span><small>Mismatches</small><strong>{state.proof?.mismatchCount ?? '—'}</strong></span>
      </section>

      <ProvenanceStrip state={state} mode={selectedMode} />

      <div className="workbench-grid">
        <div className="workbench-primary">
          <HypothesisLoom state={state} />
          <ScenarioMatrix state={state} />
          <CandidateHistory state={state} />
        </div>
        <div className="workbench-secondary">
          <EventConsole events={latestEvents} onInspect={setInspectedEvent} />
          <ArtifactDock artifacts={state.artifacts} />
        </div>
      </div>

      <dialog
        ref={localRunnerDialogRef}
        className="runner-dialog"
        aria-labelledby="runner-dialog-title"
        aria-describedby="runner-dialog-description"
        onClose={() => setLocalRunnerOpen(false)}
        onCancel={() => setLocalRunnerOpen(false)}
      >
        {localRunnerOpen && (
          <div className="runner-dialog-shell">
            <header>
              <span>TraceForge / Local Runner</span>
              <button type="button" onClick={() => setLocalRunnerOpen(false)} aria-label="Close Local Runner launcher">×</button>
            </header>
            <div className="runner-dialog-content">
              <div className="runner-intro">
                <span>Optional local build</span>
                <h2 id="runner-dialog-title">Build live with your local Codex.</h2>
                <p id="runner-dialog-description">
                  The public page cannot start or inspect a local process. Run one pinned command to open a localhost confirmation page, then approve the bounded build on your machine.
                </p>
              </div>

              <ol className="runner-provenance" aria-label="Local run provenance">
                <li><small>Source</small><strong>Recorded GPT-5.6 evidence</strong><span>Digest-verified contract + failed proofs</span></li>
                <li><small>Builder</small><strong>Local Codex · live</strong><span>Runner-owned Codex sign-in</span></li>
                <li><small>Verifier</small><strong>Local host · live</strong><span>Fresh post-turn input</span></li>
                <li><small>Output</small><strong>Fresh local proof</strong><span>Diff + scenarios + digests</span></li>
              </ol>

              <section className="runner-launch" aria-labelledby="runner-launch-title">
                <div className="runner-launch-heading">
                  <div><span>First run</span><h3 id="runner-launch-title">Launch the pinned open-source runner</h3></div>
                  <a href={localRunnerSourceUrl} target="_blank" rel="noreferrer">Inspect {localRunnerTag} ↗</a>
                </div>
                <div className="runner-platform-tabs" aria-label="Verified Local Runner platform">
                  <strong>Verified on macOS / Linux</strong>
                  <span>Windows is not supported by this release.</span>
                </div>
                <div className="runner-command">
                  <code>{localRunnerCommand}</code>
                  <button type="button" onClick={() => void copyRunnerCommand()}>
                    {copyStatus === 'copied' ? 'Copied' : 'Copy command'}
                  </button>
                </div>
                <p className="runner-prerequisites">
                  Requires Git, Node.js 22+, Corepack, Codex CLI 0.144.1, and access to gpt-5.6-sol.
                </p>
                <p className={`runner-copy-status status-${copyStatus}`} aria-live="polite">
                  {copyStatus === 'copied'
                    ? 'Command copied. Run it in a terminal; the runner opens its localhost confirmation page.'
                    : copyStatus === 'failed'
                      ? 'Clipboard access is blocked. Select the command above and copy it manually.'
                      : 'Pinned source · fixed demo fixture · no unversioned latest install'}
                </p>
              </section>

              <section className="runner-boundaries" aria-labelledby="runner-boundaries-title">
                <div className="runner-boundaries-heading">
                  <span>Before the Codex writing turn</span>
                  <h3 id="runner-boundaries-title">The local confirmation page shows the complete scope.</h3>
                </div>
                <dl>
                  <div><dt>Codex can read</dt><dd>One contract, three failed proofs, disclosed scenarios, and one incomplete candidate.</dd></div>
                  <div><dt>Codex can write</dt><dd>One candidate file in a temporary writer workspace.</dd></div>
                  <div><dt>Kept hidden</dt><dd>Legacy source, verifier, tests, and the post-turn verification input.</dd></div>
                  <div><dt>Disabled</dt><dd>Agent command network, commit, push, merge, and deploy. The Codex service connection remains required.</dd></div>
                </dl>
                <p><strong>Launch preflight is explicit.</strong> The terminal command clones and installs the pinned release, prepares the fixture and private configuration, starts the loopback server, and checks Codex access. No Codex writing turn or verifier command runs before <em>Start local build</em>.</p>
                <p><strong>Authentication stays local.</strong> Codex handles sign-in on this machine. This public page cannot read tokens, local files, Codex history, generated source, or proof contents.</p>
              </section>

              <div className="runner-actions">
                <button type="button" className="primary-action" onClick={() => void copyRunnerCommand()}>Copy launch command</button>
                <button type="button" className="secondary-action" onClick={continueWithReplay}>Continue with verified replay</button>
              </div>
            </div>
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
                <summary><span>Raw event JSON</span><small>Signed payload · JSON</small></summary>
                <pre>{JSON.stringify(inspectedEvent, null, 2)}</pre>
              </details>
            </div>
          </div>
        )}
      </dialog>
    </main>
  )
}
