import React, { useEffect, useMemo, useState } from 'react'
import type { BulkGitPullResult, BulkGitPullResultEntry } from '../../shared/ipc-types'

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

export function BulkGitPullModal({ scanPath, onClose }: Props) {
  const [onlyWixRelated, setOnlyWixRelated] = useState(true)
  const [extraSubs, setExtraSubs] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<BulkGitPullResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const extraList = useMemo(() => parseExtraSubs(extraSubs), [extraSubs])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !running) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, running])

  const run = async () => {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await window.api.bulkGitPullWorkspace(scanPath, {
        onlyWixRelated,
        extraRemoteSubstrings: extraList,
      })
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
            gap: 12,
            marginBottom: 4,
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Bulk git pull</h2>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onClose}
            aria-label="Close"
            style={{ fontSize: 16, lineHeight: 1, padding: '2px 8px' }}
          >
            ×
          </button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
          Runs <code style={{ fontSize: 12 }}>git fetch origin</code>, checks out each repo’s default branch
          (<code style={{ fontSize: 12 }}>origin/HEAD</code>, else <code style={{ fontSize: 12 }}>main</code> or{' '}
          <code style={{ fontSize: 12 }}>master</code>), then <code style={{ fontSize: 12 }}>git pull --ff-only</code>.
          Repos with local changes that block checkout will fail until you stash or commit.
        </p>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={onlyWixRelated}
            onChange={(e) => setOnlyWixRelated(e.target.checked)}
          />
          Only repos whose <strong>origin</strong> URL contains <code style={{ fontSize: 12 }}>wix</code> (case-insensitive)
        </label>

        <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
          Additional origin substrings (optional, comma-separated; OR-matched with “wix” when filter is on)
        </label>
        <input
          className="search-input"
          placeholder="e.g. wixpress, my-org"
          value={extraSubs}
          onChange={(e) => setExtraSubs(e.target.value)}
          disabled={!onlyWixRelated}
          style={{ marginBottom: 12 }}
        />

        {!onlyWixRelated && (
          <p style={{ fontSize: 12, color: 'var(--orange)', margin: '0 0 12px' }}>
            All git folders under this workspace with an <code style={{ fontSize: 11 }}>origin</code> remote will be
            included.
          </p>
        )}

        {error && (
          <p style={{ fontSize: 13, color: 'var(--red)', marginBottom: 8 }}>{error}</p>
        )}

        {result && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{summarize(result.entries)}</p>
        )}

        <div
          style={{
            flex: 1,
            minHeight: 120,
            maxHeight: 320,
            overflow: 'auto',
            border: '1px solid var(--border)',
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 12,
          }}
        >
          {result?.entries.map((e) => (
            <div
              key={e.path}
              style={{
                padding: '6px 10px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontWeight: 600,
                    color:
                      e.status === 'ok'
                        ? 'var(--green)'
                        : e.status === 'failed'
                          ? 'var(--red)'
                          : 'var(--text-muted)',
                  }}
                >
                  {e.status}
                </span>
                <span style={{ fontWeight: 500 }}>{e.name}</span>
                {e.branch != null && e.branch !== '' && (
                  <span style={{ color: 'var(--text-muted)' }}>({e.branch})</span>
                )}
              </div>
              {e.detail && <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-word' }}>{e.detail}</span>}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
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
