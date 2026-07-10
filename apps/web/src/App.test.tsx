import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

function demoRun(
  candidateVersion: 'buggy' | 'fixed' | 'generated',
  options: { runId?: string; proofId?: string } = {},
) {
  const failed = candidateVersion === 'buggy'
  const digestCharacter = candidateVersion === 'buggy' ? 'a' : candidateVersion === 'fixed' ? 'b' : 'c'
  return {
    runId: options.runId ?? `run_${candidateVersion}`,
    status: failed ? 'FAILED' : 'PASSED',
    source: 'deterministic-local-demo',
    events: [
      {
        type: 'legacy.input.captured',
        title: 'Workflow input captured',
        detail: 'RET-1001 · STANDARD · DAMAGED · 4500 cents',
        evidenceId: `ev_${candidateVersion}_001`,
        digest: `sha256:${candidateVersion}001`,
      },
      {
        type: failed ? 'verifier.mismatch' : 'replacement.state.after',
        title: failed ? 'Mismatch: inventory.sellable' : 'Inventory snapshot after',
        detail: failed ? 'candidate produced 11' : '10 sellable, 1 quarantined',
        evidenceId: `ev_${candidateVersion}_002`,
        digest: `sha256:${candidateVersion}002`,
      },
    ],
    rules: [
      {
        ruleId: 'RULE-DAMAGED-DISPOSITION',
        statement: 'Damaged items enter quarantine.',
        confidence: 1,
        evidenceIds: [`ev_${candidateVersion}_002`],
      },
    ],
    proofs: [
      { proofId: 'a1', status: 'PASSED' },
      { proofId: 'a2', status: failed ? 'FAILED' : 'PASSED' },
    ],
    proofBundle: {
      proofId: options.proofId ?? `proof_${candidateVersion}`,
      runId: options.runId ?? `run_${candidateVersion}`,
      candidateVersion,
      generatedAt: '2026-07-10T10:00:00.000Z',
      status: failed ? 'FAILED' : 'PASSED',
      assertions: [{ status: 'PASSED' }, { status: failed ? 'FAILED' : 'PASSED' }],
      mismatches: failed ? [{ path: 'inventory.sellable' }] : [],
      digest: `sha256:${digestCharacter.repeat(64)}`,
    },
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function successfulCodexResponse(generatedRun: ReturnType<typeof demoRun>) {
  return {
    data: {
      codexExecuted: true,
      threadId: 'thread_abcdef1234567890',
      usage: { inputTokens: 1200, outputTokens: 220 },
      changedFiles: ['apps/api/src/candidates/generated-repair.ts'],
      diff: [
        '--- a/generated-repair.ts',
        '+++ b/generated-repair.ts',
        '-  damagedBucket: "sellable"',
        '+  damagedBucket: "quarantine"',
      ].join('\n'),
      structuredOutput: { summary: 'Repair damaged disposition.' },
      verification: {
        status: 'PASSED',
        whitelist: {
          passed: true,
          allowed: ['apps/api/src/candidates/generated-repair.ts'],
          changed: ['apps/api/src/candidates/generated-repair.ts'],
          unexpected: [],
          requiredFileChanged: true,
        },
        run: generatedRun,
      },
      worktree: { path: '/tmp/worktree', retained: true },
    },
  }
}

async function startProof() {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: 'Run proof' }))
}

