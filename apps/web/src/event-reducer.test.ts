import { describe, expect, it } from 'vitest'
import { createMigrationState, reduceMigrationEvent, reduceMigrationEvents } from './event-reducer'
import type { MigrationEvent, MigrationJob } from './migration-types'

const job: MigrationJob = {
  id: 'migration-01',
  executionMode: 'live-ai',
  status: 'running',
  createdAt: '2026-07-11T01:00:00.000Z',
  updatedAt: '2026-07-11T01:00:00.000Z',
  modelId: 'gpt-5.6',
}

function event(
  sequence: number,
  type: MigrationEvent['type'],
  stage?: MigrationEvent['stage'],
): MigrationEvent {
  return {
    id: `event-${sequence}`,
    migrationId: job.id,
    sequence,
    type,
    stage,
    occurredAt: `2026-07-11T01:00:${String(sequence).padStart(2, '0')}.000Z`,
  }
}

describe('migration event reducer', () => {
  it('sorts out-of-order server events and ignores a replayed sequence', () => {
    const started = event(10, 'stage.started', 'observe')
    const passed = event(11, 'stage.passed', 'observe')
    const state = reduceMigrationEvents(createMigrationState(job), [passed, started, passed])

    expect(state.events.map(({ sequence }) => sequence)).toEqual([10, 11])
    expect(state.latestSequence).toBe(11)
    expect(state.stages.observe.status).toBe('passed')

    const duplicate = reduceMigrationEvent(state, { ...passed, id: 'event-replayed' })
    expect(duplicate).toBe(state)
  })

  it('never credits a skipped stage as passed', () => {
    const state = reduceMigrationEvents(createMigrationState(job), [
      event(1, 'stage.passed', 'observe'),
      event(2, 'stage.skipped', 'infer'),
      event(3, 'stage.started', 'verify'),
    ])

    expect(state.stages.observe.status).toBe('passed')
    expect(state.stages.infer.status).toBe('skipped')
    expect(state.stages.verify.status).toBe('active')
    expect(Object.values(state.stages).filter(({ status }) => status === 'passed')).toHaveLength(1)
  })

  it('derives domain objects and proof only from event payloads', () => {
    const state = reduceMigrationEvents(createMigrationState(job), [
      {
        ...event(1, 'hypothesis.proposed', 'infer'),
        payload: {
          hypothesis: {
            id: 'hypothesis-damaged',
            revision: 1,
            statement: 'All damaged returns enter quarantine.',
            status: 'proposed',
            confidence: 0.68,
            evidenceIds: ['evidence-01'],
          },
        },
      },
      {
        ...event(2, 'hypothesis.falsified', 'challenge'),
        payload: {
          hypothesis: {
            id: 'hypothesis-damaged',
            revision: 1,
            statement: 'All damaged returns enter quarantine.',
            status: 'falsified',
            confidence: 0,
            evidenceIds: ['evidence-01', 'evidence-02'],
            falsifiedByCounterexampleId: 'counterexample-high-value',
          },
        },
      },
      {
        ...event(3, 'proof.completed', 'verify'),
        payload: {
          proof: {
            id: 'proof-01',
            migrationId: job.id,
            status: 'PASSED',
            digest: `sha256:${'a'.repeat(64)}`,
            generatedAt: '2026-07-11T01:01:00.000Z',
            candidateId: 'candidate-02',
            scenariosPassed: 3,
            scenariosTotal: 3,
            assertionsPassed: 21,
            assertionsTotal: 21,
            mismatchCount: 0,
          },
        },
      },
    ])

    expect(state.hypotheses).toHaveLength(1)
    expect(state.hypotheses[0]).toMatchObject({
      status: 'falsified',
      falsifiedByCounterexampleId: 'counterexample-high-value',
    })
    expect(state.proof).toMatchObject({ status: 'PASSED', scenariosPassed: 3 })
  })
})
