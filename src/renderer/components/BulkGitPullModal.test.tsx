import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BulkGitPullModal } from './BulkGitPullModal'

describe('BulkGitPullModal', () => {
  beforeEach(() => {
    vi.mocked(window.api.bulkGitPullWorkspace).mockResolvedValue({ entries: [] })
    vi.mocked(window.api.onBulkGitPullProgress).mockReturnValue(() => {})
  })

  it('calls onClose when overlay is clicked while idle', () => {
    const onClose = vi.fn()
    render(<BulkGitPullModal scanPath="/w" onClose={onClose} />)
    fireEvent.click(document.querySelector('.modal-overlay')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close overlay click while pull is running', async () => {
    const onClose = vi.fn()
    vi.mocked(window.api.bulkGitPullWorkspace).mockImplementation(
      () => new Promise(() => {
        /* never resolves */
      })
    )
    render(<BulkGitPullModal scanPath="/w" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run pull' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Running…' })).toBeDisabled())
    fireEvent.click(document.querySelector('.modal-overlay')!)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose on Escape when idle', () => {
    const onClose = vi.fn()
    render(<BulkGitPullModal scanPath="/w" onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose on Escape while running', async () => {
    const onClose = vi.fn()
    vi.mocked(window.api.bulkGitPullWorkspace).mockImplementation(
      () => new Promise(() => {
        /* never resolves */
      })
    )
    render(<BulkGitPullModal scanPath="/w" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run pull' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Running…' })).toBeInTheDocument())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('subscribes to bulk pull progress while running', async () => {
    let resolvePull: (v: { entries: [] }) => void = () => {}
    const p = new Promise<{ entries: [] }>((r) => {
      resolvePull = r
    })
    vi.mocked(window.api.bulkGitPullWorkspace).mockImplementation(() => p)
    render(<BulkGitPullModal scanPath="/w" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run pull' }))
    await waitFor(() => expect(window.api.onBulkGitPullProgress).toHaveBeenCalled())
    resolvePull({ entries: [] })
    await waitFor(() => expect(screen.getByRole('button', { name: /Run again/ })).not.toBeDisabled())
  })

  it('shows concurrent bulk pull message as error', async () => {
    vi.mocked(window.api.bulkGitPullWorkspace).mockResolvedValue({
      entries: [
        {
          name: '(workspace)',
          path: '/w',
          status: 'failed',
          detail: 'A bulk pull is already running — please wait for it to finish',
        },
      ],
    })
    render(<BulkGitPullModal scanPath="/w" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run pull' }))
    await waitFor(() =>
      expect(screen.getByText(/A bulk pull is already running/)).toBeInTheDocument()
    )
  })
})
