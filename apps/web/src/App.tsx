import { useState, type CSSProperties, type ReactNode } from 'react'
import {
  phasePosition,
  phases,
  requestCodexRepair,
  requestProofRun,
  sampleRun,
  type DataSource,
  type ProofRun,
  type RunPhase,
} from './demo'

const workflow = [
  { id: '01', label: 'Open damaged return', evidence: 'EV-001' },
  { id: '02', label: 'Choose refund', evidence: 'EV-004' },
  { id: '03', label: 'Commit inventory state', evidence: 'EV-009' },
  { id: '04', label: 'Close return case', evidence: 'EV-011' },
]

function getStatusCopy(run: ProofRun): Record<RunPhase, { kicker: string; title: string; detail: string }> {
  const codexPending = run.patchId === 'CODEX-PENDING'
  const referencePending = run.patchId === 'REF-PENDING'
  const candidateActor = run.codexExecuted
    ? 'Codex produced'
    : run.source === 'live'
      ? 'Reference implementation loaded'
      : 'Seeded fixture loaded'
  return {
    ready: {
      kicker: 'Recorder armed',
      title: 'Ready to prove this workflow',
      detail: 'The captured trace is loaded. Start a differential replay when ready.',
    },
    capturing: {
      kicker: 'Pass 01 · Baseline',
      title: 'Replaying the original behavior',
      detail: 'Sealing UI, API, and entity-state evidence before comparison.',
    },
    difference: {
      kicker: 'Pass 02 · Divergence',
      title: 'Difference D-01 isolated',
      detail: 'The candidate restored a damaged unit to sellable inventory.',
    },
    repairing: {
      kicker: 'Pass 03 · Repair',
      title: codexPending
        ? 'Codex repair running in an isolated worktree'
        : referencePending
          ? 'Codex unavailable — loading the reference patch'
          : `${candidateActor} candidate ${run.patchId}`,
      detail: codexPending
        ? 'Only the generated repair file is writable; a fresh independent verification is required.'
        : referencePending
          ? 'The fallback is explicitly labelled and is not represented as model-generated.'
          : run.codexExecuted
            ? 'One state transition changed by Codex. The verifier remains independent.'
            : 'A deterministic reference patch is applied. No model execution is claimed.',
    },
    verifying: {
      kicker: 'Pass 04 · Recheck',
      title: `Replaying ${run.stats.scenariosTotal} covered scenarios`,
      detail: 'Deterministic state assertions run before the semantic UI check.',
    },
    proven: {
      kicker: 'Pass 04 · Sealed',
      title: 'Proof sealed',
      detail: `${run.codexExecuted ? 'Codex-generated' : 'Reference'} candidate conforms in ${run.stats.scenariosPassed} of ${run.stats.scenariosTotal} covered scenarios.`,
    },
    unresolved: {
      kicker: 'Pass 04 · Not sealed',
      title: run.source === 'sample'
        ? 'Sample replay complete — start live runner to seal proof'
        : run.fallbackReason
          ? run.codexExecuted
            ? 'Codex candidate did not pass verification'
            : 'Repair could not complete'
        : 'Verification remains unresolved',
      detail: run.source === 'sample'
        ? 'Fixture evidence demonstrates the interface only; it cannot produce a live proof.'
        : run.fallbackReason
          ? run.fallbackReason
        : run.candidateVersion === 'buggy'
          ? 'The deliberate mutation was not detected, so no repair was promoted.'
          : `${run.stats.differences} differences remain after the reference patch.`,
    },
  }
}

function shortThread(threadId: string): string {
  return threadId.replace(/^thread[_-]?/i, '').slice(0, 10)
}

function patchPreview(run: ProofRun): { removed: string; added: string } {
  if (!run.codexDiff) {
    return {
      removed: 'bucket: "sellable"',
      added: 'bucket: "quarantine"',
    }
  }
  const lines = run.codexDiff.split('\n')
  const removed = lines.find((line) => line.startsWith('-') && !line.startsWith('---'))
  const added = lines.find((line) => line.startsWith('+') && !line.startsWith('+++'))
  return {
    removed: removed?.slice(1).trim() || 'mutated disposition',
    added: added?.slice(1).trim() || 'generated disposition repair',
  }
}

function workflowEvidenceId(run: ProofRun, index: number, fallback: string): string {
  const patterns = [
    /input captured|return opened/i,
    /decision recorded|refund selected|rule-standard-refund/i,
    /inventory snapshot after|inventory mutation/i,
    /committed and read back|case closed|database roundtrip/i,
  ]
  const pattern = patterns[index]
  const evidence = pattern
    ? run.evidence.find((item) => pattern.test(`${item.label} ${item.detail}`))
    : undefined
  return evidence?.id ?? run.evidence[index]?.id ?? fallback
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      {children}
    </svg>
  )
}

