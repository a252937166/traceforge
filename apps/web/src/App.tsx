import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  getMigration,
  getMigrationArtifacts,
  getMigrationProof,
  getRuntimeCapabilities,
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
  type RuntimeCapabilities,
} from './migration-types'

const modeCopy: Record<ExecutionMode, { title: string; label: string; detail: string }> = {
  'live-ai': {
    title: 'Live AI',
    label: 'GPT-5.6 + Codex · live',
    detail: 'Calls the configured models now. If either model is unavailable, the run stops and reports the failure.',
  },
  'recorded-replay': {
    title: 'Recorded replay',
    label: 'Verified recording · not live',
    detail: 'Replays a previously captured model run with its original timestamp and provenance.',
  },
  'deterministic-only': {
    title: 'Deterministic proof',
    label: 'Host verifier · no model',
    detail: 'Runs the deterministic workflow and proof path only. No GPT or Codex execution is claimed.',
  },
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
      ? `${state.job.replay.disclosure} Recorded ${formatTime(state.job.replay.recordedAt)}.`
      : 'This mode is not live. Recording time and source provenance must arrive from the server before results are shown.'
  }
  return modeCopy[mode].detail
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
  const [runtimeCapabilities, setRuntimeCapabilities] = useState<RuntimeCapabilities>()
  const subscription = useRef<(() => void) | undefined>(undefined)

  const active = state.job?.status === 'queued' || state.job?.status === 'running'
  const selectedMode = state.job?.executionMode ?? executionMode
  const proofHeadline = state.proof
    ? `${state.proof.status} · ${state.proof.scenariosPassed}/${state.proof.scenariosTotal} scenarios`
    : 'No proof issued'

  const latestEvents = useMemo(() => [...state.events].reverse(), [state.events])

  useEffect(() => () => subscription.current?.(), [])

  useEffect(() => {
    let current = true
    void getRuntimeCapabilities()
      .then((capabilities) => {
        if (current) setRuntimeCapabilities(capabilities)
      })
      .catch(() => {
        if (current) {
          setRuntimeCapabilities({
            liveAiAvailable: false,
            gpt56Configured: false,
            codexConfigured: false,
            boundary: 'Runtime health could not be verified, so Live AI remains unavailable.',
          })
        }
      })
    return () => { current = false }
  }, [])

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
          <span className={`transport transport-${transport}`}>{transport}</span>
        </nav>
        <div className="hero-copy" id="top">
          <span className="eyebrow">Behavior → contract → software → proof</span>
          <h1>Modernize undocumented workflows without guessing.</h1>
          <p>GPT-5.6 reconstructs hidden rules from evidence. Codex rebuilds the application. An independent host verifier proves what matches—and exposes what does not.</p>
        </div>
        <div className="mode-selector" aria-label="Execution mode">
          {Object.entries(modeCopy).map(([mode, copy]) => (
            <label
              key={mode}
              className={[
                executionMode === mode ? 'is-selected' : '',
                mode === 'live-ai' && runtimeCapabilities?.liveAiAvailable === false ? 'is-unavailable' : '',
              ].filter(Boolean).join(' ')}
              title={mode === 'live-ai' && runtimeCapabilities?.liveAiAvailable === false
                ? runtimeCapabilities.boundary
                : undefined}
            >
              <input
                type="radio"
                name="execution-mode"
                value={mode}
                checked={executionMode === mode}
                disabled={active || starting || (mode === 'live-ai' && runtimeCapabilities?.liveAiAvailable === false)}
                onChange={() => setExecutionMode(mode as ExecutionMode)}
              />
              <span>
                <strong>{copy.title}</strong>
                <small>{mode === 'live-ai' && runtimeCapabilities?.liveAiAvailable === false
                  ? 'Unavailable on this deployment'
                  : mode === 'live-ai' && runtimeCapabilities === undefined
                    ? 'Checking runtime availability…'
                    : copy.label}</small>
              </span>
            </label>
          ))}
        </div>
        <div className={`mode-disclosure mode-${selectedMode}`}>
          <strong>{modeCopy[selectedMode].label}</strong>
          <p>{modeDisclosure(selectedMode, state)}</p>
        </div>
        <div className="run-controls">
          <button className="primary-action" type="button" onClick={begin} disabled={active || starting}>
            {starting ? 'Starting…' : active ? 'Migration running' : state.job ? 'Start a new migration' : 'Start migration'}
          </button>
          <span>{state.job ? `Job ${state.job.id} · ${state.job.status}` : 'No result is preloaded.'}</span>
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

      <dialog className="evidence-dialog" open={Boolean(inspectedEvent)} onClose={() => setInspectedEvent(undefined)}>
        {inspectedEvent && (
          <div>
            <header><span>Evidence event {inspectedEvent.sequence}</span><button type="button" onClick={() => setInspectedEvent(undefined)} aria-label="Close evidence drawer">×</button></header>
            <h2>{inspectedEvent.title ?? inspectedEvent.type}</h2>
            <p>{displayTerminology(inspectedEvent.detail ?? inspectedEvent.payload?.message)}</p>
            <dl>
              <div><dt>Stage</dt><dd>{inspectedEvent.stage ?? 'system'}</dd></div>
              <div><dt>Actor</dt><dd>{inspectedEvent.actor ?? 'server'}</dd></div>
              <div><dt>Occurred</dt><dd>{formatTime(inspectedEvent.occurredAt)}</dd></div>
              <div><dt>Digest</dt><dd><code>{inspectedEvent.digest ?? 'not provided'}</code></dd></div>
            </dl>
            <pre>{JSON.stringify(inspectedEvent, null, 2)}</pre>
          </div>
        )}
      </dialog>
    </main>
  )
}
