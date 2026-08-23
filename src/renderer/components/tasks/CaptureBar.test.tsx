import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CaptureBar } from './CaptureBar'

describe('CaptureBar', () => {
  it('shows what it understood as you type', async () => {
    render(<CaptureBar onCapture={vi.fn()} />)
    await userEvent.type(screen.getByPlaceholderText(/add a task/i), 'p1 Ship it 90m')

    const hint = screen.getByTestId('capture-hint').textContent ?? ''
    expect(hint).toMatch(/P1/)
    expect(hint).toMatch(/90m/)
  })

  it('calls onCapture with the parsed task on Enter and clears the input', async () => {
    const onCapture = vi.fn()
    render(<CaptureBar onCapture={onCapture} />)

    const input = screen.getByPlaceholderText(/add a task/i) as HTMLInputElement
    await userEvent.type(input, 'p2 Fix the flake 45m{Enter}')

    expect(onCapture).toHaveBeenCalledTimes(1)
    const [parsed] = onCapture.mock.calls[0]
    expect(parsed.title).toBe('Fix the flake')
    expect(parsed.priority).toBe(2)
    expect(parsed.estimateMinutes).toBe(45)
    expect(input.value).toBe('')
  })

  it('ignores Enter on an empty or token-only input', async () => {
    const onCapture = vi.fn()
    render(<CaptureBar onCapture={onCapture} />)
    const input = screen.getByPlaceholderText(/add a task/i)

    await userEvent.type(input, '{Enter}')
    await userEvent.type(input, 'p1{Enter}')

    expect(onCapture).not.toHaveBeenCalled()
  })

  it('clears the input on Escape', async () => {
    render(<CaptureBar onCapture={vi.fn()} />)
    const input = screen.getByPlaceholderText(/add a task/i) as HTMLInputElement

    await userEvent.type(input, 'something{Escape}')
    expect(input.value).toBe('')
  })
})
