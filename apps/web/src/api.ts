import type {
  ArtifactKind,
  BehaviorHypothesis,
  Counterexample,
  EvidenceRef,
  ExecutionMode,
  MigrationArtifact,
  MigrationCandidate,
  MigrationEvent,
  MigrationEventPayload,
  MigrationEventType,
  MigrationJob,
  MigrationJobStatus,
  MigrationStage,
  ProofBundle,
  VerificationStatus,
} from './migration-types'

type UnknownRecord = Record<string, unknown>

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' ? (value as UnknownRecord) : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function unwrap(body: unknown): unknown {
  const root = asRecord(body)
  return 'data' in root ? root.data : body
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const body = await response.json().catch(() => undefined)
  if (!response.ok) {
    const error = asRecord(asRecord(body).error)
    throw new ApiError(
      asString(error.message, `TraceForge API returned ${response.status}.`),
      response.status,
      asString(error.code) || undefined,
    )
  }
  return unwrap(body)
}

function normalizeMode(value: unknown): ExecutionMode {
  return value === 'recorded-replay' || value === 'deterministic-only' ? value : 'live-ai'
}

function normalizeJobStatus(value: unknown): MigrationJobStatus {
  if (value === 'succeeded' || value === 'passed') return 'passed'
  if (value === 'failed' || value === 'cancelled') return value
  if (value === 'running') return 'running'
  return 'queued'
}

function normalizeStage(value: unknown): MigrationStage | undefined {
  return value === 'observe' || value === 'infer' || value === 'challenge' || value === 'build' || value === 'verify'
    ? value
    : undefined
}

export function normalizeMigrationJob(raw: unknown): MigrationJob {
  const job = asRecord(raw)
  const error = asRecord(job.error ?? job.failure)
  const executionMode = normalizeMode(job.executionMode)
  const id = asString(job.id)
  const createdAt = asString(job.createdAt, new Date(0).toISOString())
  const recordedAt = asString(job.recordedAt)

  if (!id) throw new ApiError('Migration response did not include an id.', 502, 'INVALID_JOB')

  return {
    id,
    executionMode,
    status: normalizeJobStatus(job.status),
    createdAt,
    updatedAt: asString(job.updatedAt ?? job.completedAt ?? job.startedAt, createdAt),
    modelId: asString(job.modelId ?? job.model) || undefined,
    currentStage: normalizeStage(job.currentStage),
    replay: executionMode === 'recorded-replay' && recordedAt
      ? {
          recordedAt,
          sourceRunId: asString(job.sourceRunId, id),
          modelId: asString(job.modelId ?? job.model) || undefined,
          disclosure: asString(
            job.replayDisclosure,
            'Recorded execution. Events are replayed from the timestamp shown and are not live model calls.',
          ),
        }
      : undefined,
    failure: asString(error.message)
      ? { code: asString(error.code, 'MIGRATION_FAILED'), message: asString(error.message) }
      : undefined,
  }
}

function normalizeHypothesis(value: unknown): BehaviorHypothesis | undefined {
  const item = asRecord(value)
  const id = asString(item.id)
  if (!id) return undefined
  const status = item.status
  return {
    id,
    revision: asNumber(item.revision, 1),
    statement: asString(item.statement),
    status: status === 'challenged' || status === 'falsified' || status === 'refined' || status === 'accepted'
      ? status
      : 'proposed',
    confidence: asNumber(item.confidence),
    evidenceIds: asStringArray(item.evidenceIds),
    supersedesId: asString(item.supersedesId) || undefined,
    falsifiedByCounterexampleId: asString(item.falsifiedByCounterexampleId) || undefined,
    createdAt: asString(item.createdAt) || undefined,
  }
}

function normalizeCounterexample(value: unknown): Counterexample | undefined {
  const item = asRecord(value)
  const id = asString(item.id)
  if (!id) return undefined
  const status = item.status
  return {
    id,
    title: asString(item.title, id),
    rationale: asString(item.rationale),
    status: status === 'running' || status === 'confirmed' || status === 'inconclusive' || status === 'rejected'
      ? status
      : 'proposed',
    scenario: asRecord(item.scenario),
    expectedDiscrimination: asString(item.expectedDiscrimination) || undefined,
    observedOutcome: Object.keys(asRecord(item.observedOutcome)).length ? asRecord(item.observedOutcome) : undefined,
    evidenceIds: asStringArray(item.evidenceIds),
    targetHypothesisIds: asStringArray(item.targetHypothesisIds),
  }
}

function normalizeCandidate(value: unknown): MigrationCandidate | undefined {
  const item = asRecord(value)
  const id = asString(item.id)
  if (!id) return undefined
  const validStatuses: MigrationCandidate['status'][] = [
    'queued', 'building', 'built', 'verifying', 'rejected', 'accepted', 'failed',
  ]
  return {
    id,
    revision: asNumber(item.revision, 1),
    status: validStatuses.includes(item.status as MigrationCandidate['status'])
      ? item.status as MigrationCandidate['status']
      : 'queued',
    summary: asString(item.summary),
    createdAt: asString(item.createdAt) || undefined,
    modelId: asString(item.modelId) || undefined,
    codexThreadId: asString(item.codexThreadId) || undefined,
    changedFiles: asStringArray(item.changedFiles),
    diffArtifactId: asString(item.diffArtifactId) || undefined,
    rejectedByScenarioIds: asStringArray(item.rejectedByScenarioIds),
  }
}

