import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useAppState } from './hooks/useAppState'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { Sidebar } from './components/Sidebar'
import { ProjectCard } from './components/ProjectCard'
import { EditProjectModal } from './components/EditProjectModal'
import { LogPanel } from './components/LogPanel'
import { FoldersView } from './components/FoldersView'
import { ClaudeSessionsView } from './components/ClaudeSessionsView'
import { NewSessionModal } from './components/NewSessionModal'
import { ShortcutsHelp } from './components/ShortcutsHelp'
import { SettingsModal } from './components/SettingsModal'
import { Toast } from './components/Toast'
import { AgentsView } from './components/AgentsView'
import { Project, WorkspaceFolder } from '../shared/types'

type TabId = 'launchpad' | 'folders' | 'claude' | 'agents'

interface ClaudeSession {
  id: string
  folderName: string
  folderPath: string
  worktreePath: string | null
  branchName: string | null
  exited?: boolean
  claudeSessionId?: string | null
  dangerousMode?: boolean
  pendingRecap?: boolean
}

export function App() {
  const {
    state,
    statuses,
    logs,
    systemRunningMap,
    loaded,
    persist,
    scanWorkspace,
    updateProject,
    removeProject,
    startProject,
    stopProject,
    killSystemPortProcess,
    bulkHideProjects,
    bulkRemoveProjects,
    refreshSystemPorts
  } = useAppState()

  const [activeTab, setActiveTab] = useState<TabId>('launchpad')
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [bulkSelection, setBulkSelection] = useState<Set<string>>(new Set())
  const [bulkMode, setBulkMode] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showNewSession, setShowNewSession] = useState(false)
  const [claudeSessions, setClaudeSessions] = useState<ClaudeSession[]>([])
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>(() => {
    return (localStorage.getItem('devdock-theme') as 'dark' | 'light' | 'system') || 'dark'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('devdock-theme', theme)
  }, [theme])

  // Auto-resume sessions on startup
  const autoResumeRef = useRef(false)
  useEffect(() => {
    if (autoResumeRef.current) return
    autoResumeRef.current = true
    localStorage.removeItem('devdock-claude-sessions')

    const restoreSessions = async () => {
      const saved = await window.api.activeSessionsGetAll()
      if (saved.length === 0) return
      setActiveTab('claude')
      for (const rec of saved) {
        const newId = `claude-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
        try {
          const result = await window.api.ptyCreate({
            sessionId: newId,
            folderName: rec.folderName,
            folderPath: rec.folderPath,
            useWorktree: false,
            resumeClaudeId: rec.claudeSessionId || undefined,
            existingWorktreePath: rec.worktreePath || undefined,
            dangerousMode: rec.dangerousMode,
          })
          if (result.success) {
            setClaudeSessions(prev => [...prev, {
              id: newId,
              folderName: result.folderName || rec.folderName,
              folderPath: rec.folderPath,
              worktreePath: result.worktreePath ?? rec.worktreePath,
              branchName: result.branchName ?? rec.branchName,
              claudeSessionId: rec.claudeSessionId ?? null,
              dangerousMode: rec.dangerousMode,
            }])
            // Replace old entry with new PTY id
            window.api.activeSessionsRemove(rec.id)
            window.api.activeSessionsSet({
              id: newId,
              claudeSessionId: rec.claudeSessionId,
              folderName: rec.folderName,
              folderPath: rec.folderPath,
              worktreePath: rec.worktreePath,
              branchName: rec.branchName,
              dangerousMode: rec.dangerousMode,
            })
          } else {
            window.api.activeSessionsRemove(rec.id)
          }
        } catch {
          window.api.activeSessionsRemove(rec.id)
        }
      }
    }
    restoreSessions()
  }, [])

  // Listen for PTY exits
  useEffect(() => {
    const unsub = window.api.onPtyExit(({ sessionId }) => {
      setClaudeSessions(prev => prev.map(s => s.id === sessionId ? { ...s, exited: true } : s))
    })
    return unsub
  }, [])

  const handleStartClaudeSession = useCallback(async (folder: WorkspaceFolder, useWorktree: boolean) => {
    const sessionId = `claude-${Date.now().toString(36)}`
    const isDangerous = state.dangerousMode ?? false
    try {
      const result = await window.api.ptyCreate({
        sessionId,
        folderName: folder.name,
        folderPath: folder.path,
        useWorktree,
        dangerousMode: isDangerous
      })
      if (result.success) {
        const newSession: ClaudeSession = {
          id: sessionId,
          folderName: result.folderName || folder.name,
          folderPath: folder.path,
          worktreePath: result.worktreePath ?? null,
          branchName: result.branchName ?? null,
          claudeSessionId: null,
          dangerousMode: isDangerous
        }
        setClaudeSessions(prev => [...prev, newSession])
        setShowNewSession(false)
        setActiveTab('claude')

        // Track for auto-resume
        window.api.activeSessionsSet({
          id: sessionId,
          claudeSessionId: null,
          folderName: newSession.folderName,
          folderPath: newSession.folderPath,
          worktreePath: newSession.worktreePath,
          branchName: newSession.branchName,
          dangerousMode: isDangerous,
        })

        // Detect Claude's internal session ID after it starts
        const cwd = result.worktreePath || folder.path
        const detectId = async () => {
          for (let attempt = 0; attempt < 6; attempt++) {
            await new Promise(r => setTimeout(r, 3000))
            const { sessionId: claudeId } = await window.api.detectClaudeSessionId(cwd)
            if (claudeId) {
              setClaudeSessions(prev => prev.map(s =>
                s.id === sessionId ? { ...s, claudeSessionId: claudeId } : s
              ))
              window.api.activeSessionsUpdateClaudeId(sessionId, claudeId)
              return
            }
          }
        }
        detectId()
      } else {
        alert(`Failed to create session: ${result.error}`)
      }
    } catch (err) {
      alert(`Error creating session: ${err}`)
    }
  }, [state.dangerousMode])

  const handleResumeClaudeSession = useCallback(async (sessionId: string) => {
    const session = claudeSessions.find(s => s.id === sessionId)
    if (!session || !session.claudeSessionId) return

    const newPtyId = `claude-${Date.now().toString(36)}`
    try {
      const result = await window.api.ptyCreate({
        sessionId: newPtyId,
        folderName: session.folderName,
        folderPath: session.folderPath,
        useWorktree: false,
        resumeClaudeId: session.claudeSessionId,
        existingWorktreePath: session.worktreePath || undefined,
        dangerousMode: session.dangerousMode
      })
      if (result.success) {
        setClaudeSessions(prev => prev.map(s =>
          s.id === sessionId
            ? { ...s, id: newPtyId, exited: false, worktreePath: result.worktreePath ?? s.worktreePath, branchName: result.branchName ?? s.branchName }
            : s
        ))

        window.api.activeSessionsRemove(sessionId)
        window.api.activeSessionsSet({
          id: newPtyId,
          claudeSessionId: session.claudeSessionId,
          folderName: session.folderName,
          folderPath: session.folderPath,
          worktreePath: result.worktreePath ?? session.worktreePath,
          branchName: result.branchName ?? session.branchName,
          dangerousMode: session.dangerousMode,
        })

        const cwd = session.worktreePath || session.folderPath
        const detectId = async () => {
          for (let attempt = 0; attempt < 6; attempt++) {
            await new Promise(r => setTimeout(r, 3000))
            const { sessionId: claudeId } = await window.api.detectClaudeSessionId(cwd)
            if (claudeId && claudeId !== session.claudeSessionId) {
              setClaudeSessions(prev => prev.map(s =>
                s.id === newPtyId ? { ...s, claudeSessionId: claudeId } : s
              ))
              window.api.activeSessionsUpdateClaudeId(newPtyId, claudeId)
              return
            }
          }
        }
        detectId()
      } else {
        alert(`Failed to resume session: ${result.error}`)
      }
    } catch (err) {
      alert(`Error resuming session: ${err}`)
    }
  }, [claudeSessions])

  const handleOpenPipelineSession = useCallback(async (pipelineFolderName: string, pipelineFolderPath: string, worktreePath: string) => {
    const sessionId = `claude-${Date.now().toString(36)}`
    const isDangerous = state.dangerousMode ?? false
    try {
      const result = await window.api.ptyCreate({
        sessionId,
        folderName: pipelineFolderName,
        folderPath: pipelineFolderPath,
        useWorktree: false,
        existingWorktreePath: worktreePath,
        dangerousMode: isDangerous
      })
      if (result.success) {
        const newSession: ClaudeSession = {
          id: sessionId,
          folderName: result.folderName || pipelineFolderName,
          folderPath: pipelineFolderPath,
          worktreePath: result.worktreePath ?? worktreePath,
          branchName: result.branchName ?? null,
          claudeSessionId: null,
          dangerousMode: isDangerous
        }
        setClaudeSessions(prev => [...prev, newSession])
        setActiveTab('claude')

        window.api.activeSessionsSet({
          id: sessionId,
          claudeSessionId: null,
          folderName: newSession.folderName,
          folderPath: newSession.folderPath,
          worktreePath: newSession.worktreePath,
          branchName: newSession.branchName,
          dangerousMode: isDangerous,
        })

        const cwd = worktreePath
        const detectId = async () => {
          for (let attempt = 0; attempt < 6; attempt++) {
            await new Promise(r => setTimeout(r, 3000))
            const { sessionId: claudeId } = await window.api.detectClaudeSessionId(cwd)
            if (claudeId) {
              setClaudeSessions(prev => prev.map(s =>
                s.id === sessionId ? { ...s, claudeSessionId: claudeId } : s
              ))
              window.api.activeSessionsUpdateClaudeId(sessionId, claudeId)
              return
            }
          }
        }
        detectId()
      }
    } catch (err) {
      alert(`Error opening pipeline session: ${err}`)
    }
  }, [state.dangerousMode])

  // Resume any session from history (called by SessionHistory panel)
  const handleResumeFromHistory = useCallback(async (claudeSessionId: string, folderName: string, folderPath: string, worktreePath?: string | null) => {
    // Check if already open
    if (claudeSessions.some(s => s.claudeSessionId === claudeSessionId && !s.exited)) return

    const newId = `claude-${Date.now().toString(36)}`
    const isDangerous = state.dangerousMode ?? false
    try {
      const result = await window.api.ptyCreate({
        sessionId: newId,
        folderName,
        folderPath,
        useWorktree: false,
        resumeClaudeId: claudeSessionId,
        existingWorktreePath: worktreePath || undefined,
        dangerousMode: isDangerous,
      })
      if (result.success) {
        const newSession: ClaudeSession = {
          id: newId,
          folderName: result.folderName || folderName,
          folderPath,
          worktreePath: result.worktreePath ?? worktreePath ?? null,
          branchName: result.branchName ?? null,
          claudeSessionId,
          dangerousMode: isDangerous,
          pendingRecap: true,
        }
        setClaudeSessions(prev => [...prev, newSession])
        setActiveTab('claude')

        window.api.activeSessionsSet({
          id: newId,
          claudeSessionId,
          folderName,
          folderPath,
          worktreePath: newSession.worktreePath,
          branchName: newSession.branchName,
          dangerousMode: isDangerous,
        })
      } else {
        alert(`Failed to resume: ${result.error}`)
      }
    } catch (err) {
      alert(`Error resuming from history: ${err}`)
    }
  }, [claudeSessions, state.dangerousMode])

  const handleCloseClaudeSession = useCallback(async (sessionId: string) => {
    const session = claudeSessions.find(s => s.id === sessionId)
    await window.api.ptyDestroy(sessionId)

    if (session?.worktreePath) {
      const keep = confirm(
        `Session "${session.folderName}" used a git worktree.\n\n` +
        `Keep the worktree branch for later?\n\n` +
        `• OK = Keep worktree (you can use it later)\n` +
        `• Cancel = Delete worktree and branch`
      )
      if (!keep) {
        await window.api.cleanupWorktree(session.worktreePath, session.folderPath || '')
      }
    }

    // Remove from active sessions — will NOT auto-resume
    window.api.activeSessionsRemove(sessionId)
    setClaudeSessions(prev => prev.filter(s => s.id !== sessionId))
  }, [claudeSessions])

  const searchRef = useRef<HTMLInputElement>(null)

  const showToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToast({ message, type })
  }, [])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onSearch: () => {
      if (activeTab === 'launchpad') {
        searchRef.current?.focus()
      }
    },
    onTab1: () => setActiveTab('launchpad'),
    onTab2: () => setActiveTab('folders'),
    onTab3: () => setActiveTab('claude'),
    onTab4: () => setActiveTab('agents'),
    onEscape: () => {
      // Don't close modals if user is typing in an input inside the modal
      const active = document.activeElement as HTMLElement | null
      const isTypingInModal = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && active.closest('.modal')
      if (isTypingInModal) {
        (active as HTMLElement).blur()
        return
      }
      if (showHelp) { setShowHelp(false); return }
      if (editingProject) { setEditingProject(null); return }
      if (bulkMode) { setBulkMode(false); setBulkSelection(new Set()); return }
      if (search) { setSearch(''); return }
      searchRef.current?.blur()
    },
    onHelp: () => setShowHelp(true)
  })

  // Branch state: { projectId -> { current, branches } }
  const [branchMap, setBranchMap] = useState<Map<string, { current: string | null; branches: string[] }>>(new Map())

  const refreshBranches = useCallback(async (projects?: Project[]) => {
    const list = projects ?? state.projects
    const visible = list.filter(p => !p.hidden)
    const results = await Promise.all(
      visible.map(async (p) => {
        try {
          const info = await window.api.listBranches(p.path)
          return [p.id, info] as const
        } catch {
          return [p.id, { current: null, branches: [] }] as const
        }
      })
    )
    setBranchMap(new Map(results))
  }, [state.projects])

  useEffect(() => {
    if (loaded && state.projects.length > 0) {
      refreshBranches()
    }
  }, [loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCheckoutBranch = useCallback(async (projectId: string, branch: string) => {
    const project = state.projects.find(p => p.id === projectId)
    if (!project) return
    const result = await window.api.checkoutBranch(project.path, branch)
    if (result.success) {
      setBranchMap(prev => {
        const next = new Map(prev)
        const existing = next.get(projectId)
        next.set(projectId, { current: branch, branches: existing?.branches ?? [branch] })
        return next
      })
      showToast(`Switched to ${branch}`, 'success')
    } else {
      showToast(result.error || 'Failed to switch branch', 'error')
    }
  }, [state.projects, showToast])

  const handleScan = useCallback(async () => {
    setScanning(true)
    try {
      const count = await scanWorkspace()
      refreshSystemPorts()
      refreshBranches()
      if (count > 0) {
        showToast(`Found ${count} new project${count > 1 ? 's' : ''}`, 'success')
      } else {
        showToast('No new projects found', 'info')
      }
    } finally {
      setScanning(false)
    }
  }, [scanWorkspace, refreshSystemPorts, refreshBranches, showToast])

  const filteredProjects = useMemo(() => {
    let projects = state.projects

    switch (activeFilter) {
      case 'all':
        projects = projects.filter((p) => !p.hidden)
        break
      case 'running':
        projects = projects.filter((p) => statuses.has(p.id))
        break
      case 'system-running':
        projects = projects.filter((p) => systemRunningMap.has(p.id))
        break
      case 'hidden':
        projects = projects.filter((p) => p.hidden)
        break
      case 'untagged':
        projects = projects.filter((p) => !p.hidden && p.tags.length === 0)
        break
      case 'no-command':
        projects = projects.filter((p) => !p.hidden && !p.runCommand)
        break
      default:
        if (activeFilter.startsWith('tag:')) {
          const tag = activeFilter.slice(4)
          projects = projects.filter((p) => !p.hidden && p.tags.includes(tag))
        }
    }

    if (search) {
      const q = search.toLowerCase()
      projects = projects.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.path.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)) ||
          p.techStack.some((t) => t.toLowerCase().includes(q))
      )
    }

    return projects
  }, [state.projects, activeFilter, search, statuses, systemRunningMap])

  const runningCount = statuses.size
  const systemRunningCount = systemRunningMap.size
  const noCommandCount = state.projects.filter((p) => !p.hidden && !p.runCommand).length

  const selectedProject = state.projects.find((p) => p.id === selectedProjectId) || null
  const selectedLogs = selectedProjectId ? logs.get(selectedProjectId) || [] : []

  const handleOpenBrowser = (projectId: string) => {
    const project = state.projects.find((p) => p.id === projectId)
    const status = statuses.get(projectId)
    if (status?.port) {
      window.api.openInBrowser(`http://localhost:${status.port}`)
    } else if (project && systemRunningMap.has(project.id)) {
      window.api.openInBrowser(`http://localhost:${systemRunningMap.get(project.id)!.port}`)
    }
  }

  const handleCardClick = (projectId: string) => {
    if (bulkMode) {
      setBulkSelection((prev) => {
        const next = new Set(prev)
        if (next.has(projectId)) next.delete(projectId)
        else next.add(projectId)
        return next
      })
    } else {
      setSelectedProjectId(projectId)
    }
  }

  const handleBulkHide = () => {
    const count = bulkSelection.size
    bulkHideProjects([...bulkSelection])
    setBulkSelection(new Set())
    setBulkMode(false)
    showToast(`Hidden ${count} project${count > 1 ? 's' : ''}`, 'success')
  }

  const handleBulkRemove = () => {
    const count = bulkSelection.size
    bulkRemoveProjects([...bulkSelection])
    setBulkSelection(new Set())
    setBulkMode(false)
    showToast(`Removed ${count} project${count > 1 ? 's' : ''}`, 'success')
  }

  if (!loaded) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <span style={{ color: 'var(--text-muted)' }}>Loading...</span>
      </div>
    )
  }

  return (
    <>
      <div className="titlebar">
        <span className="titlebar-logo">DD</span>
        DevDock
        <div className="theme-switcher">
          <button className={`theme-btn ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')} title="Light mode">☀</button>
          <button className={`theme-btn ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')} title="Dark mode">☾</button>
          <button className={`theme-btn ${theme === 'system' ? 'active' : ''}`} onClick={() => setTheme('system')} title="Auto (system)">◐</button>
          <button
            className="theme-btn"
            onClick={() => setShowSettings(true)}
            title="Settings"
            style={{ marginLeft: 8 }}
          >
            ⚙
          </button>
        </div>
        <span className="titlebar-shortcut-hint" onClick={() => setShowHelp(true)}>
          <kbd>?</kbd> shortcuts
        </span>
      </div>

      <div className="tabs-bar">
        <div
          className={`tab ${activeTab === 'launchpad' ? 'active' : ''}`}
          onClick={() => setActiveTab('launchpad')}
        >
          Launchpad
          {runningCount > 0 && <span style={{ marginLeft: 6, color: 'var(--green)', fontSize: 11 }}>{runningCount}</span>}
        </div>
        <div
          className={`tab ${activeTab === 'folders' ? 'active' : ''}`}
          onClick={() => setActiveTab('folders')}
        >
          All Folders
        </div>
        <div
          className={`tab ${activeTab === 'claude' ? 'active' : ''}`}
          onClick={() => setActiveTab('claude')}
        >
          Claude
          {claudeSessions.length > 0 && (
            <span style={{ marginLeft: 6, color: 'var(--orange)', fontSize: 11 }}>{claudeSessions.length}</span>
          )}
        </div>
        <div
          className={`tab ${activeTab === 'agents' ? 'active' : ''}`}
          onClick={() => setActiveTab('agents')}
        >
          Agents
        </div>
      </div>

      {activeTab === 'agents' ? (
        <AgentsView />
      ) : activeTab === 'claude' ? (
        <ClaudeSessionsView
          sessions={claudeSessions}
          rtkEnabled={state.rtkEnabled ?? false}
          chatInputEnabled={state.chatInputEnabled ?? true}
          onNewSession={() => setShowNewSession(true)}
          onCloseSession={handleCloseClaudeSession}
          onResumeSession={handleResumeClaudeSession}
          onResumeFromHistory={handleResumeFromHistory}
          onOpenPipelineSession={handleOpenPipelineSession}
        />
      ) : activeTab === 'folders' ? (
        <FoldersView
          scanPath={state.scanPath}
          onStartClaudeSession={(folder, useWorktree) => {
            handleStartClaudeSession(folder, useWorktree)
          }}
        />
      ) : (
        <>
          {state.projects.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-text">No projects yet. Scan your workspace to get started.</div>
              <button className="btn btn-primary" onClick={handleScan} disabled={scanning}>
                {scanning ? 'Scanning...' : 'Scan ~/Workspace'}
              </button>
            </div>
          ) : (
            <>
              <div className="search-bar">
                <input
                  ref={searchRef}
                  className="search-input"
                  placeholder="Search projects...  (Cmd+K)"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button
                  className={`btn btn-sm ${bulkMode ? 'btn-accent' : ''}`}
                  onClick={() => { setBulkMode(!bulkMode); setBulkSelection(new Set()) }}
                >
                  {bulkMode ? 'Exit Select' : 'Select'}
                </button>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {filteredProjects.length} projects
                </span>
              </div>

              {bulkMode && (
                <div className="bulk-bar">
                  <span className="bulk-bar-text">
                    <strong>{bulkSelection.size}</strong> selected
                  </span>
                  <button className="btn btn-sm" onClick={() => setBulkSelection(new Set(filteredProjects.map((p) => p.id)))}>All</button>
                  <button className="btn btn-sm" onClick={() => setBulkSelection(new Set())}>None</button>
                  <div style={{ flex: 1 }} />
                  <button className="btn btn-sm" onClick={handleBulkHide} disabled={bulkSelection.size === 0}>
                    Hide Selected
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={handleBulkRemove} disabled={bulkSelection.size === 0}>
                    Remove Selected
                  </button>
                </div>
              )}

              <div className="app-layout">
                <Sidebar
                  projects={state.projects}
                  tags={state.tags}
                  activeFilter={activeFilter}
                  runningCount={runningCount}
                  systemRunningCount={systemRunningCount}
                  noCommandCount={noCommandCount}
                  onFilterChange={setActiveFilter}
                  onScan={handleScan}
                />
                <div className="main-content">
                  <div className="projects-grid">
                    {filteredProjects.length === 0 ? (
                      <div className="empty-state">
                        <div className="empty-state-text">No projects match your filter.</div>
                      </div>
                    ) : (
                      filteredProjects.map((project) => (
                        <ProjectCard
                          key={project.id}
                          project={project}
                          status={statuses.get(project.id)}
                          systemPortInfo={systemRunningMap.get(project.id)}
                          selected={bulkSelection.has(project.id)}
                          currentBranch={branchMap.get(project.id)?.current ?? null}
                          branches={branchMap.get(project.id)?.branches ?? []}
                          onStart={() => startProject(project)}
                          onStop={() => stopProject(project.id)}
                          onEdit={() => setEditingProject(project)}
                          onRemove={() => { removeProject(project.id); showToast(`Removed ${project.name}`, 'success') }}
                          onSelect={() => handleCardClick(project.id)}
                          onOpenBrowser={() => handleOpenBrowser(project.id)}
                          onKillSystemProcess={(pid) => killSystemPortProcess(pid)}
                          onCheckoutBranch={(branch) => handleCheckoutBranch(project.id, branch)}
                        />
                      ))
                    )}
                  </div>
                  <LogPanel
                    projectName={selectedProject?.name ?? null}
                    logs={selectedLogs}
                  />
                </div>
              </div>
            </>
          )}
        </>
      )}

      {editingProject && (
        <EditProjectModal
          project={editingProject}
          onSave={(updated) => {
            updateProject(updated)
            setEditingProject(null)
            showToast(`Saved ${updated.name}`, 'success')
          }}
          onClose={() => setEditingProject(null)}
          onDelete={(id) => {
            removeProject(id)
            setEditingProject(null)
          }}
        />
      )}

      {showNewSession && (
        <NewSessionModal
          scanPath={state.scanPath}
          onStart={handleStartClaudeSession}
          onClose={() => setShowNewSession(false)}
        />
      )}

      {showHelp && <ShortcutsHelp onClose={() => setShowHelp(false)} />}

      {showSettings && (
        <SettingsModal
          currentPath={state.scanPath}
          currentScanDepth={state.scanDepth ?? 50}
          rtkEnabled={state.rtkEnabled ?? false}
          dangerousMode={state.dangerousMode ?? false}
          chatInputEnabled={state.chatInputEnabled ?? true}
          onSave={(newPath, scanDepth, rtkEnabled, dangerousMode, chatInputEnabled) => {
            persist({ ...state, scanPath: newPath, scanDepth, rtkEnabled, dangerousMode, chatInputEnabled })
            setShowSettings(false)
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </>
  )
}
