import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsModal } from './SettingsModal'

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.mocked(window.api.selectFolder).mockResolvedValue(null)
  })

  it('renders with current path in input', () => {
    render(
      <SettingsModal
        currentPath="/Users/test/workspace"
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const input = screen.getByDisplayValue('/Users/test/workspace')
    expect(input).toBeInTheDocument()
  })

  it('browse button calls window.api.selectFolder', async () => {
    render(
      <SettingsModal
        currentPath="/path"
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Browse'))
    expect(window.api.selectFolder).toHaveBeenCalledTimes(1)
  })

  it('updates input when folder is selected', async () => {
    vi.mocked(window.api.selectFolder).mockResolvedValue('/Users/new/folder')
    render(
      <SettingsModal
        currentPath="/path"
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Browse'))
    expect(await screen.findByDisplayValue('/Users/new/folder')).toBeInTheDocument()
  })

  it('save button calls onSave with the path', async () => {
    const onSave = vi.fn()
    render(
      <SettingsModal
        currentPath="/path"
        onSave={onSave}
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Save'))
    expect(onSave).toHaveBeenCalledWith('/path')
  })

  it('cancel button calls onClose', () => {
    const onClose = vi.fn()
    render(
      <SettingsModal
        currentPath="/path"
        onSave={vi.fn()}
        onClose={onClose}
      />
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking overlay calls onClose', () => {
    const onClose = vi.fn()
    render(
      <SettingsModal
        currentPath="/path"
        onSave={vi.fn()}
        onClose={onClose}
      />
    )
    const overlay = document.querySelector('.modal-overlay')
    if (overlay) fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalled()
  })
})
