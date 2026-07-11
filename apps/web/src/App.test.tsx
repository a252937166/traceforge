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
        release: {
          sha: 'de748868292639c57abea7b8d53e933987bea03e',
          version: 'local-runner-v0.1.5',
          builtAt: '2026-07-11T14:30:00.000Z',
        },
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
  await user.click(screen.getByRole('button', { name: 'Run the verified migration' }))
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
          release: {
            sha: 'de748868292639c57abea7b8d53e933987bea03e',
            version: 'local-runner-v0.1.5',
            builtAt: '2026-07-11T14:30:00.000Z',
          },
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
    expect(screen.getByText('No sign-in · server-paced SSE · fresh proof bundle')).toBeInTheDocument()
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
        recordedAt: '2026-07-11T06:25:27.754Z',
        sourceRunId: 'migration_77f7a45d-a07f-43c6-a0bd-cf4555ed7996',
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
        codexThreadId: '019f4fd8-5408-7752-b8fa-f8c6b08b33ef',
        changedFiles: ['apps/api/src/candidates/generated-return-workflow.ts'],
      }],
      proof: {
        id: 'proof-01',
        migrationId: replayJob.id,
        status: 'PASSED',
        digest: `sha256:${'4ff6eba'.padEnd(64, '0')}`,
        generatedAt: '2026-07-11T01:01:00.000Z',
        scenariosPassed: 6,
        scenariosTotal: 6,
        assertionsPassed: 30,
        assertionsTotal: 30,
        mismatchCount: 0,
        modelInvocations: [22_936, 22_483, 24_193, 45_953].map((totalTokens, index) => ({
          role: index === 0 ? 'trace-archaeologist' : 'counterexample-hunter',
          model: 'gpt-5.6-sol',
          threadId: `thread-${index + 1}`,
          status: 'succeeded',
          usage: { totalTokens },
        })),
        candidate: {
          implementationId: 'replacement.return-workflow.generated-candidate',
          codexThreadId: '019f4fd8-5408-7752-b8fa-f8c6b08b33ef',
          baseCommit: '7c1dceeaee7f375beb8d2895fda502f2ad74e039',
          changedFiles: ['apps/api/src/candidates/generated-return-workflow.ts'],
          sourceDigest: `sha256:${'b890c0d'.padEnd(64, '0')}`,
          diffDigest: `sha256:${'99d556c'.padEnd(64, '0')}`,
        },
        hostVerification: { testsPassed: 42, testsTotal: 42, testsSkipped: 4, scope: 'candidate-safe' },
      },
    }

    render(<ProvenanceStrip state={state} mode="recorded-replay" />)
    const strip = screen.getByRole('region', { name: 'Server-reported provenance' })

    expect(within(strip).getByText('4 verified')).toBeInTheDocument()
    expect(within(strip).getByText('115,565 recorded')).toBeInTheDocument()
    expect(within(strip).getByText('4 reported')).toBeInTheDocument()
    expect(within(strip).getByText('42/42 · 4 replay-only')).toBeInTheDocument()
    expect(within(strip).getByText('6/6')).toBeInTheDocument()
    expect(within(strip).getByText('30/30')).toBeInTheDocument()
    expect(within(strip).getByText('sha256:b890c0d…')).toHaveAttribute('title', expect.stringMatching(/^sha256:b890c0d/))
    expect(within(strip).getByText('sha256:99d556c…')).toHaveAttribute('title', expect.stringMatching(/^sha256:99d556c/))
    expect(within(strip).getByText('sha256:4ff6eba…')).toHaveAttribute('title', expect.stringMatching(/^sha256:4ff6eba/))
    expect(within(strip).getByTitle(replayJob.replay!.sourceRunId)).toHaveTextContent('migration_77f7a45d-a07f')
    expect(within(strip).getByTitle(replayJob.id)).toHaveTextContent('migration_replay_fresh_')
    expect(within(strip).queryByText('Not reported')).not.toBeInTheDocument()
  })

  it('keeps replay as the default, offers local Codex, and identifies the deployment', async () => {
    render(<App />)

    expect(screen.getByRole('radio', { name: /Replay a verified run/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Host-only proof/ })).not.toBeChecked()
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual([
      'recorded-replay',
      'deterministic-only',
    ])
    expect(screen.queryByRole('radio', { name: /New live AI run/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Build live with my Codex/i })).toBeEnabled()
    expect(screen.getByText('Recorded GPT-5.6 · local Codex · fresh local proof')).toBeInTheDocument()
    expect(screen.getByText(/No model call is claimed during replay/)).toBeInTheDocument()
    expect(screen.getByText('No sign-in · server-paced SSE · fresh proof bundle')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run the verified migration' })).toBeEnabled()
    expect(screen.getByRole('link', { name: /Inspect the authenticated live-run evidence/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/docs/evidence/live-champion-run'),
    )
    expect(await screen.findByText('Release de74886 · Local Runner v0.1.5')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo', { name: 'Deployed release identity' })).toHaveTextContent('Built')
  })

  it('opens a truthful pinned Local Runner launcher and keeps replay available', async () => {
    render(<App />)
    const user = userEvent.setup()
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText')

    await user.click(screen.getByRole('radio', { name: /Host-only proof/ }))
    await user.click(screen.getByRole('button', { name: /Build live with my Codex/i }))

    const dialog = screen.getByRole('dialog', { name: 'Build live with your local Codex.' })
    expect(document.documentElement).toHaveClass('runner-modal-open')
    expect(dialog).toHaveTextContent('The public page cannot start or inspect a local process.')
    expect(dialog).toHaveTextContent('Authentication stays local.')
    expect(dialog).toHaveTextContent('This public page cannot read tokens, local files, Codex history, generated source, or proof contents.')
    expect(within(dialog).getByText('Recorded GPT-5.6 evidence')).toBeInTheDocument()
    expect(within(dialog).getByText('Local Codex · live')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Digest-verified contract + failed proofs')
    expect(dialog).toHaveTextContent('one incomplete candidate')
    expect(dialog).toHaveTextContent('temporary writer workspace')
    expect(dialog).toHaveTextContent('Requires Git, Node.js 22+, Corepack, Codex CLI 0.144.1, and access to gpt-5.6-sol.')
    expect(dialog).toHaveTextContent('Verified on macOS / Linux')
    expect(dialog).toHaveTextContent('Windows is not supported by this release.')
    expect(dialog).toHaveTextContent('No Codex writing turn or verifier command runs before Start local build.')
    expect(dialog).toHaveTextContent('13 focused candidate tests + 6 differential scenarios')
    expect(dialog).toHaveTextContent('42 candidate-safe tests + 4 separate replay guards')
    expect(within(dialog).getByText(/git clone --filter=blob:none --branch local-runner-v0\.1\.5/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Copy command' }))
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith(
      'RUN_DIR="$(mktemp -d)" && git clone --filter=blob:none --branch local-runner-v0.1.5 https://github.com/a252937166/traceforge.git "$RUN_DIR/traceforge" && cd "$RUN_DIR/traceforge" && NODE_ARCH="$(node -p \'process.arch\')" && npm_config_arch="$NODE_ARCH" corepack pnpm install --frozen-lockfile && npm_config_arch="$NODE_ARCH" node --import tsx apps/local-runner/src/cli.ts',
    ))
    expect(within(dialog).getByRole('button', { name: 'Copied' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Continue with verified replay' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Build live with your local Codex.' })).not.toBeInTheDocument())
    expect(document.documentElement).not.toHaveClass('runner-modal-open')
    expect(screen.getByRole('radio', { name: /Replay a verified run/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Run the verified migration' })).toBeEnabled()
  })

  it('posts recorded-replay explicitly and exposes its original timestamp', async () => {
    const fetchMock = installSuccessfulApi('recorded-replay')
    render(<App />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('radio', { name: /Replay a verified run/ }))
    await user.click(screen.getByRole('button', { name: 'Run the verified migration' }))

    expect(await screen.findByText(/authenticated model work was recorded/)).toBeInTheDocument()
    expect(screen.getByText(/host executes all six scenarios and issues a fresh proof/)).toBeInTheDocument()
    const migrationRequest = fetchMock.mock.calls.find(([input]) => String(input) === '/api/migrations')
    expect(JSON.parse(String(migrationRequest?.[1]?.body))).toEqual({
      executionMode: 'recorded-replay',
    })
  })

  it('labels deterministic-only as no model and sends that exact mode', async () => {
    const fetchMock = installSuccessfulApi('deterministic-only')
    render(<App />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('radio', { name: /Host-only proof/ }))
    await user.click(screen.getByRole('button', { name: 'Run the host proof' }))

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
    expect(await screen.findByText('SSE live')).toBeInTheDocument()

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
    expect(screen.queryByText('recovering')).not.toBeInTheDocument()
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
    expect(document.documentElement).toHaveClass('evidence-modal-open')
    const raw = within(dialog).getByText('Raw event JSON').closest('details')
    expect(raw).not.toHaveAttribute('open')
    await user.click(within(dialog).getByText('Raw event JSON'))
    expect(raw).toHaveAttribute('open')
    await user.click(within(dialog).getByRole('button', { name: 'Close evidence drawer' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.documentElement).not.toHaveClass('evidence-modal-open')
  })
})
