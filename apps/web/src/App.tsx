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
      kicker: 'Dossier ready',
      title: 'Ready to prove this workflow',
      detail: 'The captured return trace is loaded. Start the replay to expose and repair the seeded divergence.',
    },
    capturing: {
      kicker: 'Pass 01 · Observe',
      title: 'Replaying the original behavior',
      detail: 'The runner is recording decisions and SQLite state before any candidate is evaluated.',
    },
    difference: {
      kicker: 'Pass 02 · Compare',
      title: 'Difference D-01 isolated',
      detail: 'The replacement restored a damaged unit to sellable inventory instead of quarantine.',
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
            ? 'The generated change remains a candidate until the host verifier accepts a fresh proof.'
            : 'A deterministic reference patch is applied. No model execution is claimed.',
    },
    verifying: {
      kicker: 'Pass 04 · Verify',
      title: `Replaying ${run.stats.scenariosTotal} covered scenario`,
      detail: 'The host compares five business fields after resetting and reading both SQLite partitions.',
    },
    proven: {
      kicker: 'Pass 04 · Sealed',
      title: 'Proof sealed',
      detail: `${run.codexExecuted ? 'Codex-generated' : 'Reference'} candidate conforms in ${run.stats.scenariosPassed} of ${run.stats.scenariosTotal} covered scenario.`,
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
            : `${run.stats.differences} differences remain after the candidate repair.`,
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
    preview: ['Demo fixture', 'Not executed'],
    live: ['Live runner', 'Fresh evidence'],
    sample: ['Sample data', 'API fallback'],
  }[source]

  return (
    <div
      className={`source-badge source-${source}`}
      aria-label={`${copy[0]}. ${copy[1]}${reason ? `. ${reason}` : ''}`}
    >
      <span className="source-light" />
      <span>
        <strong>{copy[0]}</strong>
        <small>{copy[1]}</small>
      </span>
    </div>
  )
}

function MetricCard({
  step,
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  step: string
  label: string
  value: string
  detail: string
  tone?: 'neutral' | 'danger' | 'success'
}) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-label"><span>{step}</span>{label}</div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  )
}

function StoryStrip({ phase, run, failedRun }: { phase: RunPhase; run: ProofRun; failedRun: ProofRun | null }) {
  const observedDifferences = failedRun?.stats.differences
    ?? (phase === 'difference' || phase === 'repairing' || phase === 'unresolved' ? run.stats.differences : 0)
  const writer = run.patchId === 'CODEX-PENDING'
    ? 'Running'
    : run.codexExecuted
      ? 'Codex'
      : run.patchId === 'REF-PENDING' || (phase === 'proven' && run.source === 'live')
        ? 'Reference'
        : 'Waiting'
  const proofValue = phase === 'proven' ? 'Sealed' : phase === 'unresolved' ? 'Open' : 'Pending'

  return (
    <section className="story-strip" aria-label="Migration proof summary">
      <MetricCard step="01" label="Old system" value="4 steps" detail={`${run.rules.length} evidence-linked rules captured`} />
      <MetricCard
        step="02"
        label="Difference"
        value={observedDifferences ? `${observedDifferences} found` : 'Awaiting'}
        detail="Damaged stock disposition is the separating behavior"
        tone={observedDifferences ? 'danger' : 'neutral'}
      />
      <MetricCard step="03" label="Repair writer" value={writer} detail="One file · retained worktree · no auto-apply" />
      <MetricCard
        step="04"
        label="Independent proof"
        value={proofValue}
        detail={`${run.stats.assertions} assertions · ${phase === 'proven' ? 0 : run.stats.differences} remaining differences`}
        tone={phase === 'proven' ? 'success' : phase === 'unresolved' ? 'danger' : 'neutral'}
      />
    </section>
  )
}

function InventoryValue({ before, after }: { before: string; after: string }) {
  return (
    <span className="inventory-value">
      <span>{before}</span><i aria-hidden="true">→</i><strong>{after}</strong>
    </span>
  )
}

