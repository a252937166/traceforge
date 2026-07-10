export type RunPhase =
  | 'ready'
  | 'capturing'
  | 'difference'
  | 'repairing'
  | 'verifying'
  | 'proven'
  | 'unresolved'

export type DataSource = 'preview' | 'live' | 'sample'
export type CandidateVersion = 'buggy' | 'fixed' | 'generated'
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
  proofId: string
  capturedAt: string
  source: DataSource
  fallbackReason?: string
  status: VerificationStatus
  candidateVersion: CandidateVersion
  codexExecuted: boolean
  codexThreadId?: string
  codexChangedFiles?: string[]
  codexDiff?: string
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

export type RepairResult =
  | {
      kind: 'codex'
      run: ProofRun
      threadId: string
      changedFiles: string[]
    }
  | {
      kind: 'unavailable'
      reason: string
    }
  | {
      kind: 'failed'
      reason: string
      status: number
      run?: ProofRun
      threadId?: string
      codexExecuted: boolean
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
  proofId: 'proof_fixture_ret_1001',
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

type LiveProofValidation =
  | {
      ok: true
      runId: string
      proofId: string
      digest: string
    }
  | {
      ok: false
      reason: string
    }

const generatedRepairPath = 'apps/api/src/candidates/generated-repair.ts'

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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function validateLiveProof(raw: unknown, expectedCandidate: CandidateVersion): LiveProofValidation {
  const root = asRecord(raw)
  const envelope = asRecord(root.data ?? root.result ?? root)
  const proofBundle = asRecord(envelope.proofBundle ?? envelope.proof_bundle)
  const runId = stringValue(envelope.runId ?? envelope.run_id, '')
  const bundleRunId = stringValue(proofBundle.runId ?? proofBundle.run_id, '')
  const proofId = stringValue(proofBundle.proofId ?? proofBundle.proof_id, '')
  const digest = stringValue(proofBundle.digest, '')
  const status = envelope.status
  const proofStatus = proofBundle.status
  const candidateVersion = proofBundle.candidateVersion ?? proofBundle.candidate_version
  const problems: string[] = []

  if (!runId) problems.push('runId is missing')
  if (!bundleRunId || bundleRunId !== runId) problems.push('proofBundle.runId does not match runId')
  if (!proofId) problems.push('proofBundle.proofId is missing')
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) problems.push('proofBundle.digest is invalid')
  if (envelope.source !== 'deterministic-local-demo') problems.push('source is not the live deterministic runner')
  if (status !== 'PASSED' && status !== 'FAILED') problems.push('status is invalid')
  if (proofStatus !== status) problems.push('proofBundle.status does not match status')
  if (candidateVersion !== expectedCandidate) {
    problems.push(`candidateVersion is not ${expectedCandidate}`)
  }
  if (!Array.isArray(proofBundle.assertions) || proofBundle.assertions.length === 0) {
    problems.push('proofBundle.assertions is missing')
  }
  if (!Array.isArray(proofBundle.mismatches)) problems.push('proofBundle.mismatches is missing')

  return problems.length
    ? { ok: false, reason: problems.join('; ') }
    : { ok: true, runId, proofId, digest }
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
  const candidateVersion: CandidateVersion =
    rawVersion === 'buggy' || rawVersion === 'generated' ? rawVersion : 'fixed'
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
    proofId: stringValue(
      proofBundle.proofId ?? proofBundle.proof_id ?? envelope.proofId ?? envelope.proof_id,
      '',
    ),
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
      candidateVersion === 'fixed'
        ? 'REF-FIXED'
        : candidateVersion === 'generated'
          ? 'GEN-CANDIDATE'
          : 'BUGGY-BASELINE',
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

export async function requestProofRun(candidateVersion: 'buggy' | 'fixed'): Promise<ProofRun> {
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
    const raw = await response.json()
    const validation = validateLiveProof(raw, candidateVersion)
    if (!validation.ok) throw new Error(`Runner returned incomplete proof evidence: ${validation.reason}`)
    return normalizeLiveRun(raw)
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

function shortThreadId(threadId: string): string {
  const compact = threadId.replace(/^thread[_-]?/i, '')
  return compact.slice(0, 10) || 'unknown'
}

function responseErrorMessage(raw: unknown, fallback: string): string {
  const root = asRecord(raw)
  const error = asRecord(root.error)
  return stringValue(error.message ?? root.message, fallback)
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

export async function requestCodexRepair(proofId: string): Promise<RepairResult> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 300_000)

  try {
    const response = await fetch('/api/adapters/codex/repair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proofId }),
      signal: controller.signal,
    })
    const raw = await readJsonSafely(response)

    if (response.status === 501) {
      return {
        kind: 'unavailable',
        reason: responseErrorMessage(raw, 'Codex execution is not configured.'),
      }
    }

    const root = asRecord(raw)
    const data = asRecord(root.data)
    const verification = asRecord(data.verification)
    const whitelist = asRecord(verification.whitelist)
    const worktree = asRecord(data.worktree)
    const verificationRun = verification.run
    const threadId = stringValue(data.threadId, '')
    const codexExecuted = data.codexExecuted === true
    const changedFiles = stringArray(data.changedFiles)
    const whitelistChangedFiles = stringArray(whitelist.changed)
    const whitelistUnexpectedFiles = stringArray(whitelist.unexpected)
    const whitelistAllowedFiles = stringArray(whitelist.allowed)
    const diff = stringValue(data.diff, '')
    const liveValidation = validateLiveProof(verificationRun, 'generated')
    const whitelistPassed =
      whitelist.passed === true &&
      whitelist.requiredFileChanged === true &&
      whitelistUnexpectedFiles.length === 0 &&
      whitelistAllowedFiles.includes(generatedRepairPath) &&
      changedFiles.length === 1 &&
      changedFiles[0] === generatedRepairPath &&
      whitelistChangedFiles.length === 1 &&
      whitelistChangedFiles[0] === generatedRepairPath
    const retainedWorktree = worktree.retained === true && Boolean(stringValue(worktree.path, ''))
    const integrityProblems = [
      response.status === 200 ? '' : `HTTP status is ${response.status}, not 200`,
      codexExecuted ? '' : 'codexExecuted is not true',
      threadId ? '' : 'threadId is missing',
      verification.status === 'PASSED' ? '' : 'verification status is not PASSED',
      liveValidation.ok ? '' : `generated proof is invalid: ${liveValidation.reason}`,
      liveValidation.ok && liveValidation.proofId === proofId
        ? 'generated proof reused the failed source proofId'
        : '',
      whitelistPassed ? '' : 'one-file whitelist evidence is incomplete',
      diff ? '' : 'candidate diff is missing',
      retainedWorktree ? '' : 'retained worktree evidence is missing',
    ].filter(Boolean)

    if (integrityProblems.length === 0 && liveValidation.ok) {
      const run = normalizeLiveRun(verificationRun)
      if (run.status === 'PASSED' && run.stats.differences === 0) {
        return {
          kind: 'codex',
          threadId,
          changedFiles,
          run: {
            ...run,
            candidateVersion: 'generated',
            codexExecuted: true,
            codexThreadId: threadId,
            codexChangedFiles: changedFiles,
            codexDiff: diff,
            patchId: `CX-${shortThreadId(threadId)}`,
          },
        }
      }
    }

    const error = asRecord(root.error)
    const evidence = asRecord(error.evidence)
    const failureThreadId = stringValue(data.threadId ?? evidence.threadId, '') || undefined
    const failureChangedFilesRaw = data.changedFiles ?? evidence.changedFiles
    const failureChangedFiles = stringArray(failureChangedFilesRaw)
    const failureDiff = stringValue(data.diff ?? evidence.diff, '')
    const failureRunValidation = validateLiveProof(verificationRun, 'generated')
    const failedRun = failureRunValidation.ok ? normalizeLiveRun(verificationRun) : undefined
    const mismatchCount = failedRun?.stats.differences
    const fallbackReason = responseErrorMessage(
      raw,
      response.status === 422
        ? `Codex candidate failed independent verification${mismatchCount === undefined ? '.' : ` with ${mismatchCount} differences.`}`
        : response.status === 200 && integrityProblems.length
          ? `Codex success response failed integrity validation: ${integrityProblems.join('; ')}.`
        : `Codex repair failed with HTTP ${response.status}.`,
    )

    return {
      kind: 'failed',
      status: response.status,
      reason: fallbackReason,
      codexExecuted: codexExecuted || evidence.codexExecuted === true,
      ...(failureThreadId ? { threadId: failureThreadId } : {}),
      ...(failedRun
        ? {
            run: {
              ...failedRun,
              candidateVersion: 'generated' as const,
              codexExecuted: codexExecuted || evidence.codexExecuted === true,
              ...(failureThreadId ? { codexThreadId: failureThreadId } : {}),
              ...(failureChangedFiles.length ? { codexChangedFiles: failureChangedFiles } : {}),
              ...(failureDiff ? { codexDiff: failureDiff } : {}),
              patchId: failureThreadId ? `CX-${shortThreadId(failureThreadId)}` : 'GEN-FAILED',
            },
          }
        : {}),
    }
  } catch (error) {
    const reason =
      error instanceof DOMException && error.name === 'AbortError'
        ? 'Codex repair exceeded the five-minute browser timeout.'
        : error instanceof Error
          ? `Codex repair request failed: ${error.message}`
          : 'Codex repair request failed.'
    return { kind: 'failed', status: 0, reason, codexExecuted: false }
  } finally {
    window.clearTimeout(timeout)
  }
}

export function phasePosition(phase: RunPhase): number {
  return phases.indexOf(phase)
}