function normalizeVerificationStatus(value: unknown): VerificationStatus {
  return value === 'PASSED' || value === 'FAILED' ? value : 'INCOMPLETE'
}

export function normalizeProof(raw: unknown): ProofBundle {
  const item = asRecord(raw)
  const coverage = asRecord(item.coverage)
  const scenarios = Array.isArray(item.scenarios) ? item.scenarios.map(asRecord) : []
  const assertionsTotal = scenarios.reduce((total, scenario) => total + asNumber(scenario.assertionCount), 0)
  const mismatchCount = scenarios.reduce((total, scenario) => total + asNumber(scenario.mismatchCount), 0)

  return {
    id: asString(item.id ?? item.proofId),
    migrationId: asString(item.migrationId),
    status: normalizeVerificationStatus(item.status),
    digest: asString(item.digest),
    generatedAt: asString(item.generatedAt),
    candidateId: asString(item.candidateId ?? asRecord(item.candidate).implementationId) || undefined,
    scenariosPassed: asNumber(item.scenariosPassed ?? coverage.passed),
    scenariosTotal: asNumber(item.scenariosTotal ?? coverage.total, scenarios.length),
    assertionsPassed: asNumber(item.assertionsPassed, assertionsTotal - mismatchCount),
    assertionsTotal: asNumber(item.assertionsTotal, assertionsTotal),
    mismatchCount: asNumber(item.mismatchCount, mismatchCount),
    signature: asString(item.signature) || undefined,
    signerPublicKey: asString(item.signerPublicKey) || undefined,
    artifactId: asString(item.artifactId) || undefined,
    scenarios: scenarios.map((scenario) => ({
      scenarioId: asString(scenario.scenarioId),
      partition: scenario.partition === 'counterexample' || scenario.partition === 'boundary' || scenario.partition === 'held-out'
        ? scenario.partition
        : 'observed',
      status: normalizeVerificationStatus(scenario.status),
      assertionCount: asNumber(scenario.assertionCount),
      mismatchCount: asNumber(scenario.mismatchCount),
    })),
  }
}

function normalizeEvidence(value: unknown): EvidenceRef | undefined {
  const item = asRecord(value)
  const id = asString(item.id)
  if (!id) return undefined
  const validKinds: EvidenceRef['kind'][] = ['dom', 'api', 'database', 'screenshot', 'trace', 'code', 'assertion']
  return {
    id,
    kind: validKinds.includes(item.kind as EvidenceRef['kind']) ? item.kind as EvidenceRef['kind'] : 'trace',
    label: asString(item.label, id),
    detail: asString(item.detail) || undefined,
    digest: asString(item.digest) || undefined,
    artifactId: asString(item.artifactId) || undefined,
  }
}

function normalizeArtifact(raw: unknown): MigrationArtifact | undefined {
  const item = asRecord(raw)
  const id = asString(item.id)
  if (!id) return undefined
  const kinds: ArtifactKind[] = ['contract', 'evidence', 'diff', 'proof', 'source', 'run-log']
  const rawKind = item.kind === 'command-log' ? 'run-log' : item.kind
  return {
    id,
    kind: kinds.includes(rawKind as ArtifactKind) ? rawKind as ArtifactKind : 'evidence',
    label: asString(item.label ?? item.filename, id),
    mediaType: asString(item.mediaType ?? item.mimeType, 'application/octet-stream'),
    downloadUrl: asString(item.downloadUrl ?? item.href),
    digest: asString(item.digest) || undefined,
    sizeBytes: asNumber(item.sizeBytes ?? item.byteLength) || undefined,
    createdAt: asString(item.createdAt) || undefined,
  }
}

function stageEventType(rawType: string, status: unknown): MigrationEventType {
  const knownTypes: MigrationEventType[] = [
    'job.queued', 'job.started', 'job.completed', 'job.failed',
    'stage.started', 'stage.passed', 'stage.failed', 'stage.skipped', 'stage.blocked',
    'evidence.recorded', 'hypothesis.proposed', 'hypothesis.challenged', 'hypothesis.falsified',
    'hypothesis.refined', 'hypothesis.accepted', 'counterexample.proposed', 'counterexample.updated',
    'candidate.updated', 'proof.completed', 'artifact.ready', 'log',
  ]
  if (knownTypes.includes(rawType as MigrationEventType)) return rawType as MigrationEventType
  if (status === 'running') return 'stage.started'
  if (status === 'passed') return 'stage.passed'
  if (status === 'failed') return 'stage.failed'
  if (status === 'skipped') return 'stage.skipped'
  return 'log'
}