function SystemSnapshot({
  kind,
  eyebrow,
  title,
  badge,
  detail,
  sellable,
  quarantine,
  ariaLabel,
}: {
  kind: 'legacy' | 'broken' | 'repaired'
  eyebrow: string
  title: string
  badge: string
  detail: string
  sellable: [string, string]
  quarantine: [string, string]
  ariaLabel: string
}) {
  return (
    <article className={`system-snapshot system-${kind}`} aria-label={ariaLabel}>
      <div className="snapshot-heading">
        <span>{eyebrow}</span>
        <em>{badge}</em>
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
      <dl>
        <div>
          <dt>Decision</dt>
          <dd>REFUND</dd>
        </div>
        <div>
          <dt>Return status</dt>
          <dd>REFUNDED</dd>
        </div>
        <div className="inventory-row">
          <dt>Sellable stock</dt>
          <dd><InventoryValue before={sellable[0]} after={sellable[1]} /></dd>
        </div>
        <div className="inventory-row">
          <dt>Quarantine</dt>
          <dd><InventoryValue before={quarantine[0]} after={quarantine[1]} /></dd>
        </div>
      </dl>
    </article>
  )
}

function ReplayProgress({ phase }: { phase: RunPhase }) {
  const position = phase === 'proven' || phase === 'unresolved'
    ? 100
    : (phasePosition(phase) / (phases.length - 2)) * 100
  const style = { '--progress-scale': position / 100 } as CSSProperties

  return (
    <div
      className="replay-progress"
      style={style}
      role="progressbar"
      aria-label={`Replay progress: ${Math.round(position)} percent`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(position)}
    >
      <span className="progress-fill" />
      <ol>
        <li>Observe</li>
        <li>Compare</li>
        <li>Repair</li>
        <li>Verify</li>
      </ol>
    </div>
  )
}

