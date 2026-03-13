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
  const [orphanedSessions, setOrphanedSessions] = useState<ClaudeSession[]>([])
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>(() => {
    return (localStorage.getItem('devdock-theme') as 'dark' | 'light' | 'system') || 'dark'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('devdock-theme', theme)
  }, [theme])

  // Persist sessions to localStorage
  useEffect(() => {
    if (claudeSessions.length > 0) {
      localStorage.setItem('devdock-claude-sessions', JSON.stringify(claudeSessions))
    } else {
      localStorage.removeItem('devdock-claude-sessions')
    }
  }, [claudeSessions])

  // On startup, check for sessions from previous run and offer to resume them
  useEffect(() => {
    const saved = localStorage.getItem('devdock-claude-sessions')
    if (saved) {
      try {
        const sessions: ClaudeSession[] = JSON.parse(saved)
        if (sessions.length > 0) {
          setOrphanedSessions(sessions)
        }
      } catch { /* ignore bad data */ }
      localStorage.removeItem('devdock-claude-sessions')
    }
  }, [])

  // Listen for PTY exits to mark sessions
  useEffect(() => {
    const unsub = window.api.onPtyExit(({ sessionId }) => {
      setClaudeSessions(prev => prev.map(s => s.id === sessionId ? { ...s, exited: true } : s))
    })
    return unsub
  }, [])

  const handleStartClaudeSession = useCallback(async (folder: WorkspaceFolder, useWorktree: boolean) => {
    const sessionId = `claude-${Date.now().toString(36)}`
    try {
      const result = await window.api.ptyCreate({
        sessionId,
        folderName: folder.name,
        folderPath: folder.path,
        useWorktree
      })
      if (result.success) {
        const newSession: ClaudeSession = {
          id: sessionId,
          folderName: result.folderName || folder.name,
          folderPath: folder.path,
          worktreePath: result.worktreePath ?? null,
          branchName: result.branchName ?? null,
          claudeSessionId: null
        }
        setClaudeSessions(prev => [...prev, newSession])
        setShowNewSession(false)
        setActiveTab('claude')

        // Detect Claude's internal session ID after it starts (poll a few times)
        const cwd = result.worktreePath || folder.path
        const detectId = async () => {
          for (let attempt = 0; attempt < 6; attempt++) {
            await new Promise(r => setTimeout(r, 3000))
            const { sessionId: claudeId } = await window.api.detectClaudeSessionId(cwd)
            if (claudeId) {
              setClaudeSessions(prev => prev.map(s =>
                s.id === sessionId ? { ...s, claudeSessionId: claudeId } : s
              ))
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
  }, [])

  const handleResumeClaudeSession = useCallback(async (sessionId: string) => {
    const session = claudeSessions.find(s => s.id === sessionId)
    if (!session || !session.claudeSessionId) return

    // Create a new PTY session that resumes the old Claude conversation
    const newPtyId = `claude-${Date.now().toString(36)}`
    try {
      const result = await window.api.ptyCreate({
        sessionId: newPtyId,
        folderName: session.folderName,
        folderPath: session.folderPath,
        useWorktree: false, // Don't create a new worktree, reuse existing
        resumeClaudeId: session.claudeSessionId,
        existingWorktreePath: session.worktreePath || undefined
      })
      if (result.success) {
        // Replace the exited session with the new resumed one
        setClaudeSessions(prev => prev.map(s =>
          s.id === sessionId
            ? {
                ...s,
                id: newPtyId,
                exited: false,
                worktreePath: result.worktreePath ?? s.worktreePath,
                branchName: result.branchName ?? s.branchName
              }
            : s
        ))

        // Re-detect session ID after resume (it may create a new one)
        const cwd = session.worktreePath || session.folderPath
        const detectId = async () => {
          for (let attempt = 0; attempt < 6; attempt++) {
            await new Promise(r => setTimeout(r, 3000))
            const { sessionId: claudeId } = await window.api.detectClaudeSessionId(cwd)
            if (claudeId && claudeId !== session.claudeSessionId) {
              setClaudeSessions(prev => prev.map(s =>
                s.id === newPtyId ? { ...s, claudeSessionId: claudeId } : s
              ))
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
    try {
      const result = await window.api.ptyCreate({
        sessionId,
        folderName: pipelineFolderName,
        folderPath: pipelineFolderPath,
        useWorktree: false,
        existingWorktreePath: worktreePath
      })
      if (result.success) {
        const newSession: ClaudeSession = {
          id: sessionId,
          folderName: result.folderName || pipelineFolderName,
          folderPath: pipelineFolderPath,
          worktreePath: result.worktreePath ?? worktreePath,
          branchName: result.branchName ?? null,
          claudeSessionId: null
        }
        setClaudeSessions(prev => [...prev, newSession])
        setActiveTab('claude')

        // Detect Claude's internal session ID
        const cwd = worktreePath
        const detectId = async () => {
          for (let attempt = 0; attempt < 6; attempt++) {
            await new Promise(r => setTimeout(r, 3000))
            const { sessionId: claudeId } = await window.api.detectClaudeSessionId(cwd)
            if (claudeId) {
              setClaudeSessions(prev => prev.map(s =>
                s.id === sessionId ? { ...s, claudeSessionId: claudeId } : s
              ))
              return
            }
          }
        }
        detectId()
      }
    } catch (err) {
      alert(`Error opening pipeline session: ${err}`)
    }
  }, [])

  const handleResumeAllSessions = useCallback(async (sessions: ClaudeSession[]) => {
    setOrphanedSessions([])
    setActiveTab('claude')
    for (const session of sessions) {
      const newSessionId = `claude-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
      try {
        const result = await window.api.ptyCreate({
          sessionId: newSessionId,
          folderName: session.folderName,
          folderPath: session.folderPath,
          useWorktree: false,
          resumeClaudeId: session.claudeSessionId || undefined,
          existingWorktreePath: session.worktreePath || undefined,
        })
        if (result.success) {
          const restored: ClaudeSession = {
            id: newSessionId,
            folderName: result.folderName || session.folderName,
            folderPath: session.folderPath,
            worktreePath: result.worktreePath ?? session.worktreePath,
            branchName: result.branchName ?? session.branchName,
            claudeSessionId: session.claudeSessionId ?? null,
          }
          setClaudeSessions(prev => [...prev, restored])
        }
      } catch { /* skip failed sessions */ }
    }
  }, [])

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

  const handleScan = useCallback(async () => {
    setScanning(true)
    try {
      const count = await scanWorkspace()
      refreshSystemPorts()
      if (count > 0) {
        showToast(`Found ${count} new project${count > 1 ? 's' : ''}`, 'success')
      } else {
        showToast('No new projects found', 'info')
      }
    } finally {
      setScanning(false)
    }
  }, [scanWorkspace, refreshSystemPorts, showToast])

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
          <button className={`theme-btn ${theme === 'system' ? 'active' : ''}`} onClick={() => setTheme('system')} title="System mode">⚙</button>
        </div>
        <button
          className="theme-btn"
          onClick={() => setShowSettings(true)}
          title="Settings"
          style={{ marginLeft: 8 }}
        >
          ⚙
        </button>
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
          onNewSession={() => setShowNewSession(true)}
          onCloseSession={handleCloseClaudeSession}
          onResumeSession={handleResumeClaudeSession}
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
                          onStart={() => startProject(project)}
                          onStop={() => stopProject(project.id)}
                          onEdit={() => setEditingProject(project)}
                          onRemove={() => { removeProject(project.id); showToast(`Removed ${project.name}`, 'success') }}
                          onSelect={() => handleCardClick(project.id)}
                          onOpenBrowser={() => handleOpenBrowser(project.id)}
                          onKillSystemProcess={(pid) => killSystemPortProcess(pid)}
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

      {orphanedSessions.length > 0 && (
        <div className="modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h2>Resume Previous Sessions?</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              DevDock found {orphanedSessions.length} Claude session{orphanedSessions.length > 1 ? 's' : ''} from your last run.
            </p>
            <div style={{ marginBottom: 16 }}>
              {orphanedSessions.map(s => (
                <div key={s.id} style={{ padding: '8px 10px', marginBottom: 6, borderRadius: 6, background: 'var(--bg-secondary)', fontSize: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{s.folderName}</div>
                  <div style={{ color: 'var(--text-muted)', display: 'flex', gap: 10 }}>
                    {s.branchName && <span>⎇ {s.branchName.replace('devdock/claude-', '').slice(0, 20)}</span>}
                    {s.claudeSessionId
                      ? <span style={{ color: 'var(--green)' }}>✓ conversation saved</span>
                      : <span>new session</span>
                    }
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-sm btn-danger" onClick={async () => {
                for (const s of orphanedSessions) {
                  if (s.worktreePath && s.folderPath) {
                    await window.api.cleanupWorktree(s.worktreePath, s.folderPath)
                  }
                }
                setOrphanedSessions([])
                showToast('Sessions discarded', 'info')
              }}>
                Discard
              </button>
              <button className="btn btn-sm" onClick={() => setOrphanedSessions([])}>
                Later
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => handleResumeAllSessions(orphanedSessions)}>
                Resume {orphanedSessions.length > 1 ? `All ${orphanedSessions.length}` : 'Session'}
              </button>
            </div>
          </div>
        </div>
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
          rtkEnabled={state.rtkEnabled ?? false}
          onSave={(newPath, rtkEnabled) => {
            persist({ ...state, scanPath: newPath, rtkEnabled })
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
