import React, { useEffect, useState, useRef, useCallback, memo } from 'react'
import { WorkspaceFolder } from '../../shared/types'

interface Props {
  scanPath: string
  onStartClaudeSession?: (folder: WorkspaceFolder, useWorktree: boolean) => void
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

interface GitInfo {
  gitBranch: string | null
  gitRemote: string | null
}

// Shared git info cache so data survives re-renders and tab switches
const gitCache = new Map<string, GitInfo>()

const FolderRow = memo(function FolderRow({
  folder,
  onStartClaudeSession,
  gitInfo,
}: {
  folder: WorkspaceFolder
  onStartClaudeSession?: (folder: WorkspaceFolder, useWorktree: boolean) => void
  gitInfo: GitInfo | null | undefined // null = loaded but no git, undefined = not loaded
}) {
  const handleOpenIde = (ide: 'cursor' | 'zed') => {
    window.api.openInIde(folder.path, ide)
  }

  const handleClaudeSession = () => {
    if (onStartClaudeSession) {
      const isGit = gitInfo != null && gitInfo.gitBranch !== null
      onStartClaudeSession(folder, isGit)
    }
  }

  const isGitRepo = gitInfo != null && gitInfo.gitBranch !== null

  return (
    <div className="folder-row">
      <div className="folder-info">
        <span className="folder-name">{folder.name}</span>
        <div className="folder-meta">
          {gitInfo === undefined ? (
            <span className="git-loading">...</span>
          ) : gitInfo === null || !gitInfo.gitBranch ? (
            <span className="no-git">no git</span>
          ) : (
            <>
              <span className="git-branch" title={`Branch: ${gitInfo.gitBranch}`}>
                <span className="git-icon">⎇</span> {gitInfo.gitBranch}
              </span>
              {gitInfo.gitRemote ? (
                <span
                  className="git-remote"
                  title={gitInfo.gitRemote}
                  onClick={() => window.api.openInBrowser(gitInfo.gitRemote!)}
                >
                  GitHub
                </span>
              ) : (
                <span className="git-local-only">local only</span>
              )}
            </>
          )}
          <span className="folder-modified">{timeAgo(folder.modifiedAt)}</span>
        </div>
      </div>
      <div className="folder-actions">
        <button
          className="btn btn-sm btn-ide claude-btn"
          onClick={handleClaudeSession}
          title={isGitRepo ? 'Open Claude in embedded terminal (with worktree)' : 'Open Claude in embedded terminal'}
        >
          Claude
        </button>
        <button
          className="btn btn-sm btn-ide cursor-btn"
          onClick={() => handleOpenIde('cursor')}
          title="Open in Cursor"
        >
          Cursor
        </button>
        <button
          className="btn btn-sm btn-ide zed-btn"
          onClick={() => handleOpenIde('zed')}
          title="Open in Zed (for Claude)"
        >
          Zed
        </button>
        <button
          className="btn btn-sm"
          onClick={() => window.api.openInTerminal(folder.path)}
          title="Open in Terminal"
        >
          Term
        </button>
        <button
          className="btn btn-sm"
          onClick={() => window.api.openInFinder(folder.path)}
          title="Open in Finder"
        >
          Finder
        </button>
      </div>
    </div>
  )
})

export function FoldersView({ scanPath, onStartClaudeSession }: Props) {
  const [folders, setFolders] = useState<WorkspaceFolder[]>([])
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'recent'>('name')
  const [loading, setLoading] = useState(true)
  const [gitInfoMap, setGitInfoMap] = useState<Map<string, GitInfo>>(new Map(gitCache))
  const listRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const loadingPaths = useRef<Set<string>>(new Set())

  useEffect(() => {
    setLoading(true)
    window.api.listWorkspaceFolders(scanPath).then((f) => {
      setFolders(f)
      setLoading(false)
    })
  }, [scanPath])

  // Load git info for a folder — called when row becomes visible
  const loadGitInfo = useCallback((path: string) => {
    if (gitCache.has(path) || loadingPaths.current.has(path)) return
    loadingPaths.current.add(path)
    window.api.getGitInfo(path).then((info) => {
      gitCache.set(path, info)
      loadingPaths.current.delete(path)
      setGitInfoMap(prev => {
        const next = new Map(prev)
        next.set(path, info)
        return next
      })
    })
  }, [])

  // IntersectionObserver: load git info only for visible rows
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const path = (entry.target as HTMLElement).dataset.folderPath
            if (path) loadGitInfo(path)
          }
        }
      },
      { root: listRef.current, rootMargin: '200px 0px' } // preload 200px ahead
    )
    return () => observerRef.current?.disconnect()
  }, [loadGitInfo])

  // Re-observe when filtered list changes
  const observeRow = useCallback((el: HTMLDivElement | null) => {
    if (el && observerRef.current) {
      observerRef.current.observe(el)
    }
  }, [])

  const filtered = folders
    .filter((f) => !search || f.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'recent') {
        return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
      }
      return a.name.localeCompare(b.name)
    })

  if (loading) {
    return (
      <div className="folders-view">
        <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading folders...</div>
      </div>
    )
  }

  return (
    <div className="folders-view">
      <div className="folders-toolbar">
        <input
          className="search-input"
          placeholder="Filter folders..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />
        <button
          className={`btn btn-sm ${sortBy === 'name' ? 'btn-accent' : ''}`}
          onClick={() => setSortBy('name')}
        >
          A-Z
        </button>
        <button
          className={`btn btn-sm ${sortBy === 'recent' ? 'btn-accent' : ''}`}
          onClick={() => setSortBy('recent')}
        >
          Recent
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {filtered.length} folders
        </span>
      </div>

      <div className="folders-list" ref={listRef}>
        {filtered.map((folder) => (
          <div key={folder.path} ref={observeRow} data-folder-path={folder.path}>
            <FolderRow
              folder={folder}
              onStartClaudeSession={onStartClaudeSession}
              gitInfo={gitInfoMap.has(folder.path) ? gitInfoMap.get(folder.path)! : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
