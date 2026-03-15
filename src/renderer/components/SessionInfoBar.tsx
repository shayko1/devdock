import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'

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
  const [branchOpen, setBranchOpen] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [branchFilter, setBranchFilter] = useState('')
  const [branchDropdownPos, setBranchDropdownPos] = useState({ top: 0, left: 0 })
  const branchToggleRef = useRef<HTMLSpanElement>(null)
  const branchDropdownRef = useRef<HTMLDivElement>(null)

  const cwd = worktreePath || folderPath

  const refresh = useCallback(async () => {
    try {
      const status = await window.api.getGitStatus(cwd)
      setGit(status)
    } catch { /* ignore */ }
  }, [cwd])

  const loadBranches = useCallback(async () => {
    try {
      const info = await window.api.listBranches(cwd)
      setBranches(info.branches)
    } catch { /* ignore */ }
  }, [cwd])

  useEffect(() => {
    refresh()
    loadBranches()
    const interval = setInterval(refresh, 10000)
    return () => clearInterval(interval)
  }, [refresh, loadBranches])

  useEffect(() => {
    if (!branchOpen) return
    const handler = (e: MouseEvent) => {
      if (
        branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node) &&
        branchToggleRef.current && !branchToggleRef.current.contains(e.target as Node)
      ) {
        setBranchOpen(false)
        setBranchFilter('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [branchOpen])

  const handleCheckout = useCallback(async (branch: string) => {
    setBranchOpen(false)
    setBranchFilter('')
    const result = await window.api.checkoutBranch(cwd, branch)
    if (result.success) {
      refresh()
      loadBranches()
    } else {
      alert(result.error || 'Failed to switch branch')
    }
  }, [cwd, refresh, loadBranches])

  const openBranchDropdown = useCallback(() => {
    if (branchToggleRef.current) {
      const rect = branchToggleRef.current.getBoundingClientRect()
      setBranchDropdownPos({ top: rect.bottom + 4, left: rect.left })
    }
    setBranchOpen(prev => !prev)
    setBranchFilter('')
  }, [])

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
            ref={branchToggleRef}
            className="sib-branch sib-branch-clickable"
            onClick={branches.length > 1 ? openBranchDropdown : () => copyToClipboard(branch, 'branch')}
            title={branches.length > 1 ? `${branch}\nClick to switch branch` : `${branch}\nClick to copy`}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, opacity: 0.6 }}>
              <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z"/>
            </svg>
            {shortBranch}
            {branches.length > 1 && (
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, opacity: 0.4 }}>
                <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z"/>
              </svg>
            )}
            {copied === 'branch' && <span className="sib-copied">Copied</span>}
          </span>
        )}
        {branchOpen && branches.length > 1 && createPortal(
          <div
            ref={branchDropdownRef}
            className="branch-dropdown"
            style={{ top: branchDropdownPos.top, left: branchDropdownPos.left }}
          >
            {branches.length > 5 && (
              <input
                className="branch-search"
                placeholder="Filter branches..."
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                autoFocus
              />
            )}
            <div className="branch-list">
              {branches.filter(b => b !== (branchName || git?.branch) && b.toLowerCase().includes(branchFilter.toLowerCase())).map(b => (
                <button key={b} className="branch-item" onClick={() => handleCheckout(b)}>
                  {b}
                </button>
              ))}
              {branches.filter(b => b !== (branchName || git?.branch) && b.toLowerCase().includes(branchFilter.toLowerCase())).length === 0 && (
                <div className="branch-empty">No matching branches</div>
              )}
            </div>
          </div>,
          document.body
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