export function normalizeMigrationEvent(raw: unknown): MigrationEvent {
  const item = asRecord(raw)
  const rawPayload = asRecord(item.payload)
  const hypothesis = normalizeHypothesis(rawPayload.hypothesis)
  const counterexample = normalizeCounterexample(rawPayload.counterexample)
  const candidate = normalizeCandidate(rawPayload.candidate)
  const evidence = normalizeEvidence(rawPayload.evidence)
  const artifact = normalizeArtifact(rawPayload.artifact)
  const proof = Object.keys(asRecord(rawPayload.proof)).length ? normalizeProof(rawPayload.proof) : undefined
  const payload: MigrationEventPayload = {
    message: asString(rawPayload.message ?? item.detail) || undefined,
    jobStatus: rawPayload.jobStatus ? normalizeJobStatus(rawPayload.jobStatus) : undefined,
    hypothesis,
    counterexample,
    candidate,
    evidence,
    artifact,
    proof,
  }

  return {
    id: asString(item.id, `sequence-${asNumber(item.sequence)}`),
    migrationId: asString(item.migrationId),
    sequence: asNumber(item.sequence),
    type: stageEventType(asString(item.type), item.status),
    occurredAt: asString(item.occurredAt),
    stage: normalizeStage(item.stage),
    payload,
    title: asString(item.title) || undefined,
    detail: asString(item.detail) || undefined,
    actor: asString(item.actor) || undefined,
    origin: item.origin === 'recorded' ? 'recorded' : item.origin === 'live' ? 'live' : undefined,
    digest: asString(item.digest) || undefined,
  }
}

export async function startMigration(executionMode: ExecutionMode): Promise<MigrationJob> {
  return normalizeMigrationJob(await request('/api/migrations', {
    method: 'POST',
    body: JSON.stringify({ executionMode }),
  }))
}

export async function getMigration(id: string): Promise<MigrationJob> {
  return normalizeMigrationJob(await request(`/api/migrations/${encodeURIComponent(id)}`))
}

export async function getMigrationEvents(id: string, after: number): Promise<MigrationEvent[]> {
  const body = await request(
    `/api/migrations/${encodeURIComponent(id)}/events?after=${after}&format=json`,
    { headers: { Accept: 'application/json' } },
  )
  const envelope = asRecord(body)
  const events = Array.isArray(body) ? body : Array.isArray(envelope.events) ? envelope.events : []
  return events.map(normalizeMigrationEvent)
}

export async function getMigrationProof(id: string): Promise<ProofBundle> {
  return normalizeProof(await request(`/api/migrations/${encodeURIComponent(id)}/proof`))
}

export async function getMigrationArtifacts(id: string): Promise<MigrationArtifact[]> {
  const body = await request(`/api/migrations/${encodeURIComponent(id)}/artifacts`)
  const envelope = asRecord(body)
  const artifacts = Array.isArray(body) ? body : Array.isArray(envelope.artifacts) ? envelope.artifacts : []
  return artifacts.map(normalizeArtifact).filter((item): item is MigrationArtifact => Boolean(item))
}

export type MigrationTransport = 'connecting' | 'sse' | 'polling' | 'closed'

export function subscribeToMigration(
  id: string,
  options: {
    after?: number
    onEvent: (event: MigrationEvent) => void
    onTransport: (transport: MigrationTransport) => void
    onError: (error: Error) => void
  },
): () => void {
  let closed = false
  let latestSequence = options.after ?? -1
  let source: EventSource | undefined
  let pollTimer: number | undefined

  const emit = (raw: unknown) => {
    const event = normalizeMigrationEvent(raw)
    latestSequence = Math.max(latestSequence, event.sequence)
    options.onEvent(event)
  }

  const poll = async () => {
    if (closed) return
    try {
      const events = await getMigrationEvents(id, latestSequence)
      events.forEach(emit)
    } catch (error) {
      options.onError(error instanceof Error ? error : new Error('Migration event polling failed.'))
    } finally {
      if (!closed) pollTimer = window.setTimeout(poll, 1500)
    }
  }

  const startPolling = () => {
    source?.close()
    source = undefined
    if (pollTimer !== undefined || closed) return
    options.onTransport('polling')
    void poll()
  }

  options.onTransport('connecting')
  if (typeof EventSource === 'undefined') {
    startPolling()
  } else {
    source = new EventSource(`/api/migrations/${encodeURIComponent(id)}/events?after=${latestSequence}`)
    source.onopen = () => options.onTransport('sse')
    const receive = (message: MessageEvent<string>) => {
      try {
        emit(JSON.parse(message.data) as unknown)
      } catch {
        options.onError(new Error('The migration stream returned an invalid event.'))
      }
    }
    source.onmessage = receive
    source.addEventListener('migration', receive as EventListener)
    source.onerror = startPolling
  }

  return () => {
    closed = true
    source?.close()
    if (pollTimer !== undefined) window.clearTimeout(pollTimer)
    options.onTransport('closed')
  }
}
