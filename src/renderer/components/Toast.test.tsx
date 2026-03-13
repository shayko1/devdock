import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Toast } from './Toast'

describe('Toast', () => {
  it('renders the message text', () => {
    render(<Toast message="Hello world" onDismiss={vi.fn()} />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('applies correct CSS class for type info', () => {
    render(<Toast message="Info" type="info" onDismiss={vi.fn()} />)
    const toast = screen.getByText('Info')
    expect(toast).toHaveClass('toast')
    expect(toast).toHaveClass('toast-info')
  })

  it('applies correct CSS class for type success', () => {
    render(<Toast message="Success" type="success" onDismiss={vi.fn()} />)
    const toast = screen.getByText('Success')
    expect(toast).toHaveClass('toast-success')
  })

  it('applies correct CSS class for type error', () => {
    render(<Toast message="Error" type="error" onDismiss={vi.fn()} />)
    const toast = screen.getByText('Error')
    expect(toast).toHaveClass('toast-error')
  })

  it('calls onDismiss callback when clicked', () => {
    const onDismiss = vi.fn()
    render(<Toast message="Click me" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByText('Click me'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('auto-dismisses after timeout', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<Toast message="Auto dismiss" onDismiss={onDismiss} />)
    expect(onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3000)
    expect(onDismiss).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
