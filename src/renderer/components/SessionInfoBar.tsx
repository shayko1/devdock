import React, { useState, useEffect, useCallback } from 'react'

interface GitStatus {
  branch: string | null
  baseBranch: string | null
  remote: string | null
  filesChanged: number
  insertions: number
  deletions: number
  commitsAhead: number
  uncommitted: number
  isGitRepo: boolean
}

interface Props {
  folderName: string
  folderPath: string
  worktreePath: string | null
  branchName: string | null
  rtkAvailable: boolean
  rtkDisabled: boolean
  onToggleRtk: () => void
  onShowDiff: () => void
  onShowFiles: () => void
}

export function SessionInfoBar({ folderName, folderPath, worktreePath, branchName, rtkAvailable, rtkDisabled, onToggleRtk, onShowDiff, onShowFiles }: Props) {
  const [git, setGit] = useState<GitStatus | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [showActions, setShowActions] = useState(false)

  const cwd = worktreePath || folderPath

  const refresh = useCallback(async () => {
    try {
      const status = await window.api.getGitStatus(cwd)
      setGit(status)
    } catch { /* ignore */ }
  }, [cwd])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 10000)
    return () => clearInterval(interval)
  }, [refresh])

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 1500)
  }, [])

  if (!git || !git.isGitRepo) return null

  const branch = branchName || git.branch
  const shortBranch = branch && branch.length > 35 ? branch.slice(0, 32) + '...' : branch

  return (
    <div className="session-info-bar">
      <div className="sib-left">
        <span className="sib-folder">{folderName}</span>
        {branch && (
          <span
            className="sib-branch"
            onClick={() => copyToClipboard(branch, 'branch')}
            title={`${branch}\nClick to copy`}
          >
            {shortBranch}
            {copied === 'branch' && <span className="sib-copied">Copied</span>}
          </span>
        )}
      </div>

      <div className="sib-stats">
        {git.commitsAhead > 0 && (
          <span className="sib-stat" title={`${git.commitsAhead} commits ahead of origin/${git.baseBranch}`}>
            {git.commitsAhead} ahead
          </span>
        )}
        {git.filesChanged > 0 && (
          <span className="sib-stat sib-plus" title={`${git.filesChanged} files, +${git.insertions} -${git.deletions}`}>
            {git.filesChanged} files <span className="sib-plus">+{git.insertions}</span> <span className="sib-minus">-{git.deletions}</span>
          </span>
        )}
        {git.uncommitted > 0 && (
          <span className="sib-stat sib-uncommitted" title={`${git.uncommitted} uncommitted`}>
            {git.uncommitted} uncommitted
          </span>
        )}
      </div>

      <div className="sib-actions">
        {rtkAvailable && (
          <button
            className={`btn btn-sm ${!rtkDisabled ? 'sib-btn-rtk-on' : ''}`}
            onClick={onToggleRtk}
            title={rtkDisabled ? 'RTK OFF — click to enable' : 'RTK ON — click to disable'}
            style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', background: !rtkDisabled ? 'var(--green)' : undefined, color: !rtkDisabled ? '#000' : undefined }}
          >
            RTK
          </button>
        )}
        {(git.filesChanged > 0 || git.uncommitted > 0) && (
          <button className="btn btn-sm" onClick={onShowDiff} title="Show diff & changes">
            Diff
          </button>
        )}
        {git.commitsAhead > 0 && git.remote && (
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-sm sib-btn-push"
              onClick={() => setShowActions(!showActions)}
              title="Git actions"
            >
              Git ▾
            </button>
            {showActions && (
              <div className="sib-dropdown" onMouseLeave={() => setShowActions(false)}>
                <button onClick={() => { copyToClipboard(`cd "${cwd}" && git push -u origin ${branch}`, 'push'); setShowActions(false) }}>
                  {copied === 'push' ? '✓ Copied!' : 'Copy: Push'}
                </button>
                <button onClick={() => { copyToClipboard(`cd "${cwd}" && git push -u origin ${branch} && gh pr create --fill`, 'pr'); setShowActions(false) }}>
                  {copied === 'pr' ? '✓ Copied!' : 'Copy: Push & Create PR'}
                </button>
                {git.baseBranch && (
                  <button onClick={() => { copyToClipboard(`cd "${folderPath}" && git merge ${branch}`, 'merge'); setShowActions(false) }}>
                    {copied === 'merge' ? '✓ Copied!' : 'Copy: Merge to base'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <button className="btn btn-sm sib-btn-refresh" onClick={refresh} title="Refresh">&#8635;</button>
      </div>
    </div>
  )
}
