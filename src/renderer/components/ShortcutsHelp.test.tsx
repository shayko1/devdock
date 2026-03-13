import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ShortcutsHelp } from './ShortcutsHelp'

describe('ShortcutsHelp', () => {
  it('renders the shortcuts help modal', () => {
    const onClose = vi.fn()
    render(<ShortcutsHelp onClose={onClose} />)
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
  })

  it('renders general shortcuts section', () => {
    render(<ShortcutsHelp onClose={vi.fn()} />)
    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.getByText('Launchpad tab')).toBeInTheDocument()
  })

  it('renders terminal shortcuts section', () => {
    render(<ShortcutsHelp onClose={vi.fn()} />)
    expect(screen.getByText('Terminal')).toBeInTheDocument()
    expect(screen.getByText('New line in Claude prompt')).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<ShortcutsHelp onClose={onClose} />)
    fireEvent.click(screen.getByText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn()
    render(<ShortcutsHelp onClose={onClose} />)
    const overlay = document.querySelector('.modal-overlay')
    if (overlay) fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalled()
  })
})