describe('TraceForge workbench', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('presents the migration as four proof stages and three persistent system states', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Damaged returns modernization' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Migration proof summary' })).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Original application playback' })).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Replacement application playback' })).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Repaired application playback' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Proof ledger' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('does not call repair or seal when the demo runner is offline', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('API offline'))
    vi.stubGlobal('fetch', fetchMock)

    await startProof()

    expect(await screen.findByText('Sample data')).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', {
        name: 'Sample replay complete — start live runner to seal proof',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Proof sealed' })).not.toBeInTheDocument()
    expect(screen.queryByText('Covered behavior conforms')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Run proof again' })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/demo/run')
  })

  it('falls back to the labelled reference patch only when Codex returns 501', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(demoRun('buggy', { proofId: 'proof_failed_501' }), 201))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'CODEX_ADAPTER_NOT_CONFIGURED', message: 'Codex is disabled.' } },
          501,
        ),
      )
      .mockResolvedValueOnce(jsonResponse(demoRun('fixed', { runId: 'run_reference_fresh' }), 201))
    vi.stubGlobal('fetch', fetchMock)

    await startProof()

    expect(await screen.findByRole('heading', { name: 'Proof sealed' })).toBeInTheDocument()
    expect(screen.getByText(/REFERENCE PATCH/)).toBeInTheDocument()
    expect(screen.queryByText(/CODEX EXECUTED/)).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Run proof again' })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('/api/adapters/codex/repair')
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      proofId: 'proof_failed_501',
    })
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      candidateVersion: 'fixed',
    })
  })

  it('seals only the fresh generated run returned by successful Codex verification', async () => {
    const generatedRun = demoRun('generated', {
      runId: 'run_generated_fresh',
      proofId: 'proof_generated_fresh',
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(demoRun('buggy', { proofId: 'proof_failed_codex' }), 201))
      .mockResolvedValueOnce(jsonResponse(successfulCodexResponse(generatedRun)))
    vi.stubGlobal('fetch', fetchMock)

    await startProof()

    expect(await screen.findByRole('heading', { name: 'Proof sealed' })).toBeInTheDocument()
    expect(screen.getByText(/CODEX EXECUTED/)).toHaveTextContent('THREAD abcdef1234')
    expect(screen.getByText('damagedBucket: "sellable"')).toBeInTheDocument()
    expect(screen.getByText('damagedBucket: "quarantine"')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    expect(within(screen.getByRole('article', { name: 'Replacement application playback' })).getByText('11')).toBeInTheDocument()
    expect(
      within(screen.getByRole('article', { name: 'Repaired application playback' }))
        .getByText('10', { selector: 'strong' }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Run proof again' })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/REFERENCE PATCH/)).not.toBeInTheDocument()
  })

  it('stops unresolved on a Codex SDK 502 without using the reference candidate', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(demoRun('buggy', { proofId: 'proof_failed_502' }), 201))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'CODEX_REPAIR_FAILED',
              message: 'Codex SDK turn failed before verification.',
              evidence: {
                codexExecuted: false,
                threadId: 'thread_deadbeef001122',
                changedFiles: [],
                diff: '',
              },
            },
          },
          502,
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await startProof()

    expect(await screen.findByRole('heading', { name: 'Repair could not complete' })).toBeInTheDocument()
    expect(screen.getByText('Codex SDK turn failed before verification.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Proof sealed' })).not.toBeInTheDocument()
    expect(screen.queryByText(/REFERENCE PATCH/)).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Run proof again' })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects a malformed Codex 200 instead of manufacturing a passing proof from defaults', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(demoRun('buggy', { proofId: 'proof_failed_malformed' }), 201))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            codexExecuted: true,
            threadId: 'thread_incomplete',
            verification: { status: 'PASSED', run: { status: 'PASSED' } },
          },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await startProof()

    expect(await screen.findByRole('heading', { name: 'Codex candidate did not pass verification' })).toBeInTheDocument()
    expect(screen.getByText(/failed integrity validation/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Proof sealed' })).not.toBeInTheDocument()
    expect(screen.queryByText(/REFERENCE PATCH/)).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps a 422 Codex verification failure unresolved and never loads the reference patch', async () => {
    const generated = demoRun('generated', {
      runId: 'run_generated_failed',
      proofId: 'proof_generated_failed',
    })
    const failedGeneratedRun = {
      ...generated,
      status: 'FAILED',
      proofBundle: {
        ...generated.proofBundle,
        status: 'FAILED',
        mismatches: [{ path: 'inventory.quarantine' }],
      },
    }
    const repairFailure = successfulCodexResponse(failedGeneratedRun)
    repairFailure.data.verification.status = 'FAILED'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(demoRun('buggy', { proofId: 'proof_failed_422' }), 201))
      .mockResolvedValueOnce(jsonResponse(repairFailure, 422))
    vi.stubGlobal('fetch', fetchMock)

    await startProof()

    expect(await screen.findByRole('heading', { name: 'Codex candidate did not pass verification' })).toBeInTheDocument()
    expect(screen.getByText(/CODEX FAILED/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Proof sealed' })).not.toBeInTheDocument()
    expect(screen.queryByText(/REFERENCE PATCH/)).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects an otherwise valid Codex response that reuses the failed source proof ID', async () => {
    const sourceProofId = 'proof_reused'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(demoRun('buggy', { proofId: sourceProofId }), 201))
      .mockResolvedValueOnce(
        jsonResponse(
          successfulCodexResponse(
            demoRun('generated', { runId: 'run_generated_new', proofId: sourceProofId }),
          ),
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await startProof()

    expect(await screen.findByRole('heading', { name: 'Codex candidate did not pass verification' })).toBeInTheDocument()
    expect(screen.getByText(/reused the failed source proofId/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Proof sealed' })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not seal a malformed fixed response after the explicit 501 fallback', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(demoRun('buggy', { proofId: 'proof_failed_bad_ref' }), 201))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'CODEX_ADAPTER_NOT_CONFIGURED', message: 'Codex is disabled.' } },
          501,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'PASSED' }))
    vi.stubGlobal('fetch', fetchMock)

    await startProof()

    expect(await screen.findByRole('heading', { name: 'Sample replay complete — start live runner to seal proof' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Proof sealed' })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
