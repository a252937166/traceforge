import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App, { ProvenanceStrip } from './App'
import { createMigrationState } from './event-reducer'
import type { MigrationJob, MigrationState } from './migration-types'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function job(
  executionMode: 'live-ai' | 'recorded-replay' | 'deterministic-only' = 'live-ai',
) {
  return {
    id: 'migration-01',
    executionMode,
    status: 'running',
    currentStage: 'observe',
    model: executionMode === 'deterministic-only' ? undefined : 'gpt-5.6-sol',
    recordedAt: executionMode === 'recorded-replay' ? '2026-07-10T18:20:00.000Z' : undefined,
    createdAt: '2026-07-11T01:00:00.000Z',
    startedAt: '2026-07-11T01:00:01.000Z',
  }
}

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly url: string
  closed = false
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  private listeners = new Map<string, EventListener[]>()

  constructor(url: string | URL) {
    this.url = String(url)
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  close() {
    this.closed = true
  }

  open() {
    this.onopen?.(new Event('open'))
  }

  emit(value: unknown) {
    const event = new MessageEvent<string>('migration', { data: JSON.stringify(value) })
    for (const listener of this.listeners.get('migration') ?? []) listener(event)
  }

  fail() {
    this.onerror?.(new Event('error'))
  }
}

function installEventSource() {
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource)
}

function installSuccessfulApi(mode: 'live-ai' | 'recorded-replay' | 'deterministic-only' = 'live-ai') {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/health') {
      return jsonResponse({
        codexConfigured: true,
        codexStatus: { configured: true, truthfulBoundary: 'Codex is configured.' },
        gpt56Status: { configured: true, truthfulBoundary: 'GPT-5.6 is configured.' },
      })
    }
    if (url === '/api/migrations' && init?.method === 'POST') {
      return jsonResponse({ data: job(mode) }, 202)
    }
    if (url.endsWith('/artifacts')) return jsonResponse({ data: { artifacts: [] } })
    if (url.endsWith('/proof')) return jsonResponse({ error: { message: 'Proof pending.' } }, 404)
    if (url === '/api/migrations/migration-01') return jsonResponse({ data: job(mode) })
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function startMigration() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Start migration' }))
  await screen.findByText(/Job migration-01/)
  return user
}

