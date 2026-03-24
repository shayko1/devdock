import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import { MetricsBar } from './MetricsBar'
import { StatuslineData } from '../../shared/ipc-types'

// Capture the onStatuslineData callback so tests can fire events
let statuslineCallback: ((data: StatuslineData) => void) | null = null

vi.mock('../../window-api', () => ({}), { virtual: true })

const mockUnsub = vi.fn()
const mockOnStatuslineData = vi.fn((cb: (data: StatuslineData) => void) => {
  statuslineCallback = cb
  return mockUnsub
})

Object.defineProperty(globalThis, 'window', {
  value: {
    api: {
      onStatuslineData: mockOnStatuslineData,
    },
  },
  writable: true,
})

function makeData(overrides: Partial<StatuslineData> & { sessionId: string }): StatuslineData {
  return {
    sessionId: overrides.sessionId,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    model: '',
    modelId: '',
    ...overrides,
  }
}

describe('MetricsBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    statuslineCallback = null
  })

  it('returns null when no data has arrived', () => {
    const { container } = render(<MetricsBar sessionIds={['s1']} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders token and cost data after receiving an event', () => {
    render(<MetricsBar sessionIds={['s1']} label="Claude" />)

    act(() => {
      statuslineCallback!(makeData({
        sessionId: 's1',
        inputTokens: 1500,
        outputTokens: 300,
        costUsd: 0.0042,
      }))
    })

    expect(screen.getByTitle('Input tokens').textContent).toBe('↑ 1.5K')
    expect(screen.getByTitle('Output tokens').textContent).toBe('↓ 300')
    expect(screen.getByTitle('Total cost').textContent).toBe('$0.0042')
    expect(screen.getByText('Claude')).toBeInTheDocument()
  })

  it('filters out events from sessions not in sessionIds', () => {
    render(<MetricsBar sessionIds={['s1']} />)

    act(() => {
      // s2 is not in the sessionIds list — should be ignored
      statuslineCallback!(makeData({ sessionId: 's2', inputTokens: 9999, costUsd: 1.0 }))
    })

    // Still no data rendered (component returns null)
    expect(screen.queryByTitle('Input tokens')).toBeNull()
  })

  it('shows tokens from multiple sessions in the list', () => {
    render(<MetricsBar sessionIds={['s1', 's2']} />)

    act(() => {
      statuslineCallback!(makeData({ sessionId: 's1', inputTokens: 1000, costUsd: 0.001 }))
    })
    act(() => {
      statuslineCallback!(makeData({ sessionId: 's2', inputTokens: 2000, costUsd: 0.002 }))
    })

    // Totals: input 3000, cost 0.003
    expect(screen.getByTitle('Input tokens').textContent).toBe('↑ 3.0K')
    expect(screen.getByText('2 sessions')).toBeInTheDocument()
  })

  it('does not show data for a session removed from sessionIds', () => {
    const { rerender } = render(<MetricsBar sessionIds={['s1', 's2']} />)

    act(() => {
      statuslineCallback!(makeData({ sessionId: 's1', inputTokens: 500, costUsd: 0.001 }))
      statuslineCallback!(makeData({ sessionId: 's2', inputTokens: 500, costUsd: 0.001 }))
    })

    // Remove s2 from list — stale entry is evicted from dataRef
    rerender(<MetricsBar sessionIds={['s1']} />)

    // Fire an s1 event to trigger recompute; s2 data is gone from dataRef
    act(() => {
      statuslineCallback!(makeData({ sessionId: 's1', inputTokens: 500, costUsd: 0.001 }))
    })

    // Events for s2 are now ignored (not in sessionIds)
    act(() => {
      statuslineCallback!(makeData({ sessionId: 's2', inputTokens: 9999, costUsd: 99 }))
    })

    // Only s1 data (500 tokens, $0.001)
    expect(screen.getByTitle('Input tokens').textContent).toBe('↑ 500')
    // "2 sessions" badge should be gone
    expect(screen.queryByText('2 sessions')).toBeNull()
  })
})
