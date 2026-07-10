import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

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

  close() {}

  open() {
    this.onopen?.(new Event('open'))
  }

  emit(value: unknown) {
    const event = new MessageEvent<string>('message', { data: JSON.stringify(value) })
    this.onmessage?.(event)
  }
}

function installEventSource() {
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource)
}

function installSuccessfulApi(mode: 'live-ai' | 'recorded-replay' | 'deterministic-only' = 'live-ai') {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
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
    expect(screen.queryByText(/sample success/i)).not.toBeInTheDocument()
  })

  it('offers three mutually explicit execution modes', () => {
    render(<App />)

    expect(screen.getByRole('radio', { name: /Live AI/ })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /Recorded replay/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Deterministic proof/ })).not.toBeChecked()
    expect(screen.getByText(/This mode is not live/)).toBeInTheDocument()
  })

  it('stops a failed live run without silently substituting another mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'MODEL_UNAVAILABLE', message: 'GPT-5.6 is unavailable.' } }, 503),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    await userEvent.click(screen.getByRole('radio', { name: /Live AI/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Start migration' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('GPT-5.6 is unavailable.')
    expect(alert).toHaveTextContent('no recording or deterministic result was substituted')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/migrations')
    expect(screen.getByText('No proof issued')).toBeInTheDocument()
  })

  it('posts recorded-replay explicitly and exposes its original timestamp', async () => {
    const fetchMock = installSuccessfulApi('recorded-replay')
    render(<App />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('radio', { name: /Recorded replay/ }))
    await user.click(screen.getByRole('button', { name: 'Start migration' }))

    expect(await screen.findByText(/This mode is not live|Recorded execution/)).toBeInTheDocument()
    expect(screen.getByText(/Recorded 7\/1[01]\/2026|Recorded 2026/)).toBeInTheDocument()
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
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
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      executionMode: 'deterministic-only',
    })
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
      payload: {
        proof: {
          proofId: 'proof-01',
          migrationId: 'migration-01',
          status: 'PASSED',
          digest: `sha256:${'a'.repeat(64)}`,
          generatedAt: '2026-07-11T01:00:12.000Z',
          scenariosPassed: 1,
          scenariosTotal: 1,
          assertionsPassed: 7,
          assertionsTotal: 7,
          mismatchCount: 0,
          scenarios: [{
            scenarioId: 'high-value-damaged',
            partition: 'counterexample',
            status: 'PASSED',
            assertionCount: 7,
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
    expect(screen.getByText('PASSED')).toBeInTheDocument()
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
