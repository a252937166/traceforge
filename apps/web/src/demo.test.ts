import { describe, expect, it } from 'vitest'
import { normalizeLiveRun } from './demo'

describe('normalizeLiveRun', () => {
  it('preserves proof counts and only credits Codex when execution is explicit', () => {
    const result = normalizeLiveRun({
      data: {
        runId: 'LIVE-001',
        codexExecuted: true,
        patch: { id: 'CF-099' },
        stats: {
          scenariosPassed: 3,
          scenariosTotal: 4,
          assertions: 9,
          differences: 1,
        },
      },
    })

    expect(result.runId).toBe('LIVE-001')
    expect(result.source).toBe('live')
    expect(result.codexExecuted).toBe(true)
    expect(result.patchId).toBe('CF-099')
    expect(result.stats).toEqual({
      scenariosPassed: 3,
      scenariosTotal: 4,
      assertions: 9,
      differences: 1,
    })
  })

  it('does not infer Codex execution from a generic patch', () => {
    const result = normalizeLiveRun({ patch: { id: 'PATCH-01' } })

    expect(result.codexExecuted).toBe(false)
  })

  it('derives failed proof counts and real evidence IDs from the API response shape', () => {
    const result = normalizeLiveRun({
      runId: 'run_backend_01',
      status: 'FAILED',
      source: 'deterministic-local-demo',
      events: [
        {
          type: 'legacy.state.after',
          title: 'Inventory state recorded',
          detail: 'sellable 10→10 · quarantine 0→1',
          evidenceId: 'ev_trace_real_09',
          digest: 'sha256:1234567890abcdef',
        },
      ],
      rules: [
        {
          ruleId: 'RULE-DAMAGED-DISPOSITION',
          statement: 'Damaged items enter quarantine.',
          confidence: 1,
          evidenceIds: ['ev_trace_real_09'],
        },
      ],
      proofs: [
        { proofId: 'a1', status: 'PASSED' },
        { proofId: 'a2', status: 'FAILED' },
        { proofId: 'a3', status: 'FAILED' },
      ],
      proofBundle: {
        candidateVersion: 'buggy',
        generatedAt: '2026-07-10T10:00:00.000Z',
        assertions: [{ status: 'PASSED' }, { status: 'FAILED' }, { status: 'FAILED' }],
        mismatches: [{ path: 'inventory.sellable' }, { path: 'inventory.quarantine' }],
      },
    })

    expect(result.status).toBe('FAILED')
    expect(result.candidateVersion).toBe('buggy')
    expect(result.stats).toEqual({
      scenariosPassed: 0,
      scenariosTotal: 1,
      assertions: 3,
      differences: 2,
    })
    expect(result.evidence[0]).toMatchObject({
      id: 'ev_trace_real_09',
      digest: 'sha256:1234567890abcdef',
    })
    expect(result.rules[0]?.evidenceIds).toEqual(['ev_trace_real_09'])
  })
})