function RunIcon() {
  return (
    <Icon>
      <path d="M8 5.5 17 12l-9 6.5v-13Z" fill="currentColor" />
    </Icon>
  )
}

function CheckIcon() {
  return (
    <Icon>
      <path d="m5 12.5 4.1 4L19 7" fill="none" stroke="currentColor" strokeWidth="2" />
    </Icon>
  )
}

function SourceBadge({ source, reason }: { source: DataSource; reason?: string }) {
  const copy = {
    preview: ['Demo fixture', 'Run not started'],
    live: ['Live runner', '/api/demo/run'],
    sample: ['Sample data', 'API fallback'],
  }[source]

  return (
    <div className={`source-badge source-${source}`} title={reason}>
      <span className="source-light" />
      <span>
        <strong>{copy[0]}</strong>
        <small>{copy[1]}</small>
      </span>
    </div>
  )
}

function StepStatus({ phase, index }: { phase: RunPhase; index: number }) {
  const current = phasePosition(phase)
  const threshold = Math.min(index + 1, 4)
  const complete = phase === 'proven' || (phase !== 'unresolved' && current > threshold)
  const active = current === threshold || (index === 3 && (phase === 'verifying' || phase === 'unresolved'))

  return (
    <span className={`step-node ${complete ? 'is-complete' : ''} ${active ? 'is-active' : ''}`}>
      {complete ? '✓' : String(index + 1).padStart(2, '0')}
    </span>
  )
}

function WorkflowPanel({ run, phase }: { run: ProofRun; phase: RunPhase }) {
  return (
    <aside className="side-panel workflow-panel" aria-label="Captured workflow and behavior rules">
      <div className="panel-heading">
        <span>01 / Captured workflow</span>
        <span className="mono">04 steps</span>
      </div>

      <ol className="trace-list">
        {workflow.map((step, index) => (
          <li key={step.id}>
            <StepStatus phase={phase} index={index} />
            <span className="trace-copy">
              <strong>{step.label}</strong>
              <small>{workflowEvidenceId(run, index, step.evidence)}</small>
            </span>
          </li>
        ))}
      </ol>

      <div className="subheading">
        <span>Behavior contract</span>
        <span className="rule-count">{run.rules.length} rules</span>
      </div>

      <div className="rule-list">
        {run.rules.slice(0, 4).map((rule, index) => {
          const isCausalRule = index === run.rules.length - 1
          const isFlagged = isCausalRule && phase === 'difference'
          return (
            <article className={`rule ${isFlagged ? 'is-flagged' : ''}`} key={rule.id}>
              <div className="rule-meta">
                <span className="mono">{rule.id}</span>
                <span>{Math.round(rule.confidence * 100)}% confidence</span>
              </div>
              <p>{rule.statement}</p>
              <small>{rule.evidenceIds.join(' + ') || 'Evidence pending'}</small>
            </article>
          )
        })}
      </div>
    </aside>
  )
}

function LegacyWindow({ phase }: { phase: RunPhase }) {
  const active = phase !== 'ready'
  return (
    <article className="app-window legacy-window" aria-label="Original application playback">
      <div className="window-bar">
        <span className="window-index">A</span>
        <span>ORIGINAL · WAREHOUSE CONSOLE 6.4</span>
        <span className="window-state">{active ? 'PLAYING TRACE' : 'STANDBY'}</span>
      </div>
      <div className="legacy-app">
        <div className="legacy-nav">RETURNS / DAMAGE REVIEW</div>
        <div className="legacy-row legacy-head">
          <span>CASE</span><span>CUSTOMER</span><span>VALUE</span>
        </div>
        <div className="legacy-row selected">
          <span>RET-1001</span><span>STANDARD</span><span>$45.00</span>
        </div>
        <div className="legacy-form">
          <label>
            RESOLUTION
            <span className="fake-select">REFUND ▾</span>
          </label>
          <label>
            CONDITION
            <span className="fake-select">DAMAGED ▾</span>
          </label>
        </div>
        <div className="inventory-readout">
          <span>SELLABLE <strong>10 → 10</strong></span>
          <span>QUARANTINE <strong>0 → 1</strong></span>
        </div>
        <button className="legacy-action" tabIndex={-1}>PROCESS REFUND [F8]</button>
      </div>
    </article>
  )
}

