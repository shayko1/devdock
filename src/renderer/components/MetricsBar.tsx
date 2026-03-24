import React, { useState, useEffect, useRef } from 'react'
import { StatuslineData } from '../../shared/ipc-types'

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

interface Props {
  sessionIds: string[]
  label?: string
}

export function MetricsBar({ sessionIds, label }: Props) {
  const dataRef = useRef<Map<string, StatuslineData>>(new Map())
  const [totals, setTotals] = useState({ cost: 0, input: 0, output: 0, cache: 0, model: '' })

  useEffect(() => {
    const unsub = window.api.onStatuslineData((data: StatuslineData) => {
      dataRef.current.set(data.sessionId, data)
      // Recompute totals over all known sessions
      let cost = 0, input = 0, output = 0, cache = 0
      let model = ''
      dataRef.current.forEach((d) => {
        cost += d.costUsd ?? 0
        input += d.inputTokens ?? 0
        output += d.outputTokens ?? 0
        cache += (d.cacheCreationTokens ?? 0) + (d.cacheReadTokens ?? 0)
        if (!model && (d.model || d.modelId)) model = d.model || d.modelId || ''
      })
      setTotals({ cost, input, output, cache, model })
    })
    return unsub
  }, [])

  // Clear stale sessions when sessionIds changes
  useEffect(() => {
    const activeSet = new Set(sessionIds)
    dataRef.current.forEach((_, id) => {
      if (!activeSet.has(id)) dataRef.current.delete(id)
    })
  }, [sessionIds])

  const hasData = totals.cost > 0 || totals.input > 0 || totals.output > 0

  if (!hasData) return null

  const shortModel = totals.model
    ? totals.model.replace('claude-', '').replace(/-\d{4}-\d{2}-\d{2}$/, '')
    : ''

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '3px 12px',
      background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)',
      fontSize: 10, color: 'var(--text-secondary)', flexShrink: 0, flexWrap: 'wrap',
    }}>
      {label && <span style={{ fontWeight: 600, color: 'var(--text-muted)', marginRight: 4 }}>{label}</span>}
      {shortModel && <span title="Model" style={{ color: 'var(--blue, #58a6ff)' }}>⬡ {shortModel}</span>}
      {totals.input > 0 && <span title="Input tokens">↑ {fmt(totals.input)}</span>}
      {totals.output > 0 && <span title="Output tokens">↓ {fmt(totals.output)}</span>}
      {totals.cache > 0 && <span title="Cache tokens" style={{ color: 'var(--text-muted)' }}>⚡ {fmt(totals.cache)}</span>}
      {totals.cost > 0 && (
        <span title="Total cost" style={{ color: 'var(--green, #3fb950)', fontWeight: 600 }}>
          ${totals.cost < 0.01 ? totals.cost.toFixed(4) : totals.cost.toFixed(3)}
        </span>
      )}
      {sessionIds.length > 1 && (
        <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{sessionIds.length} sessions</span>
      )}
    </div>
  )
}
