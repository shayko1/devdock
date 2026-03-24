import React, { useEffect, useMemo, useRef, useState } from 'react'
import type {
  BulkGitPullPhase,
  BulkGitPullResult,
  BulkGitPullResultEntry,
} from '../../shared/ipc-types'
import './BulkGitPullModal.css'

interface Props {
  scanPath: string
  onClose: () => void
}

function parseExtraSubs(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function summarize(entries: BulkGitPullResultEntry[]): string {
  const ok = entries.filter((e) => e.status === 'ok').length
  const failed = entries.filter((e) => e.status === 'failed').length
  const skipped = entries.filter((e) => e.status === 'skipped').length
  return `${ok} pulled · ${failed} failed · ${skipped} skipped`
}

function phaseLabel(phase: BulkGitPullPhase): string {
  switch (phase) {
    case 'fetch':
      return 'Fetching from origin…'
    case 'checkout':
      return 'Checking out default branch…'
    case 'pull':
      return 'Pulling (fast-forward only)…'
    default:
      return phase
  }
}

export function BulkGitPullModal({ scanPath, onClose }: Props) {
  const [onlyWixRelated, setOnlyWixRelated] = useState(true)
  const [extraSubs, setExtraSubs] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<BulkGitPullResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progressEntries, setProgressEntries] = useState<BulkGitPullResultEntry[]>([])
  const [active, setActive] = useState<{
    name: string
    phase: BulkGitPullPhase
    index: number
    total: number
  } | null>(null)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const extraList = useMemo(() => parseExtraSubs(extraSubs), [extraSubs])

  const displayEntries = !running && result ? result.entries : progressEntries

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !running) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, running])

  useEffect(() => {
    if (!running) return
    const unsub = window.api.onBulkGitPullProgress((data) => {
      if (!mountedRef.current) return
      if (data.kind === 'active') {
        setActive({
          name: data.name,
          phase: data.phase,
          index: data.index,
          total: data.total,
        })
      } else {
        setProgressEntries((prev) => [...prev, data.entry])
      }
    })
    return unsub
  }, [running])

  const run = async () => {
    setRunning(true)
    setError(null)
    setResult(null)
    setProgressEntries([])
    setActive(null)
    try {
      const res = await window.api.bulkGitPullWorkspace(scanPath, {
        onlyWixRelated,
        extraRemoteSubstrings: extraList,
      })
      if (!mountedRef.current) return
      const concurrentMsg = 'A bulk pull is already running'
      if (
        res.entries.length === 1 &&
        res.entries[0].status === 'failed' &&
        res.entries[0].detail?.includes(concurrentMsg)
      ) {
        setError(res.entries[0].detail ?? null)
        setResult(null)
      } else {
        setResult(res)
      }
    } catch (e) {
      if (!mountedRef.current) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mountedRef.current) {
        setRunning(false)
        setActive(null)
      }
    }
  }

  const showSummary =
    (result && !running) || (running && progressEntries.length > 0)

  return (
    <div className="modal-overlay" onClick={running ? undefined : onClose}>
      <div
        className="modal bulk-pull-modal"
        onClick={(e) => e.stopPropagation()}
        aria-busy={running}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-pull-title"
      >
        <div className="bulk-pull-header">
          <h2 id="bulk-pull-title" className="bulk-pull-title">
            Bulk git pull
          </h2>
          <button
            type="button"
            className="btn btn-sm bulk-pull-close-x"
            onClick={onClose}
            disabled={running}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p className="bulk-pull-description">
          Runs <code>git fetch origin</code>, checks out each repo’s default branch (
          <code>origin/HEAD</code>, else <code>main</code> or <code>master</code>), then{' '}
          <code>git pull --ff-only</code>. Repos with uncommitted changes are skipped for checkout until you stash or
          commit.
        </p>

        <label className="bulk-pull-filter-label">
          <input
            type="checkbox"
            checked={onlyWixRelated}
            onChange={(e) => setOnlyWixRelated(e.target.checked)}
            disabled={running}
          />
          Only repos whose <strong>origin</strong> URL contains <code>wix</code> (case-insensitive)
        </label>

        <label className="bulk-pull-extra-hint">
          Additional origin substrings (optional, comma-separated; OR-matched with “wix” when filter is on)
        </label>
        <input
          className="search-input bulk-pull-extra-input"
          placeholder="e.g. wixpress, my-org"
          value={extraSubs}
          onChange={(e) => setExtraSubs(e.target.value)}
          disabled={!onlyWixRelated || running}
        />

        {!onlyWixRelated && (
          <p className="bulk-pull-warning">
            All git folders under this workspace with an <code>origin</code> remote will be included.
          </p>
        )}

        {error && <p className="bulk-pull-error">{error}</p>}

        {showSummary && (
          <p className="bulk-pull-summary">
            {summarize(!running && result ? result.entries : progressEntries)}
          </p>
        )}

        {running && active && (
          <div className="bulk-pull-current" role="status" aria-live="polite">
            <div className="bulk-pull-spinner" aria-hidden />
            <div className="bulk-pull-current-text">
              <div className="bulk-pull-current-repo">{active.name}</div>
              <div className="bulk-pull-current-meta">
                {phaseLabel(active.phase)}
                {active.total > 0 && (
                  <>
                    {' '}
                    · {active.index} / {active.total}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="bulk-pull-results">
          {displayEntries.length === 0 && !running && (
            <div className="bulk-pull-empty-hint">Results appear here after you run a pull.</div>
          )}
          {displayEntries.map((e) => (
            <div key={e.path} className="bulk-pull-entry">
              <div className="bulk-pull-entry-row">
                <span
                  className={`bulk-pull-entry-status bulk-pull-entry-status--${e.status === 'ok' ? 'ok' : e.status === 'failed' ? 'failed' : 'skipped'}`}
                >
                  {e.status}
                </span>
                <span className="bulk-pull-entry-name">{e.name}</span>
                {e.branch != null && e.branch !== '' && (
                  <span className="bulk-pull-entry-branch">({e.branch})</span>
                )}
              </div>
              {e.detail && <span className="bulk-pull-entry-detail">{e.detail}</span>}
            </div>
          ))}
        </div>

        <div className="bulk-pull-actions">
          <button type="button" className="btn btn-sm" onClick={onClose} disabled={running}>
            Close
          </button>
          <button type="button" className="btn btn-sm btn-accent" onClick={run} disabled={running}>
            {running ? 'Running…' : result ? 'Run again' : 'Run pull'}
          </button>
        </div>
      </div>
    </div>
  )
}