function CandidateWindow({ phase, run }: { phase: RunPhase; run: ProofRun }) {
  const hasDifference =
    ['difference', 'repairing'].includes(phase) || (phase === 'unresolved' && run.stats.differences > 0)
  const isVerifying = phase === 'verifying'
  const isProven = phase === 'proven'

  return (
    <article className="app-window candidate-window" aria-label="Replacement application playback">
      <div className="window-bar">
        <span className="window-index">B</span>
        <span>REPLACEMENT · TRACEFORGE BUILD {run.patchId}</span>
        <span className="window-state">
          {hasDifference ? 'DIFF FOUND' : isProven ? 'CONFORMANT' : phase === 'unresolved' ? 'NOT SEALED' : isVerifying ? 'REPLAYING' : 'STANDBY'}
        </span>
      </div>
      <div className="candidate-app">
        <div className="candidate-title">
          <span>Damaged return</span>
          <span className="case-pill">RET-1001</span>
        </div>
        <div className="customer-strip">
          <span className="avatar">ST</span>
          <span><strong>Standard customer</strong><small>SKU-RED-01 · $45.00 return</small></span>
        </div>
        <div className="resolution-row">
          <span>Resolution</span><strong>Refund to original payment</strong>
        </div>
        <div className={`state-change ${hasDifference ? 'has-difference' : ''} ${isProven ? 'is-proven' : ''}`}>
          <span className="state-label">Inventory after refund</span>
          <span>Sellable <strong>{hasDifference ? '10 → 11' : '10 → 10'}</strong></span>
          <span>Quarantine <strong>{hasDifference ? '0 → 0' : '0 → 1'}</strong></span>
          {hasDifference && <em>Unexpected side effect</em>}
          {isProven && <em>Matches captured state</em>}
        </div>
        <button className="candidate-action" tabIndex={-1}>Complete refund</button>
      </div>
    </article>
  )
}

function SyncTrack({ phase }: { phase: RunPhase }) {
  const position = phase === 'proven' || phase === 'unresolved'
    ? 100
    : (phasePosition(phase) / (phases.length - 2)) * 100
  const style = { '--progress': `${position}%` } as CSSProperties
  return (
    <div className="sync-track" style={style} aria-label={`Replay progress: ${Math.round(position)} percent`}>
      <div className="track-line" />
      <div className="playhead">
        <span>SYNC</span>
      </div>
      {['00:00', '00:08', '00:14', '00:22'].map((time) => (
        <span className="timecode" key={time}>{time}</span>
      ))}
    </div>
  )
}