function DifferenceTray({ phase, run }: { phase: RunPhase; run: ProofRun }) {
  const copy = getStatusCopy(run)[phase]
  const bandCopy: Record<RunPhase, { title: string; detail: string }> = {
    ready: {
      title: 'No candidate promoted',
      detail: 'The dossier is staged; the verifier has not evaluated a replacement yet.',
    },
    capturing: {
      title: 'Source trace in progress',
      detail: 'Legacy decisions and state transitions are being sealed before comparison.',
    },
    difference: {
      title: 'Inventory side effect diverges',
      detail: 'The failure remains in view so the repair can be judged against a concrete defect.',
    },
    repairing: {
      title: 'Candidate writer engaged',
      detail: 'The generated diff remains quarantined until the host returns fresh verification evidence.',
    },
    verifying: {
      title: 'Fresh rerun in progress',
      detail: 'The host is replaying the same scenario against the repaired candidate.',
    },
    proven: {
      title: 'Zero differences remain',
      detail: 'The failed run is retained beside the fresh conforming result.',
    },
    unresolved: {
      title: 'Candidate remains unpromoted',
      detail: 'Review the proof register for the evidence that blocked promotion.',
    },
  }
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
  const patchFile = run.codexChangedFiles?.[0]
    ?? (run.candidateVersion === 'fixed' ? 'reference candidate' : 'generated-repair.ts')

  return (
    <section className={`verdict-band phase-${phase}`} aria-live="polite">
      <div className="verdict-copy">
        <span className="eyebrow">{copy.kicker}</span>
        <h2>{bandCopy[phase].title}</h2>
        <p>{bandCopy[phase].detail}</p>
      </div>

      {phase === 'difference' && (
        <div className="delta-comparison">
          <span><small>Legacy</small>sellable_delta = 0</span>
          <strong aria-label="does not equal">≠</strong>
          <span><small>Broken candidate</small>sellable_delta = +1</span>
        </div>
      )}

      {showPatch && (
        <div className="patch-slip">
          <span className="patch-file">
            {patchOrigin}{run.codexThreadId ? ` · THREAD ${shortThread(run.codexThreadId)}` : ''}
          </span>
          <small>{run.patchId} · {patchFile}</small>
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

      {!showPatch && phase !== 'difference' && (
        <div className="claim-boundary">
          <strong>Bounded claim</strong>
          <span>One observed branch</span>
          <span>Five deterministic fields</span>
          <span>No universal equivalence claim</span>
        </div>
      )}
    </section>
  )
}

function PlaybackPanel({ phase, run, failedRun }: { phase: RunPhase; run: ProofRun; failedRun: ProofRun | null }) {
  const failureVisible = Boolean(failedRun) || ['difference', 'repairing'].includes(phase)
  const repairVisible = ['verifying', 'proven'].includes(phase)
    || (phase === 'unresolved' && run.candidateVersion !== 'buggy')
  const repairPassed = phase === 'proven' || phase === 'verifying'
  const repairFailed = phase === 'unresolved' && run.stats.differences > 0
  const repairSellable: [string, string] = repairPassed ? ['10', '10'] : repairFailed ? ['10', '11'] : ['10', '—']
  const repairQuarantine: [string, string] = repairPassed ? ['0', '1'] : repairFailed ? ['0', '0'] : ['0', '—']
  const repairBadge = phase === 'proven'
    ? 'VERIFIED'
    : phase === 'verifying'
      ? 'REPLAYING'
      : phase === 'unresolved'
        ? 'NOT SEALED'
        : 'PENDING'

  return (
    <section className="panel comparison-panel">
      <header className="panel-title-row">
        <div>
          <h2>Migration comparison</h2>
          <p>One input · three states · the failure remains visible after repair</p>
        </div>
        <span className="panel-count">RET-1001 · $45.00</span>
      </header>

      <div className="scenario-ribbon">
        <span><small>Customer</small>STANDARD</span>
        <span><small>Condition</small>DAMAGED</span>
        <span><small>Expected route</small>QUARANTINE</span>
        <span><small>Coverage</small>Observed branch only</span>
      </div>

      <div className="system-triptych">
        <SystemSnapshot
          kind="legacy"
          eyebrow="Original system"
          title="Legacy behavior"
          badge={phase === 'ready' ? 'PREVIEW' : 'CAPTURED'}
          detail="The observed source of truth for this concrete return."
          sellable={['10', '10']}
          quarantine={['0', '1']}
          ariaLabel="Original application playback"
        />
        <SystemSnapshot
          kind="broken"
          eyebrow="Before repair"
          title="Broken replacement"
          badge={failureVisible ? 'D-01 FOUND' : 'SEEDED'}
          detail="The refund succeeds, but its inventory side effect diverges."
          sellable={['10', '11']}
          quarantine={['0', '0']}
          ariaLabel="Replacement application playback"
        />
        <SystemSnapshot
          kind="repaired"
          eyebrow="After repair"
          title={repairVisible ? 'Candidate rerun' : 'Awaiting candidate'}
          badge={repairBadge}
          detail={repairPassed
            ? 'Fresh execution matches all five asserted fields.'
            : repairFailed
              ? 'The attempted candidate still differs from the legacy trace.'
              : 'No change is promoted until a fresh host verification passes.'}
          sellable={repairSellable}
          quarantine={repairQuarantine}
          ariaLabel="Repaired application playback"
        />
      </div>

      <ReplayProgress phase={phase} />
      <DifferenceTray phase={phase} run={run} />
    </section>
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
    <section className="panel contract-panel" aria-label="Captured workflow and behavior rules">
      <header className="panel-title-row">
        <div>
          <h2>Behavior contract</h2>
          <p>Every rule points back to captured evidence</p>
        </div>
        <span className="panel-count">{workflow.length} steps · {run.rules.length} rules</span>
      </header>

      <div className="contract-grid">
        <ol className="workflow-steps">
          {workflow.map((step, index) => (
            <li key={step.id}>
              <StepStatus phase={phase} index={index} />
              <span>
                <strong>{step.label}</strong>
                <small>{workflowEvidenceId(run, index, step.evidence)}</small>
              </span>
            </li>
          ))}
        </ol>

        <div className="rule-table">
          <div className="rule-table-head">
            <span>Rule</span><span>Observed behavior</span><span>Evidence</span>
          </div>
          {run.rules.slice(0, 4).map((rule, index) => (
            <article className={index === run.rules.length - 1 && phase === 'difference' ? 'is-flagged' : ''} key={rule.id}>
              <span>
                <strong>{rule.id}</strong>
                <small>{Math.round(rule.confidence * 100)}% confidence</small>
              </span>
              <p>{rule.statement}</p>
              <code>{rule.evidenceIds.join(' + ') || 'Evidence pending'}</code>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function EvidenceKind({ kind }: { kind: ProofRun['evidence'][number]['kind'] }) {
  return <span className={`kind kind-${kind}`}>{kind.toUpperCase()}</span>
}

function displayDigest(digest: string | undefined, source: ProofRun['source'], compact = true): string {
  if (digest) {
    const clean = digest.startsWith('sha256:') ? digest.slice(7) : digest
    return compact ? `sha256:${clean.slice(0, 10)}…` : `sha256:${clean}`
  }
  return source === 'live' ? 'DIGEST NOT PROVIDED' : 'FIXTURE HASH'
}

function ProofLedger({ run, phase }: { run: ProofRun; phase: RunPhase }) {
  const current = phasePosition(phase)
  const copy = getStatusCopy(run)[phase]
  const outcomeTitle = phase === 'proven'
    ? 'Proof sealed'
    : phase === 'unresolved'
      ? copy.title
      : 'Proof not sealed'

  return (
    <aside className="panel proof-panel" aria-label="Proof ledger">
      <header className="panel-title-row compact-title-row">
        <div>
          <h2>Proof register</h2>
          <p>Host-verifiable evidence</p>
        </div>
        <span className="panel-count">SHA-256</span>
      </header>

      <div className={`proof-outcome ${phase === 'proven' ? 'is-proven' : phase === 'unresolved' ? 'is-failed' : ''}`} aria-live="polite">
        <span className="proof-kicker">{copy.kicker}</span>
        <h2>{outcomeTitle}</h2>
        <p>{copy.detail}</p>
        <div className="proof-numbers">
          <span><strong>{run.stats.assertions}</strong><small>assertions</small></span>
          <span><strong>{run.stats.scenariosTotal}</strong><small>scenario</small></span>
          <span><strong>{run.stats.differences}</strong><small>differences</small></span>
        </div>
      </div>

      <dl className="run-metadata">
        <div><dt>Run ID</dt><dd>{run.runId}</dd></div>
        <div><dt>Proof ID</dt><dd>{run.proofId || 'not issued'}</dd></div>
        <div><dt>Captured</dt><dd>{new Date(run.capturedAt).toLocaleTimeString([], { hour12: false })} UTC+8</dd></div>
      </dl>

      <div className="evidence-register">
        <div className="register-heading"><span>Evidence</span><span>Seal</span></div>
        {run.evidence.slice(0, 4).map((evidence, index) => {
          const sealed = current > index || phase === 'proven'
          const looksLikeMismatch = evidence.isMismatch === true
            || /mismatch|inventory|sellable|quarantine/i.test(`${evidence.label} ${evidence.detail}`)
          const flagged = looksLikeMismatch && (phase === 'difference' || phase === 'unresolved')

          return (
            <details className={`evidence-row ${sealed ? 'is-sealed' : ''} ${flagged ? 'is-flagged' : ''}`} key={evidence.id}>
              <summary>
                <span className="evidence-symbol">{String(index + 1).padStart(2, '0')}</span>
                <span className="evidence-copy">
                  <span><strong>{evidence.label}</strong><EvidenceKind kind={evidence.kind} /></span>
                  <small>{evidence.id}</small>
                </span>
                <em>{sealed ? 'SEALED' : 'PENDING'}</em>
              </summary>
              <div className="evidence-detail">
                <p>{evidence.detail}</p>
                <code>{displayDigest(evidence.digest, run.source, false)}</code>
              </div>
            </details>
          )
        })}
      </div>

      {phase === 'proven' ? (
        <div className="proof-seal is-visible">
          <span className="seal-mark"><CheckIcon /></span>
          <span>
            <strong>Covered behavior conforms</strong>
            <small>{run.stats.scenariosPassed}/{run.stats.scenariosTotal} scenario · {run.stats.assertions} assertions · {run.stats.differences} differences</small>
          </span>
        </div>
      ) : (
        <div className="proof-seal">
          <span className="seal-mark">···</span>
          <span><strong>Awaiting independent verifier</strong><small>No passing proof has been promoted</small></span>
        </div>
      )}
    </aside>
  )
}

function ActivityPanel({ run, phase, failedRun }: { run: ProofRun; phase: RunPhase; failedRun: ProofRun | null }) {
  const hasFailure = Boolean(failedRun) || ['difference', 'repairing', 'verifying', 'proven'].includes(phase)
  const repairStarted = ['repairing', 'verifying', 'proven'].includes(phase)
    || (phase === 'unresolved' && run.candidateVersion !== 'buggy')
  const activities = [
    {
      icon: '01',
      title: 'Legacy trace recorded',
      detail: 'Decision, refund, and SQLite state captured',
      state: phase === 'ready' ? 'waiting' : 'done',
    },
    {
      icon: 'D1',
      title: 'Behavioral difference retained',
      detail: hasFailure ? `${failedRun?.stats.differences ?? run.stats.differences} state fields diverged` : 'Candidate comparison pending',
      state: hasFailure ? 'danger' : 'waiting',
    },
    {
      icon: 'CX',
      title: run.codexExecuted ? 'Generated candidate returned' : 'Candidate repair boundary',
      detail: run.codexThreadId ? `Thread ${shortThread(run.codexThreadId)} · one file changed` : 'One writer · one allowed file · retained worktree',
      state: repairStarted ? (phase === 'unresolved' ? 'danger' : 'done') : 'waiting',
    },
    {
      icon: '✓',
      title: 'Host verifier decides',
      detail: phase === 'proven' ? 'Fresh run and proof IDs · zero mismatches' : 'Writer cannot approve its own candidate',
      state: phase === 'proven' ? 'done' : phase === 'unresolved' ? 'danger' : 'waiting',
    },
  ]

  return (
    <section className="panel activity-panel" aria-label="Verification activity">
      <header className="panel-title-row compact-title-row">
        <div>
          <h2>Run activity</h2>
          <p>Separation of powers</p>
        </div>
        <span className="panel-count">LIVE</span>
      </header>
      <div className="activity-list">
        {activities.map((activity) => (
          <article className={`activity-${activity.state}`} key={activity.icon}>
            <span>{activity.icon}</span>
            <div><strong>{activity.title}</strong><small>{activity.detail}</small></div>
          </article>
        ))}
      </div>
      <div className="trust-boundary">
        <span>Writer</span><strong>Codex worktree</strong>
        <i aria-hidden="true">≠</i>
        <span>Verifier</span><strong>Host process</strong>
      </div>
    </section>
  )
}

export default function App() {
  const [phase, setPhase] = useState<RunPhase>('ready')
  const [run, setRun] = useState<ProofRun>(sampleRun)
  const [failedRun, setFailedRun] = useState<ProofRun | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [runCount, setRunCount] = useState(0)

  const runProof = async () => {
    if (isRunning) return
    setIsRunning(true)
    setFailedRun(null)
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

    setFailedRun(buggyResult)
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
      const failedCandidate = repairResult.run ?? {
        ...buggyResult,
        candidateVersion: repairResult.codexExecuted || repairResult.threadId ? 'generated' as const : 'buggy' as const,
        codexExecuted: repairResult.codexExecuted,
        ...(repairResult.threadId ? { codexThreadId: repairResult.threadId } : {}),
        patchId: repairResult.threadId ? `CX-${shortThread(repairResult.threadId)}` : 'CODEX-FAILED',
      }
      setRun({ ...failedCandidate, fallbackReason: repairResult.reason })
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
      <header className="masthead">
        <a className="brand" href="#main-workbench" aria-label="TraceForge workbench home">
          <span className="brand-mark">TF</span>
          <span><strong>TRACEFORGE</strong><small>Behavioral migration proof</small></span>
        </a>

        <div className="project-identity">
          <span>PROJECT / RET-OPS-17</span>
          <h1>Damaged returns modernization</h1>
        </div>

        <div className="header-actions">
          <SourceBadge source={run.source} reason={run.fallbackReason} />
          <button className="run-button" type="button" onClick={runProof} disabled={isRunning}>
            <RunIcon />
            <span>{isRunning ? 'Proof running' : runCount ? 'Run proof again' : 'Run proof'}</span>
          </button>
        </div>
      </header>

      <main className="page" id="main-workbench">
        <StoryStrip phase={phase} run={run} failedRun={failedRun} />
        <div className="dashboard-grid">
          <div className="primary-stack">
            <PlaybackPanel phase={phase} run={run} failedRun={failedRun} />
            <WorkflowPanel run={run} phase={phase} />
          </div>
          <div className="secondary-stack">
            <ProofLedger run={run} phase={phase} />
            <ActivityPanel run={run} phase={phase} failedRun={failedRun} />
          </div>
        </div>
      </main>

      <footer className="statusbar">
        <span><i className={`status-dot ${phase === 'proven' ? 'is-proven' : ''}`} />{getStatusCopy(run)[phase].title}</span>
        <span>Coverage: Web UI · REST · SQLite entity state</span>
        <span>TRACE {run.runId}</span>
      </footer>
    </div>
  )
}
