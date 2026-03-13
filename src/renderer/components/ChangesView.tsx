import React, { useState, useEffect } from 'react'

interface Props {
  worktreePath: string
  onClose: () => void
}

function DiffLine({ line }: { line: string }) {
  let className = 'diff-line'
  if (line.startsWith('+') && !line.startsWith('+++')) className += ' diff-add'
  else if (line.startsWith('-') && !line.startsWith('---')) className += ' diff-remove'
  else if (line.startsWith('@@')) className += ' diff-hunk'
  else if (line.startsWith('diff ')) className += ' diff-header'
  return <div className={className}>{line}</div>
}

export function ChangesView({ worktreePath, onClose }: Props) {
  const [stat, setStat] = useState<string>('')
  const [diff, setDiff] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    window.api.getWorktreeDiff(worktreePath).then((result) => {
      if (result.error) {
        setError(result.error)
      } else if (result.diff) {
        const parts = result.diff.split('---FULL---\n')
        setStat(parts[0]?.trim() || '')
        setDiff(parts[1]?.trim() || '')
      } else {
        setStat('No changes')
      }
      setLoading(false)
    })
  }, [worktreePath])

  const refresh = () => {
    setLoading(true)
    window.api.getWorktreeDiff(worktreePath).then((result) => {
      if (result.error) {
        setError(result.error)
      } else if (result.diff) {
        const parts = result.diff.split('---FULL---\n')
        setStat(parts[0]?.trim() || '')
        setDiff(parts[1]?.trim() || '')
      }
      setLoading(false)
    })
  }

  return (
    <div className="changes-view">
      <div className="cv-header">
        <span className="cv-title">Changes</span>
        <button className="btn btn-sm" onClick={refresh} disabled={loading}>Refresh</button>
        <button className="cv-close" onClick={onClose}>×</button>
      </div>
      <div className="cv-content">
        {loading ? (
          <div className="cv-loading">Loading diff...</div>
        ) : error ? (
          <div className="cv-error">{error}</div>
        ) : !diff && !stat ? (
          <div className="cv-empty">No changes detected</div>
        ) : (
          <>
            {stat && (
              <div className="cv-stat">
                <pre>{stat}</pre>
              </div>
            )}
            {diff && (
              <div className="cv-diff">
                {diff.split('\n').map((line, i) => (
                  <DiffLine key={i} line={line} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