describe('TraceForge Migration Loom', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    installEventSource()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/health') {
        return jsonResponse({
          codexConfigured: true,
          codexStatus: { configured: true, truthfulBoundary: 'Codex is configured.' },
          gpt56Status: { configured: true, truthfulBoundary: 'GPT-5.6 is configured.' },
        })
      }
      throw new Error(`Unexpected request: ${String(input)}`)
    }))
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('starts with five honest stages and no manufactured result', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Modernize undocumented workflows without guessing.' })).toBeInTheDocument()
    const rail = screen.getByRole('list', { name: 'Migration stages' })
    for (const stage of ['observe', 'infer', 'challenge', 'build', 'verify']) {
      expect(within(rail).getByText(stage)).toBeInTheDocument()
    }
    expect(screen.getByText('No result is preloaded.')).toBeInTheDocument()
    expect(screen.getByText('No proof issued')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Server-reported provenance' })).toHaveTextContent('Not reported')
    expect(screen.queryByText(/sample success/i)).not.toBeInTheDocument()
  })

  it('shows a compact server-reported chain of custody without inventing missing fields', () => {
    const replayJob: MigrationJob = {
      id: 'migration_replay_fresh_01',
      executionMode: 'recorded-replay',
      status: 'passed',
      createdAt: '2026-07-11T01:00:00.000Z',
      updatedAt: '2026-07-11T01:01:00.000Z',
      modelId: 'gpt-5.6-sol',
      replay: {
        recordedAt: '2026-07-10T17:30:31.000Z',
        sourceRunId: 'migration_57dcf6ff-c7b0-4842-8a66-a74e08565b7b',
        modelId: 'gpt-5.6-sol',
        disclosure: 'Recorded execution.',
      },
    }
    const state: MigrationState = {
      ...createMigrationState(replayJob),
      candidates: [{
        id: 'candidate-generated-02',
        revision: 2,
        status: 'accepted',
        summary: 'Counterexample-aware replacement workflow',
        modelId: 'gpt-5.6-sol',
        codexThreadId: '019f4d12-9228-78c1-95fc-3a13d8e1919f',
        changedFiles: ['apps/api/src/candidates/generated-return-workflow.ts'],
      }],
      proof: {
        id: 'proof-01',
        migrationId: replayJob.id,
        status: 'PASSED',
        digest: `sha256:${'9c4bf00'.padEnd(64, '0')}`,
        generatedAt: '2026-07-11T01:01:00.000Z',
        scenariosPassed: 6,
        scenariosTotal: 6,
        assertionsPassed: 30,
        assertionsTotal: 30,
        mismatchCount: 0,
        modelInvocations: [23_559, 23_689, 25_769, 46_005].map((totalTokens, index) => ({
          role: index === 0 ? 'trace-archaeologist' : 'counterexample-hunter',
          model: 'gpt-5.6-sol',
          threadId: `thread-${index + 1}`,
          status: 'succeeded',
          usage: { totalTokens },
        })),
        candidate: {
          implementationId: 'replacement.return-workflow.generated-candidate',
          codexThreadId: '019f4d12-9228-78c1-95fc-3a13d8e1919f',
          baseCommit: '899ff7ac5f6151b58129559a1d760177a1243136',
          changedFiles: ['apps/api/src/candidates/generated-return-workflow.ts'],
          sourceDigest: `sha256:${'33dae44'.padEnd(64, '0')}`,
          diffDigest: `sha256:${'71a28fc'.padEnd(64, '0')}`,
        },
        hostVerification: { testsPassed: 37, testsTotal: 37 },
      },
    }

    render(<ProvenanceStrip state={state} mode="recorded-replay" />)
    const strip = screen.getByRole('region', { name: 'Server-reported provenance' })

    expect(within(strip).getByText('4 verified')).toBeInTheDocument()
    expect(within(strip).getByText('119,022 recorded')).toBeInTheDocument()
    expect(within(strip).getByText('4 reported')).toBeInTheDocument()
    expect(within(strip).getByText('37/37')).toBeInTheDocument()
    expect(within(strip).getByText('6/6')).toBeInTheDocument()
    expect(within(strip).getByText('30/30')).toBeInTheDocument()
    expect(within(strip).getByText('sha256:33dae44…')).toHaveAttribute('title', expect.stringMatching(/^sha256:33dae44/))
    expect(within(strip).getByText('sha256:71a28fc…')).toHaveAttribute('title', expect.stringMatching(/^sha256:71a28fc/))
    expect(within(strip).getByText('sha256:9c4bf00…')).toHaveAttribute('title', expect.stringMatching(/^sha256:9c4bf00/))
    expect(within(strip).getByTitle(replayJob.replay!.sourceRunId)).toHaveTextContent('migration_57dcf6ff-c7b')
    expect(within(strip).getByTitle(replayJob.id)).toHaveTextContent('migration_replay_fresh_')
    expect(within(strip).queryByText('Not reported')).not.toBeInTheDocument()
  })

  it('offers three mutually explicit execution modes', () => {
    render(<App />)

    expect(screen.getByRole('radio', { name: /Live AI/ })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /Recorded replay/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Deterministic proof/ })).not.toBeChecked()
    expect(screen.getByText(/This mode is not live/)).toBeInTheDocument()
  })

  it('stops a failed live run without silently substituting another mode', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/health'
      ? jsonResponse({
          codexConfigured: true,
          codexStatus: { configured: true },
          gpt56Status: { configured: true },
        })
      : jsonResponse({ error: { code: 'MODEL_UNAVAILABLE', message: 'GPT-5.6 is unavailable.' } }, 503))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    await userEvent.click(screen.getByRole('radio', { name: /Live AI/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Start migration' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('GPT-5.6 is unavailable.')
    expect(alert).toHaveTextContent('no recording or deterministic result was substituted')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/migrations')).toBe(true)
    expect(screen.getByText('No proof issued')).toBeInTheDocument()
  })

  it('disables Live AI when the deployment health says either adapter is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      codexConfigured: false,
      codexStatus: { configured: false, truthfulBoundary: 'Codex execution is disabled.' },
      gpt56Status: { configured: false, truthfulBoundary: 'GPT-5.6 archaeology is disabled.' },
    })))
    render(<App />)

    const live = screen.getByRole('radio', { name: /Live AI/ })
    await waitFor(() => expect(live).toBeDisabled())
    expect(screen.getByText('Unavailable on this deployment')).toBeInTheDocument()
    expect(live.closest('label')).toHaveAttribute('title', expect.stringContaining('Codex execution is disabled.'))
  })

  it('posts recorded-replay explicitly and exposes its original timestamp', async () => {
    const fetchMock = installSuccessfulApi('recorded-replay')
    render(<App />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('radio', { name: /Recorded replay/ }))
    await user.click(screen.getByRole('button', { name: 'Start migration' }))

    expect(await screen.findByText(/This mode is not live|Recorded execution/)).toBeInTheDocument()
    expect(screen.getByText(/Recorded 7\/1[01]\/2026|Recorded 2026/)).toBeInTheDocument()
    const migrationRequest = fetchMock.mock.calls.find(([input]) => String(input) === '/api/migrations')
    expect(JSON.parse(String(migrationRequest?.[1]?.body))).toEqual({
      executionMode: 'recorded-replay',
    })
  })

  it('labels deterministic-only as no model and sends that exact mode', async () => {
    const fetchMock = installSuccessfulApi('deterministic-only')
    render(<App />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('radio', { name: /Deterministic proof/ }))
    await user.click(screen.getByRole('button', { name: 'Start migration' }))

    expect(await screen.findByText(/Job migration-01/)).toBeInTheDocument()
    expect(screen.getAllByText('No model').length).toBeGreaterThan(0)
    expect(screen.getByText(/No GPT or Codex execution is claimed/)).toBeInTheDocument()
    const migrationRequest = fetchMock.mock.calls.find(([input]) => String(input) === '/api/migrations')
    expect(JSON.parse(String(migrationRequest?.[1]?.body))).toEqual({
      executionMode: 'deterministic-only',
    })
  })

  it('renders named migration events incrementally and never polls after a healthy terminal event', async () => {
    const fetchMock = installSuccessfulApi('recorded-replay')
    render(<App />)
    await startMigration()

    const source = FakeEventSource.instances[0]
    source?.open()
    expect(await screen.findByText('sse')).toBeInTheDocument()

    source?.emit({
      id: 'evt-infer-started',
      migrationId: 'migration-01',
      sequence: 5,
      type: 'stage.started',
      stage: 'infer',
      occurredAt: '2026-07-11T01:00:05.000Z',
      payload: { message: 'Infer started.' },
    })
    const inferStage = within(screen.getByRole('list', { name: 'Migration stages' })).getByText('infer').closest('li')
    await waitFor(() => expect(inferStage).toHaveClass('stage-active'))

    source?.emit({
      id: 'evt-hypothesis',
      migrationId: 'migration-01',
      sequence: 6,
      type: 'hypothesis.proposed',
      stage: 'infer',
      occurredAt: '2026-07-11T01:00:06.000Z',
      payload: {
        hypothesis: {
          id: 'hypothesis-incremental',
          revision: 1,
          statement: 'The browser received this rule before completion.',
          status: 'proposed',
          confidence: 0.7,
          evidenceIds: ['evidence-observed'],
        },
      },
    })
    expect(await screen.findByText('The browser received this rule before completion.')).toBeInTheDocument()

    source?.emit({
      id: 'evt-completed',
      migrationId: 'migration-01',
      sequence: 7,
      type: 'job.completed',
      stage: 'verify',
      occurredAt: '2026-07-11T01:00:07.000Z',
      payload: { jobStatus: 'passed' },
    })
    source?.fail()

    await waitFor(() => expect(source?.closed).toBe(true))
    expect(screen.queryByText('polling')).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes('/events?') && String(input).includes('format=json')),
    ).toBe(false)
  })

  it('renders hypotheses, falsification, suite results, and artifacts only from server events', async () => {
    installSuccessfulApi()
    render(<App />)
    await startMigration()

    const source = FakeEventSource.instances[0]
    expect(source?.url).toContain('/api/migrations/migration-01/events')
    source?.emit({
      id: 'evt-7',
      migrationId: 'migration-01',
      sequence: 7,
      type: 'hypothesis.falsified',
      stage: 'challenge',
      status: 'passed',
      occurredAt: '2026-07-11T01:00:07.000Z',
      title: 'Counterexample falsified broad rule',
      detail: 'The hidden high-value branch leaves inventory unchanged.',
      actor: 'gpt-5.6-counterexample-hunter',
      origin: 'live',
      digest: `sha256:${'7'.repeat(64)}`,
      payload: {
        hypothesis: {
          id: 'hypothesis-damaged',
          revision: 1,
          statement: 'Every damaged return enters quarantine.',
          status: 'falsified',
          confidence: 0,
          evidenceIds: ['evidence-observed', 'evidence-high-value'],
          falsifiedByCounterexampleId: 'counterexample-high-value',
        },
        counterexample: {
          id: 'counterexample-high-value',
          title: 'High-value damaged return',
          rationale: 'Separates automatic disposition from manual review.',
          status: 'confirmed',
          scenario: { amount: 750, customer: 'STANDARD', initialInventory: { sellable: 10, quarantine: 0 } },
          evidenceIds: ['evidence-high-value'],
          targetHypothesisIds: ['hypothesis-damaged'],
        },
      },
    })
    source?.emit({
      id: 'evt-12',
      migrationId: 'migration-01',
      sequence: 12,
      type: 'proof.completed',
      stage: 'verify',
      status: 'passed',
      occurredAt: '2026-07-11T01:00:12.000Z',
      detail: 'Host replay includes a held-out priority check.',
      payload: {
        proof: {
          proofId: 'proof-01',
          migrationId: 'migration-01',
          status: 'PASSED',
          digest: `sha256:${'a'.repeat(64)}`,
          generatedAt: '2026-07-11T01:00:12.000Z',
          scenariosPassed: 2,
          scenariosTotal: 2,
          assertionsPassed: 12,
          assertionsTotal: 12,
          mismatchCount: 0,
          scenarios: [{
            scenarioId: 'high-value-damaged',
            partition: 'counterexample',
            status: 'PASSED',
            assertionCount: 7,
            mismatchCount: 0,
          }, {
            scenarioId: 'vip-boundary-priority',
            partition: 'held-out',
            status: 'PASSED',
            assertionCount: 5,
            mismatchCount: 0,
          }],
        },
        artifact: {
          id: 'artifact-proof',
          kind: 'proof',
          filename: 'proof.json',
          mimeType: 'application/json',
          href: '/api/migrations/migration-01/downloads/proof.json',
          byteLength: 2048,
        },
      },
    })

    expect(await screen.findByText('Every damaged return enters quarantine.')).toBeInTheDocument()
    expect(screen.getByText('High-value damaged return')).toBeInTheDocument()
    expect(screen.getByText('sellable 10 · quarantine 0')).toBeInTheDocument()
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
    expect(screen.getByText('high-value-damaged')).toBeInTheDocument()
    expect(screen.getByText('host verification')).toBeInTheDocument()
    expect(screen.getByText('verification-only')).toBeInTheDocument()
    expect(screen.getByText('Host replay includes a verification-only priority check.')).toBeInTheDocument()
    expect(screen.getByText(/Model authorship is claimed only when the server reports it/)).toBeInTheDocument()
    expect(screen.queryByText('held-out')).not.toBeInTheDocument()
    expect(screen.getAllByText('PASSED')).toHaveLength(2)
    expect(screen.getByRole('link', { name: /proof.json/ })).toHaveAttribute(
      'href',
      '/api/migrations/migration-01/downloads/proof.json',
    )
  })

  it('opens the evidence dialog from an actual streamed event', async () => {
    installSuccessfulApi()
    render(<App />)
    const user = await startMigration()
    const source = FakeEventSource.instances[0]
    source?.emit({
      id: 'evt-1',
      migrationId: 'migration-01',
      sequence: 1,
      type: 'stage.started',
      stage: 'observe',
      status: 'running',
      occurredAt: '2026-07-11T01:00:01.000Z',
      title: 'Legacy trace started',
      detail: 'Capturing source behavior.',
      actor: 'legacy-runner',
      origin: 'live',
      digest: `sha256:${'1'.repeat(64)}`,
      payload: {},
    })

    await user.click(await screen.findByRole('button', { name: /Legacy trace started/ }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('legacy-runner')
    expect(dialog).toHaveTextContent(`sha256:${'1'.repeat(64)}`)
    await user.click(within(dialog).getByRole('button', { name: 'Close evidence drawer' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
