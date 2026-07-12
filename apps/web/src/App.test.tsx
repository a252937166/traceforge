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

function installSuccessfulApi(mode: 'live-ai' | 'recorded-replay' | 'deterministic-only' = 'recorded-replay') {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/health') {
      return jsonResponse({
        codexConfigured: true,
        codexStatus: { configured: true, truthfulBoundary: 'Codex is configured.' },
        gpt56Status: { configured: true, truthfulBoundary: 'GPT-5.6 is configured.' },
        release: {
          sha: 'de748868292639c57abea7b8d53e933987bea03e',
          version: 'local-runner-v0.1.9',
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
  await screen.findByTitle('migration-01')
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
            version: 'local-runner-v0.1.9',
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

  it('starts with one primary zero-credential proof CTA and no empty run panels', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Prove what changed. Keep Codex local.' })).toBeInTheDocument()
    const primaryAction = screen.getByRole('button', { name: 'Inspect a completed proof' })
    expect(primaryAction).toHaveClass('action-primary')
    expect(screen.getByText('Try instantly · no credentials')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Codex locally' })).toHaveClass('action-link')
    expect(screen.getByText('Advanced · real local build · setup required')).toBeInTheDocument()
    expect(screen.getByText('No local files, Codex credentials, generated source, or session history are sent to this website.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Migration stages' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Server-reported provenance' })).not.toBeInTheDocument()
    expect(screen.queryByText('No proof issued')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Download the evidence' })).not.toBeInTheDocument()
    expect(screen.queryByText(/sample success/i)).not.toBeInTheDocument()
  })

  it('turns a failed health check into an explicit retryable state', async () => {
    let healthCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== '/api/health') throw new Error(`Unexpected request: ${String(input)}`)
      healthCalls += 1
      if (healthCalls === 1) {
        return jsonResponse({ error: { message: 'Health manifest unavailable.' } }, 503)
      }
      return jsonResponse({
        codexConfigured: true,
        codexStatus: { configured: true },
        gpt56Status: { configured: true },
        release: {
          sha: 'de748868292639c57abea7b8d53e933987bea03e',
          version: 'local-runner-v0.1.9',
          builtAt: '2026-07-11T14:30:00.000Z',
        },
      })
    }))
    render(<App />)
    const user = userEvent.setup()

    expect(await screen.findByText('Health check failed')).toBeInTheDocument()
    expect(screen.getByText('Health manifest unavailable.')).toBeInTheDocument()
    expect(screen.queryByText('Checking health…')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry health check' }))
    const release = screen.getByRole('region', { name: 'Release evidence' })
    expect(await within(release).findByRole('link', { name: /Production de74886/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry health check' })).not.toBeInTheDocument()
  })

  it('explains and closes the public, loopback, and Codex trust boundaries', async () => {
    render(<App />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Local boundary' }))
    const dialog = screen.getByRole('dialog', { name: 'Where every capability stops.' })

    expect(document.documentElement).toHaveClass('boundary-modal-open')
    expect(within(dialog).getByRole('heading', { name: 'Guide + proof replay' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: '127.0.0.1 handoff' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'Explicit bounded build' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Cannot read Codex credentials or history')
    expect(dialog).toHaveTextContent('Cannot commit, push, merge, or deploy')

    await user.click(within(dialog).getByRole('button', { name: 'Close local boundary' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Where every capability stops.' })).not.toBeInTheDocument())
    expect(document.documentElement).not.toHaveClass('boundary-modal-open')
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
        recordedAt: '2026-07-11T17:42:15.612Z',
        sourceRunId: 'migration_efaa0383-628a-4fba-94df-96bfe344bcbe',
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
        codexThreadId: '019f5244-7bef-71f2-8f25-8ed1446a539e',
        changedFiles: ['apps/api/src/candidates/generated-return-workflow.ts'],
      }],
      proof: {
        id: 'proof-01',
        migrationId: replayJob.id,
        status: 'PASSED',
        digest: `sha256:${'4be44d4'.padEnd(64, '0')}`,
        generatedAt: '2026-07-11T01:01:00.000Z',
        scenariosPassed: 7,
        scenariosTotal: 7,
        assertionsPassed: 35,
        assertionsTotal: 35,
        mismatchCount: 0,
        modelInvocations: [23_811, 23_723, 24_267, 49_872].map((totalTokens, index) => ({
          role: index === 0 ? 'trace-archaeologist' : index === 3 ? 'contract-critic' : 'counterexample-hunter',
          model: 'gpt-5.6-sol',
          threadId: `thread-${index + 1}`,
          status: 'succeeded',
          usage: { totalTokens },
        })),
        candidate: {
          implementationId: 'replacement.return-workflow.generated-candidate',
          codexThreadId: '019f5244-7bef-71f2-8f25-8ed1446a539e',
          baseCommit: 'eb0e6169974b96bd3bff3b536b38ef5f665127c2',
          changedFiles: ['apps/api/src/candidates/generated-return-workflow.ts'],
          sourceDigest: `sha256:${'fdf9a85'.padEnd(64, '0')}`,
          diffDigest: `sha256:${'4e28410'.padEnd(64, '0')}`,
        },
        hostVerification: { testsPassed: 56, testsTotal: 56, testsSkipped: 4, scope: 'candidate-safe' },
      },
    }

    render(<ProvenanceStrip state={state} mode="recorded-replay" />)
    const strip = screen.getByRole('region', { name: 'Server-reported provenance' })

    expect(within(strip).getByText('4 verified')).toBeInTheDocument()
    expect(within(strip).getByText('121,673 recorded')).toBeInTheDocument()
    expect(within(strip).getByText('4 reported')).toBeInTheDocument()
    expect(within(strip).getByText('56/56 · 4 replay-only')).toBeInTheDocument()
    expect(within(strip).getByText('7/7')).toBeInTheDocument()
    expect(within(strip).getByText('35/35')).toBeInTheDocument()
    expect(within(strip).getByText('sha256:fdf9a85…')).toHaveAttribute('title', expect.stringMatching(/^sha256:fdf9a85/))
    expect(within(strip).getByText('sha256:4e28410…')).toHaveAttribute('title', expect.stringMatching(/^sha256:4e28410/))
    expect(within(strip).getByText('sha256:4be44d4…')).toHaveAttribute('title', expect.stringMatching(/^sha256:4be44d4/))
    expect(within(strip).getByTitle(replayJob.replay!.sourceRunId)).toHaveTextContent('migration_efaa0383-628a')
    expect(within(strip).getByTitle(replayJob.id)).toHaveTextContent('migration_replay_fresh_')
    expect(within(strip).queryByText('Not reported')).not.toBeInTheDocument()
  })

  it('keeps replay as the advanced default and separates immutable release evidence', async () => {
    render(<App />)

    expect(screen.getByRole('radio', { name: /Replay a verified run/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Host-only proof/ })).not.toBeChecked()
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual([
      'recorded-replay',
      'deterministic-only',
    ])
    expect(screen.queryByRole('radio', { name: /New live AI run/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Codex locally' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Inspect a completed proof' })).toBeEnabled()
    expect(screen.getByText('No sign-in · server-paced SSE · fresh proof bundle')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run the verified migration' })).toBeEnabled()
    expect(screen.getByRole('link', { name: 'Live evidence' })).toHaveAttribute(
      'href',
      expect.stringContaining('/docs/evidence/live-champion-run'),
    )

    const release = screen.getByRole('region', { name: 'Release evidence' })
    const production = await within(release).findByRole('link', { name: /Production de74886/ })
    const runner = within(release).getByRole('link', { name: /Pinned runner v0\.1\.9 · a2ce8b2/ })
    const localRun = within(release).getByRole('link', { name: /Real local run PASS · 7\/7/ })
    const sourceRun = within(release).getByRole('link', { name: /Source run 4 GPT · 1 Codex/ })
    const deployment = within(release).getByRole('link', { name: /Deployment traceforge\.axiqo\.xyz/ })

    expect(production).toHaveAttribute('href', 'https://github.com/a252937166/traceforge/commit/de748868292639c57abea7b8d53e933987bea03e')
    expect(runner).toHaveAttribute('href', 'https://github.com/a252937166/traceforge/commit/a2ce8b2394caf5d1491c2b142f99a8421f3cec2d')
    expect(runner).toHaveTextContent('Executable source commit · no binary claim')
    expect(localRun).toHaveAttribute('href', expect.stringContaining('/docs/evidence/local-runner-v0.1.9'))
    expect(localRun).toHaveTextContent('v0.1.9 · 35/35 assertions · archived')
    expect(sourceRun).toHaveAttribute('href', expect.stringContaining('/docs/evidence/live-champion-run'))
    expect(sourceRun).toHaveTextContent('Recorded model evidence · archived')
    expect(deployment).toHaveAttribute('href', '/api/health')
    expect(production).not.toHaveAttribute('href', runner.getAttribute('href'))
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Release de74886')
  })

  it('opens a three-step fixed-demo Runner guide with one copy command and a replay exit', async () => {
    const fetchMock = installSuccessfulApi('recorded-replay')
    render(<App />)
    const user = userEvent.setup()
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText')

    await user.click(screen.getByRole('button', { name: 'Run Codex locally' }))

    const dialog = screen.getByRole('dialog', { name: 'Start a bounded proof run.' })
    expect(document.documentElement).toHaveClass('runner-modal-open')
    expect(dialog).toHaveTextContent('Current release: fixed damaged-returns demo. It does not browse or modify your own project.')
    const steps = within(dialog).getByRole('list', { name: 'Local Runner guide steps' })
    expect(within(steps).getAllByRole('button')).toHaveLength(3)
    expect(within(steps).getByRole('button', { name: 'Step 1 of 3: Start Runner' })).toHaveAttribute('aria-current', 'step')
    expect(within(steps).getByRole('button', { name: 'Step 2 of 3: Review locally' })).not.toHaveAttribute('aria-current')
    expect(within(steps).getByRole('button', { name: 'Step 3 of 3: Collect proof' })).not.toHaveAttribute('aria-current')
    expect(dialog).toHaveTextContent('Launch the pinned source release')
    expect(dialog).toHaveTextContent('Node.js 22.13+')
    expect(dialog).toHaveTextContent('Pinned commit a2ce8b2394caf5d1491c2b142f99a8421f3cec2d · source install · no binary checksum claim')
    expect(within(dialog).getAllByRole('button', { name: 'Copy command' })).toHaveLength(1)
    expect(within(dialog).getByText(/git clone --filter=blob:none --branch local-runner-v0\.1\.9/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Copy command' }))
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith(
      'EXPECTED_SHA="a2ce8b2394caf5d1491c2b142f99a8421f3cec2d" && RUN_DIR="$(mktemp -d)" && git clone --filter=blob:none --branch local-runner-v0.1.9 https://github.com/a252937166/traceforge.git "$RUN_DIR/traceforge" && cd "$RUN_DIR/traceforge" && ACTUAL_SHA="$(git rev-parse HEAD)" && { test "$ACTUAL_SHA" = "$EXPECTED_SHA" || { echo "Unexpected TraceForge release commit" >&2; exit 64; }; } && export TRACEFORGE_LOCAL_RELEASE_SHA="$ACTUAL_SHA" && NODE_ARCH="$(node -p \'process.arch\')" && npm_config_arch="$NODE_ARCH" corepack pnpm install --frozen-lockfile && npm_config_arch="$NODE_ARCH" node --import tsx apps/local-runner/src/cli.ts',
    ))
    expect(within(dialog).getByRole('button', { name: 'Copied' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Next: review local scope' }))
    expect(within(steps).getByRole('button', { name: 'Step 2 of 3: Review locally' })).toHaveAttribute('aria-current', 'step')
    expect(dialog).toHaveTextContent('Approve one fixed Codex build on localhost')
    expect(dialog).toHaveTextContent('Damaged returns v1')
    expect(dialog).toHaveTextContent('One candidate file')
    expect(dialog).toHaveTextContent('Temporary writer workspace · no arbitrary project selection.')
    expect(dialog).toHaveTextContent('Approval is explicit.')
    expect(within(dialog).queryByRole('button', { name: 'Copy command' })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Next: see proof output' }))
    expect(within(steps).getByRole('button', { name: 'Step 3 of 3: Collect proof' })).toHaveAttribute('aria-current', 'step')
    expect(dialog).toHaveTextContent('Follow the local run to a recomputable result')
    const localStages = dialog.querySelector('.local-run-stages')
    expect(localStages).not.toBeNull()
    expect(within(localStages as HTMLElement).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Preflight',
      'Sign in',
      'Review scope',
      'Codex build',
      'Host verify',
      'Proof',
    ])
    expect(dialog).toHaveTextContent('One changed file + diff digest')
    expect(dialog).toHaveTextContent('15 tests + 7 scenarios + 35 assertions')
    expect(dialog).toHaveTextContent('Runner commit + input + candidate + output digests')
    expect(within(dialog).getByRole('link', { name: /Inspect the archived v0\.1\.9 run/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/docs/evidence/local-runner-v0.1.9'),
    )

    await user.click(within(dialog).getByRole('button', { name: 'Inspect completed proof instead' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Start a bounded proof run.' })).not.toBeInTheDocument())
    expect(document.documentElement).not.toHaveClass('runner-modal-open')
    expect(await screen.findByRole('region', { name: 'Replay a verified run' })).toBeInTheDocument()
    const migrationRequest = fetchMock.mock.calls.find(([input]) => String(input) === '/api/migrations')
    expect(JSON.parse(String(migrationRequest?.[1]?.body))).toEqual({ executionMode: 'recorded-replay' })
  })

  it('posts recorded-replay explicitly and exposes its original timestamp', async () => {
    const fetchMock = installSuccessfulApi('recorded-replay')
    render(<App />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('radio', { name: /Replay a verified run/ }))
    await user.click(screen.getByRole('button', { name: 'Run the verified migration' }))

    const workspace = await screen.findByRole('region', { name: 'Replay a verified run' })
    expect(workspace).toHaveTextContent(/authenticated model work was recorded/)
    expect(workspace).toHaveTextContent(/host executes all seven scenarios and issues a fresh proof/)
    expect(within(workspace).getByText('Current activity')).toBeInTheDocument()
    expect(within(workspace).getByRole('complementary', { name: 'Run boundaries' })).toHaveTextContent('Recorded model work · fresh host proof')
    expect(within(workspace).getByText('Waiting for observe')).toBeInTheDocument()
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

    const workspace = await screen.findByRole('region', { name: 'Host-only proof' })
    expect(workspace).toHaveTextContent('migration-01')
    expect(workspace).toHaveTextContent('Host-only deterministic proof')
    expect(workspace).toHaveTextContent(/No GPT or Codex execution is claimed/)
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
    expect(await screen.findByRole('button', { name: /hypothesis\.proposed/ })).toBeInTheDocument()

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

  it('retries terminal job, artifact, and proof reads before declaring the preserved run unavailable', async () => {
    let proofCalls = 0
    const passedJob = {
      ...job('recorded-replay'),
      status: 'passed',
      currentStage: 'verify',
      completedAt: '2026-07-11T01:00:08.000Z',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/health') {
        return jsonResponse({
          codexConfigured: true,
          codexStatus: { configured: true },
          gpt56Status: { configured: true },
          release: {
            sha: 'de748868292639c57abea7b8d53e933987bea03e',
            version: 'local-runner-v0.1.9',
            builtAt: '2026-07-11T14:30:00.000Z',
          },
        })
      }
      if (url === '/api/migrations' && init?.method === 'POST') {
        return jsonResponse({ data: job('recorded-replay') }, 202)
      }
      if (url === '/api/migrations/migration-01') return jsonResponse({ data: passedJob })
      if (url.endsWith('/artifacts')) return jsonResponse({ data: { artifacts: [] } })
      if (url.endsWith('/proof')) {
        proofCalls += 1
        if (proofCalls === 1) return jsonResponse({ error: { message: 'Proof storage is catching up.' } }, 503)
        return jsonResponse({
          data: {
            proofId: 'proof-terminal-recovery',
            migrationId: 'migration-01',
            status: 'PASSED',
            digest: `sha256:${'a'.repeat(64)}`,
            generatedAt: '2026-07-11T01:00:08.000Z',
            coverage: { total: 7, passed: 7 },
            assertionsPassed: 35,
            assertionsTotal: 35,
            mismatchCount: 0,
          },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await startMigration()

    const source = FakeEventSource.instances[0]
    source?.open()
    source?.emit({
      id: 'evt-completed-retry',
      migrationId: 'migration-01',
      sequence: 8,
      type: 'job.completed',
      stage: 'verify',
      occurredAt: '2026-07-11T01:00:08.000Z',
      payload: { jobStatus: 'passed' },
    })

    expect(await screen.findByText('Finalizing proof bundle')).toBeInTheDocument()
    expect(screen.getByText(/Proof storage is catching up/)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'PASSED · 7/7 scenarios' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Finalizing proof bundle')).not.toBeInTheDocument())
    expect(screen.queryByText('Proof bundle unavailable')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry proof bundle' })).not.toBeInTheDocument()
    expect(proofCalls).toBe(2)
    expect(source?.closed).toBe(true)
  })

  it('does not let a delayed running response overwrite a terminal passed job', async () => {
    let jobCalls = 0
    let resolveDelayedRunning!: (response: Response) => void
    const delayedRunning = new Promise<Response>((resolve) => {
      resolveDelayedRunning = resolve
    })
    const passedJob = {
      ...job('recorded-replay'),
      status: 'passed',
      currentStage: 'verify',
      completedAt: '2026-07-11T01:00:09.000Z',
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/health') {
        return jsonResponse({
          codexConfigured: true,
          codexStatus: { configured: true },
          gpt56Status: { configured: true },
          release: {
            sha: 'de748868292639c57abea7b8d53e933987bea03e',
            version: 'local-runner-v0.1.9',
            builtAt: '2026-07-11T14:30:00.000Z',
          },
        })
      }
      if (url === '/api/migrations' && init?.method === 'POST') {
        return jsonResponse({ data: job('recorded-replay') }, 202)
      }
      if (url === '/api/migrations/migration-01') {
        jobCalls += 1
        return jobCalls === 1 ? delayedRunning : jsonResponse({ data: passedJob })
      }
      if (url.endsWith('/artifacts')) return jsonResponse({ data: { artifacts: [] } })
      if (url.endsWith('/proof')) {
        return jsonResponse({
          data: {
            proofId: 'proof-monotonic-terminal',
            migrationId: 'migration-01',
            status: 'PASSED',
            digest: `sha256:${'b'.repeat(64)}`,
            generatedAt: '2026-07-11T01:00:09.000Z',
            coverage: { total: 7, passed: 7 },
            assertionsPassed: 35,
            assertionsTotal: 35,
            mismatchCount: 0,
          },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }))
    render(<App />)
    await startMigration()
    const source = FakeEventSource.instances[0]

    source?.emit({
      id: 'evt-running-refresh',
      migrationId: 'migration-01',
      sequence: 6,
      type: 'stage.started',
      stage: 'verify',
      occurredAt: '2026-07-11T01:00:06.000Z',
      payload: { message: 'Verify started.' },
    })
    await waitFor(() => expect(jobCalls).toBe(1))

    source?.emit({
      id: 'evt-completed-monotonic',
      migrationId: 'migration-01',
      sequence: 9,
      type: 'job.completed',
      stage: 'verify',
      occurredAt: '2026-07-11T01:00:09.000Z',
      payload: { jobStatus: 'passed' },
    })
    expect(await screen.findByRole('heading', { name: 'PASSED · 7/7 scenarios' })).toBeInTheDocument()
    expect(screen.getByText('proof ready')).toBeInTheDocument()

    resolveDelayedRunning(jsonResponse({ data: job('recorded-replay') }))
    await waitFor(() => expect(jobCalls).toBe(2))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(screen.getByText('proof ready')).toBeInTheDocument()
    expect(screen.queryByText('SSE live')).not.toBeInTheDocument()
  })

  it('clears a transient polling error after connectivity recovers', async () => {
    let pollCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/health') {
        return jsonResponse({
          codexConfigured: true,
          codexStatus: { configured: true },
          gpt56Status: { configured: true },
          release: {
            sha: 'de748868292639c57abea7b8d53e933987bea03e',
            version: 'local-runner-v0.1.9',
            builtAt: '2026-07-11T14:30:00.000Z',
          },
        })
      }
      if (url === '/api/migrations' && init?.method === 'POST') {
        return jsonResponse({ data: job('recorded-replay') }, 202)
      }
      if (url.includes('/events?') && url.includes('format=json')) {
        pollCalls += 1
        if (pollCalls === 1) {
          return jsonResponse({ error: { message: 'Transient poll failure.' } }, 503)
        }
        return jsonResponse({ data: { events: [] } })
      }
      if (url.endsWith('/artifacts')) return jsonResponse({ data: { artifacts: [] } })
      if (url.endsWith('/proof')) return jsonResponse({ error: { message: 'Proof pending.' } }, 404)
      if (url === '/api/migrations/migration-01') return jsonResponse({ data: job('recorded-replay') })
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await startMigration()

    FakeEventSource.instances[0]?.fail()
    expect(await screen.findByText('Connection interrupted')).toBeInTheDocument()
    expect(screen.getByText(/TraceForge is retrying without discarding run evidence/)).toBeInTheDocument()
    expect(screen.queryByText('Run stopped')).not.toBeInTheDocument()

    await waitFor(
      () => expect(screen.queryByText('Connection interrupted')).not.toBeInTheDocument(),
      { timeout: 3_500 },
    )
    expect(pollCalls).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('recovering')).toBeInTheDocument()
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
    expect(screen.getAllByText('Host replay includes a verification-only priority check.').length).toBeGreaterThan(0)
    expect(screen.getByText(/Model authorship is claimed only when the server reports it/)).toBeInTheDocument()
    expect(screen.queryByText('held-out')).not.toBeInTheDocument()
    expect(screen.getAllByText('PASSED')).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'PASSED · 2/2 scenarios' })).toBeInTheDocument()
    const verification = screen.getByRole('list', { name: 'Verification results' })
    expect(within(verification).getByText('Proof digest reported')).toHaveClass('verified')
    expect(within(verification).getByText('Differential scenarios checked')).toHaveClass('verified')
    expect(within(verification).getByText('Host verification reported')).not.toHaveClass('verified')
    expect(screen.getByRole('link', { name: 'Verify proof' })).toHaveAttribute('href', expect.stringContaining('#verify-the-proof-digest-locally'))
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
