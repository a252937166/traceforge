import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('TraceForge workbench', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('labels fixture fallback and completes the visible proof sequence', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('API offline'))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByText(/Synchronized playback/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Run proof' }))

    expect(await screen.findByText('Sample data')).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', {
        name: 'Sample replay complete — start live runner to seal proof',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Proof sealed')).not.toBeInTheDocument()
    expect(screen.queryByText('Covered behavior conforms')).not.toBeInTheDocument()
    expect(screen.queryByText(/Codex produced/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run proof again' })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      scenarioId: 'damaged-small-refund',
      candidateVersion: 'buggy',
    })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      scenarioId: 'damaged-small-refund',
      candidateVersion: 'fixed',
    })
  })
})
