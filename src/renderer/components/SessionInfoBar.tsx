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
  onShowDiff: () => void
  onShowFiles: () => void
}

export function SessionInfoBar({ folderName, folderPath, worktreePath, branchName, onShowDiff, onShowFiles }: Props) {
  const [git, setGit] = useState<GitStatus | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

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
  const shortBranch = branch && branch.length > 40 ? branch.slice(0, 37) + '...' : branch

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
        {git.commitsAhead > 0 && (
          <span className="sib-commits" title={`${git.commitsAhead} commits ahead of origin/${git.baseBranch}`}>
            {git.commitsAhead} ahead
          </span>
        )}
        {git.baseBranch && git.commitsAhead > 0 && (
          <span className="sib-base">vs origin/{git.baseBranch}</span>
        )}
      </div>

      <div className="sib-stats">
        {git.filesChanged > 0 && (
          <span className="sib-stat" title={`${git.filesChanged} files changed vs ${git.baseBranch}`}>
            {git.filesChanged} files
          </span>
        )}
        {git.insertions > 0 && (
          <span className="sib-stat sib-plus" title={`${git.insertions} lines added`}>+{git.insertions}</span>
        )}
        {git.deletions > 0 && (
          <span className="sib-stat sib-minus" title={`${git.deletions} lines removed`}>-{git.deletions}</span>
        )}
        {git.uncommitted > 0 && (
          <span className="sib-stat sib-uncommitted" title={`${git.uncommitted} uncommitted files`}>
            {git.uncommitted} uncommitted
          </span>
        )}
      </div>

      <div className="sib-actions">
        <button className="btn btn-sm" onClick={onShowDiff} title="Show diff">
          Show Diff
        </button>
        {git.uncommitted > 0 && (
          <button className="btn btn-sm" onClick={onShowDiff} title="View uncommitted changes">
            Uncommitted
          </button>
        )}
        {git.commitsAhead > 0 && git.remote && (
          <button
            className="btn btn-sm sib-btn-push"
            onClick={() => copyToClipboard(`cd "${cwd}" && git push -u origin ${branch}`, 'push')}
            title="Copy push command"
          >
            {copied === 'push' ? 'Copied!' : 'Push'}
          </button>
        )}
        {git.commitsAhead > 0 && git.remote && (
          <button
            className="btn btn-sm sib-btn-pr"
            onClick={() => copyToClipboard(`cd "${cwd}" && git push -u origin ${branch} && gh pr create --fill`, 'pr')}
            title="Copy push & create PR command"
          >
            {copied === 'pr' ? 'Copied!' : 'Push & Create PR'}
          </button>
        )}
        {git.baseBranch && git.commitsAhead > 0 && (
          <button
            className="btn btn-sm"
            onClick={() => copyToClipboard(`cd "${folderPath}" && git merge ${branch}`, 'merge')}
            title="Copy merge command to apply to base branch"
          >
            {copied === 'merge' ? 'Copied!' : 'Merge'}
          </button>
        )}
        <button className="btn btn-sm" onClick={onShowFiles} title="Show files">
          Files
        </button>
        <button className="btn btn-sm sib-btn-refresh" onClick={refresh} title="Refresh git status">
          &#8635;
        </button>
      </div>
    </div>
  )
}