function DifferenceTray({ phase, run }: { phase: RunPhase; run: ProofRun }) {
  const copy = getStatusCopy(run)[phase]
  const showPatch =
    ['repairing', 'verifying', 'proven'].includes(phase) ||
    (phase === 'unresolved' &&
      (run.candidateVersion === 'fixed' || run.codexExecuted || Boolean(run.codexThreadId)))
  const preview = patchPreview(run)
  const patchOrigin = run.patchId === 'CODEX-PENDING'
    ? 'CODEX RUNNING'
    : phase === 'unresolved' && (run.candidateVersion === 'generated' || Boolean(run.codexThreadId))
      ? 'CODEX FAILED'
    : run.codexExecuted
      ? 'CODEX EXECUTED'
      : run.source === 'live'
        ? 'REFERENCE PATCH'
        : 'FIXTURE PATCH'
  const patchFile = run.codexChangedFiles?.[0] ??
    (run.candidateVersion === 'fixed' ? 'reference candidate' : 'generated-repair.ts')
  return (
    <section className={`difference-tray phase-${phase}`} aria-live="polite">
      <div className="difference-copy">
        <span className="eyebrow">{copy.kicker}</span>
        <h2>{copy.title}</h2>
        <p>{copy.detail}</p>
      </div>
      {phase === 'difference' && (
        <div className="delta-comparison">
          <span><small>Original</small>sellable_delta = 0</span>
          <span className="not-equal">≠</span>
          <span><small>Candidate</small>sellable_delta = +1</span>
        </div>
      )}
      {showPatch && (
        <div className="patch-slip">
          <span className="patch-file">
            {run.patchId} · {patchFile} · {patchOrigin}
            {run.codexThreadId ? ` · THREAD ${shortThread(run.codexThreadId)}` : ''}
          </span>
          {run.patchId === 'CODEX-PENDING' ? (
            <>
              <code>isolated worktree · one-file whitelist</code>
              <code>waiting for fresh verification evidence</code>
            </>
          ) : (
            <>
              <code><del>{preview.removed}</del></code>
              <code><ins>{preview.added}</ins></code>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function PlaybackPanel({ phase, run }: { phase: RunPhase; run: ProofRun }) {
  return (
    <main className="playback-panel">
      <div className="panel-heading playback-heading">
        <span>02 / Synchronized playback</span>
        <span className={`sync-status ${phase === 'proven' ? 'is-proven' : ''}`}>
          <i /> {phase === 'ready'
            ? 'READY'
            : phase === 'proven'
              ? `${run.stats.scenariosPassed} / ${run.stats.scenariosTotal} MATCH`
              : phase === 'unresolved'
                ? 'NOT SEALED'
                : 'CLOCKS LOCKED'}
        </span>
      </div>
      <div className="paired-viewports">
        <LegacyWindow phase={phase} />
        <CandidateWindow phase={phase} run={run} />
        <SyncTrack phase={phase} />
      </div>
      <DifferenceTray phase={phase} run={run} />
    </main>
  )
}

function EvidenceKind({ kind }: { kind: ProofRun['evidence'][number]['kind'] }) {
  return <span className={`kind kind-${kind}`}>{kind.toUpperCase()}</span>
}

function displayDigest(digest: string | undefined, source: ProofRun['source']): string {
  if (digest) {
    const clean = digest.startsWith('sha256:') ? digest.slice(7) : digest
    return `sha256:${clean.slice(0, 10)}…`
  }
  return source === 'live' ? 'DIGEST NOT PROVIDED' : 'FIXTURE HASH'
}

function ProofLedger({ run, phase }: { run: ProofRun; phase: RunPhase }) {
  const current = phasePosition(phase)
  return (
    <aside className="side-panel ledger-panel" aria-label="Proof ledger">
      <div className="panel-heading">
        <span>03 / Proof ledger</span>
        <span className="mono">SHA-256</span>
      </div>

      <div className="ledger-run">
        <span>RUN ID</span>
        <strong>{run.runId}</strong>
        <small>{new Date(run.capturedAt).toLocaleTimeString([], { hour12: false })} UTC+8</small>
      </div>

      <div className="evidence-list">
        {run.evidence.slice(0, 4).map((evidence, index) => {
          const sealed = current > index || phase === 'proven'
          const looksLikeMismatch =
            evidence.isMismatch === true || /mismatch|inventory|sellable|quarantine/i.test(`${evidence.label} ${evidence.detail}`)
          const flagged = looksLikeMismatch && (phase === 'difference' || phase === 'unresolved')
          return (
            <article className={`evidence-row ${sealed ? 'is-sealed' : ''} ${flagged ? 'is-flagged' : ''}`} key={evidence.id}>
              <div className="evidence-head">
                <span className="mono">{evidence.id}</span>
                <EvidenceKind kind={evidence.kind} />
              </div>
              <strong>{evidence.label}</strong>
              <p>{evidence.detail}</p>
              <div className="hash-row">
                <span>{displayDigest(evidence.digest, run.source)}</span>
                <span>{sealed ? 'SEALED ✓' : 'PENDING'}</span>
              </div>
            </article>
          )
        })}
      </div>

      {phase === 'proven' ? (
        <div className="proof-seal is-visible">
          <span className="seal-mark"><CheckIcon /></span>
          <span>
            <strong>Covered behavior conforms</strong>
            <small>{run.stats.scenariosPassed}/{run.stats.scenariosTotal} scenarios · {run.stats.assertions} assertions · {run.stats.differences} differences</small>
          </span>
        </div>
      ) : (
        <div className="proof-seal" aria-live="polite">
          <span className="seal-mark">···</span>
          <span><strong>Proof not sealed</strong><small>Awaiting a passing independent verification</small></span>
        </div>
      )}
    </aside>
  )
}

export default function App() {
  const [phase, setPhase] = useState<RunPhase>('ready')
  const [run, setRun] = useState<ProofRun>(sampleRun)
  const [isRunning, setIsRunning] = useState(false)
  const [runCount, setRunCount] = useState(0)

  const runProof = async () => {
    if (isRunning) return
    setIsRunning(true)
    setPhase('capturing')

    const delay = import.meta.env.MODE === 'test' ? 0 : 720
    const buggyResultPromise = requestProofRun('buggy')
    await wait(delay)
    const buggyResult = await buggyResultPromise
    setRun(buggyResult)

    if (buggyResult.status !== 'FAILED' || buggyResult.stats.differences === 0) {
      setPhase('unresolved')
      setRunCount((count) => count + 1)
      setIsRunning(false)
      return
    }

    setPhase('difference')
    await wait(delay + 180)

    if (buggyResult.source !== 'live') {
      setPhase('unresolved')
      setRunCount((count) => count + 1)
      setIsRunning(false)
      return
    }

    if (!buggyResult.proofId) {
      setRun({
        ...buggyResult,
        fallbackReason: 'The failed live run did not return a proofId, so no repair was requested.',
      })
      setPhase('unresolved')
      setRunCount((count) => count + 1)
      setIsRunning(false)
      return
    }

    setRun({
      ...buggyResult,
      candidateVersion: 'generated',
      patchId: 'CODEX-PENDING',
      fallbackReason: undefined,
    })
    setPhase('repairing')
    await wait(delay)
    const repairResult = await requestCodexRepair(buggyResult.proofId)

    if (repairResult.kind === 'unavailable') {
      setRun({
        ...buggyResult,
        candidateVersion: 'fixed',
        patchId: 'REF-PENDING',
        fallbackReason: repairResult.reason,
      })
      const fixedResult = await requestProofRun('fixed')
      const referenceResult = {
        ...fixedResult,
        fallbackReason:
          fixedResult.source === 'live'
            ? `Codex adapter unavailable; independently verified reference used. ${repairResult.reason}`
            : 'Codex adapter unavailable and the live reference verification could not be reached.',
      }
      setRun(referenceResult)
      setPhase('verifying')
      await wait(delay + 220)
      setPhase(
        referenceResult.source === 'live' &&
          referenceResult.candidateVersion === 'fixed' &&
          Boolean(referenceResult.proofId) &&
          referenceResult.status === 'PASSED' &&
          referenceResult.stats.differences === 0
          ? 'proven'
          : 'unresolved',
      )
      setRunCount((count) => count + 1)
      setIsRunning(false)
      return
    }

    if (repairResult.kind === 'failed') {
      const failedRun = repairResult.run ?? {
        ...buggyResult,
        candidateVersion: repairResult.codexExecuted || repairResult.threadId ? 'generated' as const : 'buggy' as const,
        codexExecuted: repairResult.codexExecuted,
        ...(repairResult.threadId ? { codexThreadId: repairResult.threadId } : {}),
        patchId: repairResult.threadId ? `CX-${shortThread(repairResult.threadId)}` : 'CODEX-FAILED',
      }
      setRun({ ...failedRun, fallbackReason: repairResult.reason })
      if (repairResult.run) {
        setPhase('verifying')
        await wait(delay)
      }
      setPhase('unresolved')
      setRunCount((count) => count + 1)
      setIsRunning(false)
      return
    }

    const freshRun = repairResult.run.runId !== buggyResult.runId
    if (!freshRun) {
      setRun({
        ...repairResult.run,
        fallbackReason: 'Codex verification reused the failed run ID; a fresh proof was not returned.',
      })
      setPhase('unresolved')
      setRunCount((count) => count + 1)
      setIsRunning(false)
      return
    }

    setRun(repairResult.run)
    setPhase('verifying')

    await wait(delay + 220)
    setPhase('proven')
    setRunCount((count) => count + 1)
    setIsRunning(false)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main-workbench" aria-label="TraceForge workbench home">
          <span className="brand-mark"><i />TF</span>
          <span><strong>TRACEFORGE</strong><small>Migration proof recorder</small></span>
        </a>

        <div className="project-identity">
          <span className="mono">PROJECT / RET-OPS-17</span>
          <strong>Damaged returns modernization</strong>
        </div>

        <div className="header-actions">
          <SourceBadge source={run.source} reason={run.fallbackReason} />
          <button className="run-button" type="button" onClick={runProof} disabled={isRunning}>
            <RunIcon />
            <span>{isRunning ? 'Proof running' : runCount ? 'Run proof again' : 'Run proof'}</span>
          </button>
        </div>
      </header>

      <div className="workbench" id="main-workbench">
        <WorkflowPanel run={run} phase={phase} />
        <PlaybackPanel phase={phase} run={run} />
        <ProofLedger run={run} phase={phase} />
      </div>

      <footer className="statusbar">
        <span><i className={`status-dot ${phase === 'proven' ? 'is-proven' : ''}`} /> {getStatusCopy(run)[phase].title}</span>
        <span>Coverage boundary: Web UI · REST · entity state</span>
        <span className="mono">TRACE {run.runId} / REV 07</span>
      </footer>
    </div>
  )
}
