export type RunPhase =
  | 'ready'
  | 'capturing'
  | 'difference'
  | 'repairing'
  | 'verifying'
  | 'proven'
  | 'unresolved'

export type DataSource = 'preview' | 'live' | 'sample'
export type CandidateVersion = 'buggy' | 'fixed'
export type VerificationStatus = 'PASSED' | 'FAILED' | 'UNKNOWN'

export type EvidenceItem = {
  id: string
  label: string
  detail: string
  kind: 'dom' | 'api' | 'state' | 'code'
  digest?: string
  isMismatch?: boolean
}

export type BehaviorRule = {
  id: string
  statement: string
  confidence: number
  evidenceIds: string[]
}

export type ProofRun = {
  runId: string
  capturedAt: string
  source: DataSource
  fallbackReason?: string
  status: VerificationStatus
  candidateVersion: CandidateVersion
  codexExecuted: boolean
  patchId: string
  stats: {
    scenariosPassed: number
    scenariosTotal: number
    assertions: number
    differences: number
  }
  evidence: EvidenceItem[]
  rules: BehaviorRule[]
}

export const phases: RunPhase[] = [
  'ready',
  'capturing',
  'difference',
  'repairing',
  'verifying',
  'proven',
  'unresolved',
]

export const sampleRun: ProofRun = {
  runId: 'TF-RET-1001',
  capturedAt: '2026-07-10T09:42:18.000Z',
  source: 'preview',
  status: 'UNKNOWN',
  candidateVersion: 'fixed',
  codexExecuted: false,
  patchId: 'CF-017',
  stats: {
    scenariosPassed: 1,
    scenariosTotal: 1,
    assertions: 7,
    differences: 0,
  },
  evidence: [
    {
      id: 'EV-001',
      label: 'Return opened',
      detail: 'DOM · return RET-1001 · STANDARD · $45.00',
      kind: 'dom',
    },
    {
      id: 'EV-004',
      label: 'Refund selected',
      detail: 'POST /returns/RET-1001/resolve · REFUND',
      kind: 'api',
    },
    {
      id: 'EV-009',
      label: 'Inventory mutation',
      detail: 'sellable 10→10 · quarantine 0→1',
      kind: 'state',
      isMismatch: true,
    },
    {
      id: 'EV-011',
      label: 'Case closed',
      detail: 'decision REFUND · amount $45.00',
      kind: 'state',
    },
  ],
  rules: [
    {
      id: 'RULE-STANDARD-REFUND',
      statement: 'Eligible standard-customer returns are refunded.',
      confidence: 1,
      evidenceIds: ['EV-001', 'EV-004'],
    },
    {
      id: 'RULE-DAMAGED-DISPOSITION',
      statement: 'A processed damaged return never increases sellable inventory and enters quarantine.',
      confidence: 1,
      evidenceIds: ['EV-004', 'EV-009', 'EV-011'],
    },
  ],
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : {}
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function numberValue(value: unknown, fallback: number): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

function normalizeEvidence(value: unknown): EvidenceItem[] {
  if (!Array.isArray(value) || value.length === 0) return sampleRun.evidence

  return value.map((entry, index) => {
    const item = asRecord(entry)
    const rawKind = item.kind
    const kind: EvidenceItem['kind'] =
      rawKind === 'dom' || rawKind === 'api' || rawKind === 'state' || rawKind === 'code'
        ? rawKind
        : 'state'

    return {
      id: stringValue(item.id ?? item.evidenceId, `EV-${String(index + 1).padStart(3, '0')}`),
      label: stringValue(item.label ?? item.title, `Captured evidence ${index + 1}`),
      detail: stringValue(item.detail ?? item.description, 'Evidence returned by the live runner'),
      kind,
      digest: stringValue(item.digest ?? item.sha256 ?? item.hash, '') || undefined,
      isMismatch:
        item.isMismatch === true ||
        item.status === 'FAILED' ||
        stringValue(item.type, '').toLowerCase().includes('mismatch'),
    }
  })
}

function normalizeRules(value: unknown): BehaviorRule[] {
  if (!Array.isArray(value) || value.length === 0) return sampleRun.rules

  return value.map((entry, index) => {
    const item = asRecord(entry)
    const rawEvidence = item.evidenceIds ?? item.evidence_ids
    const evidenceIds = Array.isArray(rawEvidence)
      ? rawEvidence.filter((id): id is string => typeof id === 'string')
      : []
    const numericConfidence = Number(item.confidence)

    return {
      id: stringValue(item.id ?? item.ruleId, `R-${String(index + 1).padStart(2, '0')}`),
      statement: stringValue(item.statement ?? item.rule ?? item.description, 'Observed behavior rule'),
      confidence: Number.isFinite(numericConfidence)
        ? Math.min(1, Math.max(0, numericConfidence > 1 ? numericConfidence / 100 : numericConfidence))
        : 0.8,
      evidenceIds,
    }
  })
}

export function normalizeLiveRun(raw: unknown): ProofRun {
  const root = asRecord(raw)
  const envelope = asRecord(root.data ?? root.result ?? root)
  const proof = asRecord(envelope.proof ?? envelope.verification ?? envelope.summary)
  const stats = asRecord(proof.stats ?? envelope.stats ?? proof)
  const patch = asRecord(envelope.patch ?? envelope.candidate)
  const proofBundle = asRecord(envelope.proofBundle ?? envelope.proof_bundle)
  const assertions = Array.isArray(proofBundle.assertions)
    ? proofBundle.assertions
    : Array.isArray(envelope.proofs)
      ? envelope.proofs
      : []
  const mismatches = Array.isArray(proofBundle.mismatches)
    ? proofBundle.mismatches
    : assertions.filter((assertion) => asRecord(assertion).status === 'FAILED')
  const rawStatus = envelope.status ?? proofBundle.status
  const status: VerificationStatus = rawStatus === 'PASSED' || rawStatus === 'FAILED' ? rawStatus : 'UNKNOWN'
  const rawVersion = proofBundle.candidateVersion ?? envelope.candidateVersion
  const candidateVersion: CandidateVersion = rawVersion === 'buggy' ? 'buggy' : 'fixed'
  const rawScenarios = envelope.scenarios ?? proof.scenarios
  const scenarioList = Array.isArray(rawScenarios) ? rawScenarios : []
  const scenariosTotal = numberValue(
    stats.scenariosTotal ?? stats.scenarios_total ?? stats.total,
    scenarioList.length || 1,
  )
  const inferredPassed = scenarioList.filter((scenario) => {
    const item = asRecord(scenario)
    return item.passed === true || item.status === 'passed' || item.status === 'pass'
  }).length

  return {
    runId: stringValue(envelope.runId ?? envelope.run_id ?? envelope.id, sampleRun.runId),
    capturedAt: stringValue(
      envelope.capturedAt ?? envelope.captured_at ?? envelope.startedAt ?? proofBundle.generatedAt,
      new Date().toISOString(),
    ),
    source: 'live',
    status,
    candidateVersion,
    codexExecuted:
      envelope.codexExecuted === true ||
      envelope.codex_executed === true ||
      patch.codexExecuted === true ||
      patch.generatedBy === 'codex',
    patchId: stringValue(
      patch.id ?? envelope.patchId ?? envelope.patch_id,
      candidateVersion === 'fixed' ? 'REF-FIXED' : 'BUGGY-BASELINE',
    ),
    stats: {
      scenariosPassed: numberValue(
        stats.scenariosPassed ?? stats.scenarios_passed ?? stats.passed,
        scenarioList.length > 0 ? inferredPassed : status === 'PASSED' ? 1 : 0,
      ),
      scenariosTotal,
      assertions: numberValue(
        stats.assertions ?? stats.assertionCount ?? stats.assertion_count,
        assertions.length || sampleRun.stats.assertions,
      ),
      differences: numberValue(
        stats.differences ?? stats.differenceCount ?? stats.difference_count,
        mismatches.length,
      ),
    },
    evidence: normalizeEvidence(envelope.evidence ?? envelope.events ?? envelope.proofs),
    rules: normalizeRules(envelope.rules ?? envelope.contracts ?? envelope.behaviorRules),
  }
}

export async function requestProofRun(candidateVersion: CandidateVersion): Promise<ProofRun> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 4_000)

  try {
    const response = await fetch('/api/demo/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'damaged-small-refund', candidateVersion }),
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(`Runner returned HTTP ${response.status}`)
    return normalizeLiveRun(await response.json())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The demo runner is unavailable'
    const failedFixture = candidateVersion === 'buggy'
    return {
      ...sampleRun,
      source: 'sample',
      fallbackReason: message,
      capturedAt: new Date().toISOString(),
      status: failedFixture ? 'FAILED' : 'PASSED',
      candidateVersion,
      patchId: failedFixture ? 'BUGGY-BASELINE' : 'REF-FIXED',
      stats: {
        scenariosPassed: failedFixture ? 0 : 1,
        scenariosTotal: 1,
        assertions: 7,
        differences: failedFixture ? 2 : 0,
      },
    }
  } finally {
    window.clearTimeout(timeout)
  }
}

export function phasePosition(phase: RunPhase): number {
  return phases.indexOf(phase)
}
