import {
  migrationStages,
  type BehaviorHypothesis,
  type Counterexample,
  type MigrationArtifact,
  type MigrationCandidate,
  type MigrationEvent,
  type MigrationJob,
  type MigrationStage,
  type MigrationState,
  type StageProgress,
  type StageStatus,
} from './migration-types'

function initialStages(): Record<MigrationStage, StageProgress> {
  return Object.fromEntries(
    migrationStages.map((stage) => [stage, { stage, status: 'pending' as const }]),
  ) as Record<MigrationStage, StageProgress>
}

export function createMigrationState(job?: MigrationJob): MigrationState {
  return {
    job,
    events: [],
    latestSequence: -1,
    stages: initialStages(),
    evidence: [],
    hypotheses: [],
    counterexamples: [],
    candidates: [],
    artifacts: [],
  }
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((entry) => entry.id === item.id)
  if (index === -1) return [...items, item]
  return items.map((entry, itemIndex) => (itemIndex === index ? item : entry))
}

function upsertHypothesis(items: BehaviorHypothesis[], item: BehaviorHypothesis): BehaviorHypothesis[] {
  return upsertById(items, item).sort((left, right) => {
    if (left.revision !== right.revision) return left.revision - right.revision
    return left.id.localeCompare(right.id)
  })
}

function upsertCounterexample(items: Counterexample[], item: Counterexample): Counterexample[] {
  return upsertById(items, item)
}

function upsertCandidate(items: MigrationCandidate[], item: MigrationCandidate): MigrationCandidate[] {
  return upsertById(items, item).sort((left, right) => left.revision - right.revision)
}

function upsertArtifact(items: MigrationArtifact[], item: MigrationArtifact): MigrationArtifact[] {
  return upsertById(items, item)
}

function stageStatusFor(event: MigrationEvent): StageStatus | undefined {
  switch (event.type) {
    case 'stage.started':
      return 'active'
    case 'stage.passed':
      return 'passed'
    case 'stage.failed':
      return 'failed'
    case 'stage.skipped':
      return 'skipped'
    case 'stage.blocked':
      return 'blocked'
    default:
      return undefined
  }
}

function applyEvent(state: MigrationState, event: MigrationEvent): MigrationState {
  let next = state
  const stageStatus = stageStatusFor(event)

  if (event.stage && stageStatus) {
    const previous = next.stages[event.stage]
    next = {
      ...next,
      stages: {
        ...next.stages,
        [event.stage]: {
          ...previous,
          status: stageStatus,
          startedAt:
            stageStatus === 'active' ? event.occurredAt : previous.startedAt,
          completedAt:
            stageStatus === 'active' ? undefined : event.occurredAt,
          message: event.payload?.message,
          eventSequence: event.sequence,
        },
      },
    }
  }

  const payload = event.payload
  if (!payload) return next

  if (payload.evidence) next = { ...next, evidence: upsertById(next.evidence, payload.evidence) }
  if (payload.hypothesis) {
    next = { ...next, hypotheses: upsertHypothesis(next.hypotheses, payload.hypothesis) }
  }
  if (payload.counterexample) {
    next = {
      ...next,
      counterexamples: upsertCounterexample(next.counterexamples, payload.counterexample),
    }
  }
  if (payload.candidate) {
    next = { ...next, candidates: upsertCandidate(next.candidates, payload.candidate) }
  }
  if (payload.artifact) {
    next = { ...next, artifacts: upsertArtifact(next.artifacts, payload.artifact) }
  }
  if (payload.proof) next = { ...next, proof: payload.proof }
  if (payload.jobStatus && next.job) {
    next = {
      ...next,
      job: { ...next.job, status: payload.jobStatus, updatedAt: event.occurredAt },
    }
  }

  return next
}

function rebuild(job: MigrationJob | undefined, events: MigrationEvent[]): MigrationState {
  const derived = events.reduce(applyEvent, createMigrationState(job))
  return {
    ...derived,
    events,
    latestSequence: events.at(-1)?.sequence ?? -1,
  }
}

/**
 * Adds one server event. Replayed SSE messages are ignored by sequence and
 * out-of-order arrivals trigger a deterministic rebuild in server order.
 */
export function reduceMigrationEvent(state: MigrationState, event: MigrationEvent): MigrationState {
  if (state.events.some((existing) => existing.sequence === event.sequence)) return state

  const events = [...state.events, event].sort((left, right) => left.sequence - right.sequence)
  return rebuild(state.job, events)
}

export function reduceMigrationEvents(
  state: MigrationState,
  events: readonly MigrationEvent[],
): MigrationState {
  return events.reduce(reduceMigrationEvent, state)
}
