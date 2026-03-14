import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { CoachSuggestion, CoachSessionCost } from '../../shared/coach-types'

interface Props {
  sessionId: string
  onClose: () => void
  onWriteToTerminal?: (text: string) => void
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  tip: { label: 'TIP', color: 'var(--blue, #58a6ff)' },
  rewrite: { label: 'REWRITE', color: 'var(--orange, #d29922)' },
  followup: { label: 'FOLLOW-UP', color: 'var(--green, #3fb950)' },
  command: { label: 'COMMAND', color: 'var(--purple, #bc8cff)' },
}

export function CoachPanel({ sessionId, onClose, onWriteToTerminal }: Props) {
  const [suggestions, setSuggestions] = useState<CoachSuggestion[]>([])
  const [cost, setCost] = useState<CoachSessionCost>({ totalUsd: 0, calls: 0, promptTokens: 0, completionTokens: 0 })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    const [sug, c] = await Promise.all([
      window.api.coachGetSuggestions(sessionId),
      window.api.coachGetCost(sessionId)
    ])
    setSuggestions(sug)
    setCost(c)
  }, [sessionId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const unsub = window.api.onCoachSuggestion((analysis) => {
      if (analysis.sessionId === sessionId) {
        setSuggestions(prev => [...prev, ...analysis.suggestions].slice(-20))
        setCost(prev => ({
          totalUsd: prev.totalUsd + analysis.costUsd,
          calls: prev.calls + 1,
          promptTokens: prev.promptTokens + analysis.tokensUsed.prompt,
          completionTokens: prev.completionTokens + analysis.tokensUsed.completion
        }))
        // Auto-scroll to bottom
        setTimeout(() => {
          listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
        }, 100)
      }
    })
    return unsub
  }, [sessionId])

  const handleDismiss = useCallback(async (suggestionId: string) => {
    await window.api.coachDismiss(sessionId, suggestionId)
    setSuggestions(prev => prev.filter(s => s.id !== suggestionId))
  }, [sessionId])

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
  }, [])

  const handleUse = useCallback((text: string) => {
    if (onWriteToTerminal) {
      onWriteToTerminal(text)
    } else {
      navigator.clipboard.writeText(text)
    }
  }, [onWriteToTerminal])

  const formatCost = (usd: number) => {
    if (usd === 0) return '$0.00'
    if (usd < 0.001) return `$${usd.toFixed(5)}`
    if (usd < 0.01) return `$${usd.toFixed(4)}`
    return `$${usd.toFixed(3)}`
  }

  const timeAgo = (ts: number) => {
    const diff = Math.floor((Date.now() - ts) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    return `${Math.floor(diff / 3600)}h ago`
  }

  return (
    <div className="coach-panel">
      <div className="coach-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Coach</span>
          {suggestions.length > 0 && (
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 8,
              background: 'var(--orange, #d29922)', color: '#000', fontWeight: 600
            }}>
              {suggestions.length}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {formatCost(cost.totalUsd)} · {cost.calls} calls
          </span>
          <button
            className="coach-close-btn"
            onClick={onClose}
            title="Close coach panel"
          >
            ×
          </button>
        </div>
      </div>

      <div className="coach-panel-list" ref={listRef}>
        {suggestions.length === 0 ? (
          <div className="coach-empty">
            <div style={{ fontSize: 20, marginBottom: 8 }}>&#9672;</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 220, textAlign: 'center', lineHeight: 1.5 }}>
              Coach is watching this session. Suggestions will appear after Claude responds.
            </div>
          </div>
        ) : (
          suggestions.map((s) => {
            const meta = TYPE_LABELS[s.type] || TYPE_LABELS.tip
            const isExpanded = expanded.has(s.id)
            return (
              <div key={s.id} className="coach-card">
                <div className="coach-card-header" onClick={() => toggleExpand(s.id)}>
                  <span className="coach-type-badge" style={{ background: meta.color }}>
                    {meta.label}
                  </span>
                  <span className="coach-card-title">{s.title}</span>
                  <span className="coach-card-time">{timeAgo(s.timestamp)}</span>
                  <button
                    className="coach-dismiss-btn"
                    onClick={(e) => { e.stopPropagation(); handleDismiss(s.id) }}
                    title="Dismiss"
                  >
                    ×
                  </button>
                </div>
                <div className="coach-card-body">{s.body}</div>
                {s.suggestion && (
                  <>
                    {isExpanded && (
                      <div className="coach-suggestion-block">
                        <pre className="coach-suggestion-pre">{s.suggestion}</pre>
                        <div className="coach-suggestion-actions">
                          <button className="btn btn-sm" onClick={() => handleCopy(s.suggestion!)}>
                            Copy
                          </button>
                          <button className="btn btn-sm btn-primary" onClick={() => handleUse(s.suggestion!)}>
                            Use
                          </button>
                        </div>
                      </div>
                    )}
                    {!isExpanded && (
                      <button
                        className="coach-show-suggestion"
                        onClick={() => toggleExpand(s.id)}
                      >
                        Show suggestion ▸
                      </button>
                    )}
                  </>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
