export type ExecutionMode = 'live-ai' | 'recorded-replay' | 'deterministic-only'

export const migrationStages = ['observe', 'infer', 'challenge', 'build', 'verify'] as const

export type MigrationStage = (typeof migrationStages)[number]

export type StageStatus = 'pending' | 'active' | 'passed' | 'failed' | 'skipped' | 'blocked'
export type MigrationJobStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled'

export type StageProgress = {
  stage: MigrationStage
  status: StageStatus
  startedAt?: string
  completedAt?: string
  message?: string
  eventSequence?: number
}

export type EvidenceRef = {
  id: string
  kind: 'dom' | 'api' | 'database' | 'screenshot' | 'trace' | 'code' | 'assertion'
  label: string
  detail?: string
  digest?: string
  artifactId?: string
}

export type HypothesisStatus = 'proposed' | 'challenged' | 'falsified' | 'refined' | 'accepted'

export type BehaviorHypothesis = {
  id: string
  revision: number
  statement: string
  status: HypothesisStatus
  confidence: number
  evidenceIds: string[]
  supersedesId?: string
  falsifiedByCounterexampleId?: string
  createdAt?: string
}

export type CounterexampleStatus = 'proposed' | 'running' | 'confirmed' | 'inconclusive' | 'rejected'

export type Counterexample = {
  id: string
  title: string
  rationale: string
  status: CounterexampleStatus
  scenario: Record<string, unknown>
  expectedDiscrimination?: string
  observedOutcome?: Record<string, unknown>
  evidenceIds: string[]
  targetHypothesisIds: string[]
}

export type CandidateStatus =
  | 'queued'
  | 'building'
  | 'built'
  | 'verifying'
  | 'rejected'
  | 'accepted'
  | 'failed'

export type MigrationCandidate = {
  id: string
  revision: number
  status: CandidateStatus
  summary: string
  createdAt?: string
  modelId?: string
  codexThreadId?: string
  changedFiles: string[]
  diffArtifactId?: string
  rejectedByScenarioIds?: string[]
}

export type VerificationStatus = 'PASSED' | 'FAILED' | 'INCOMPLETE'

export type ModelInvocationProvenance = {
  role: string
  model: string
  threadId?: string
  status?: 'succeeded' | 'failed'
  usage?: {
    totalTokens?: number
  }
}

export type CandidateProvenance = {
  implementationId?: string
  codexThreadId?: string
  baseCommit?: string
  changedFiles?: string[]
  sourceDigest?: string
  diffDigest?: string
}

export type HostVerificationProvenance = {
  testsPassed?: number
  testsTotal?: number
  testsSkipped?: number
  scope?: 'candidate-safe' | 'full-release'
}

export type ScenarioProvenance = {
  source: 'model-proposed' | 'host-derived' | 'host-authored'
  detail?: string
}

export type RuntimeCapabilities = {
  liveAiAvailable: boolean
  gpt56Configured: boolean
  codexConfigured: boolean
  boundary: string
}

export type ProofBundle = {
  id: string
  migrationId: string
  status: VerificationStatus
  digest: string
  generatedAt: string
  candidateId?: string
  scenariosPassed: number
  scenariosTotal: number
  assertionsPassed: number
  assertionsTotal: number
  mismatchCount: number
  modelInvocations?: ModelInvocationProvenance[]
  candidate?: CandidateProvenance
  hostVerification?: HostVerificationProvenance
  scenarios?: Array<{
    scenarioId: string
    partition: 'observed' | 'counterexample' | 'boundary' | 'held-out'
    status: VerificationStatus
    assertionCount: number
    mismatchCount: number
    provenance?: ScenarioProvenance
  }>
  signature?: string
  signerPublicKey?: string
  artifactId?: string
}

export type ArtifactKind = 'contract' | 'evidence' | 'diff' | 'proof' | 'source' | 'run-log'

export type MigrationArtifact = {
  id: string
  kind: ArtifactKind
  label: string
  mediaType: string
  downloadUrl: string
  digest?: string
  sizeBytes?: number
  createdAt?: string
}

export type RecordedReplay = {
  recordedAt: string
  sourceRunId: string
  modelId?: string
  disclosure: string
}

export type MigrationJob = {
  id: string
  executionMode: ExecutionMode
  status: MigrationJobStatus
  createdAt: string
  updatedAt: string
  modelId?: string
  currentStage?: MigrationStage
  replay?: RecordedReplay
  failure?: {
    code: string
    message: string
  }
}

export type MigrationEventType =
  | 'job.queued'
  | 'job.started'
  | 'job.completed'
  | 'job.failed'
  | 'stage.started'
  | 'stage.passed'
  | 'stage.failed'
  | 'stage.skipped'
  | 'stage.blocked'
  | 'evidence.recorded'
  | 'hypothesis.proposed'
  | 'hypothesis.challenged'
  | 'hypothesis.falsified'
  | 'hypothesis.refined'
  | 'hypothesis.accepted'
  | 'counterexample.proposed'
  | 'counterexample.updated'
  | 'candidate.updated'
  | 'proof.completed'
  | 'artifact.ready'
  | 'log'

export type MigrationEventPayload = {
  message?: string
  jobStatus?: MigrationJobStatus
  hypothesis?: BehaviorHypothesis
  counterexample?: Counterexample
  candidate?: MigrationCandidate
  proof?: ProofBundle
  artifact?: MigrationArtifact
  evidence?: EvidenceRef
}

/**
 * The server owns sequence numbers. They are the only ordering and de-duplication
 * key; clients must not infer progress from wall-clock timestamps.
 */
export type MigrationEvent = {
  id: string
  migrationId: string
  sequence: number
  type: MigrationEventType
  occurredAt: string
  stage?: MigrationStage
  payload?: MigrationEventPayload
  title?: string
  detail?: string
  actor?: string
  origin?: 'live' | 'recorded'
  digest?: string
}

export type MigrationState = {
  job?: MigrationJob
  events: MigrationEvent[]
  latestSequence: number
  stages: Record<MigrationStage, StageProgress>
  evidence: EvidenceRef[]
  hypotheses: BehaviorHypothesis[]
  counterexamples: Counterexample[]
  candidates: MigrationCandidate[]
  artifacts: MigrationArtifact[]
  proof?: ProofBundle
}
