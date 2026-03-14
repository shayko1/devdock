import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ClaudeSessionsView } from './ClaudeSessionsView'

vi.mock('./XTerminal', () => ({
  XTerminal: ({ sessionId, active }: { sessionId: string; active: boolean }) => (
    <div data-testid={`terminal-${sessionId}`} data-active={String(active)}>
      Mock Terminal
    </div>
  ),
}))

vi.mock('./FileExplorer', () => ({ FileExplorer: () => null }))
vi.mock('./FileViewer', () => ({ FileViewer: () => null }))
vi.mock('./ChangesView', () => ({ ChangesView: () => null }))
vi.mock('./SearchView', () => ({ SearchView: () => null }))
vi.mock('./BrowserView', () => ({ BrowserView: () => null }))
vi.mock('./PipelineView', () => ({ PipelineView: () => null }))
vi.mock('./SessionInfoBar', () => ({
  SessionInfoBar: () => <div data-testid="session-info-bar" />,
}))
vi.mock('./CoachPanel', () => ({ CoachPanel: () => null }))

function makeSession(overrides: Partial<{
  id: string
  folderName: string
  folderPath: string
  worktreePath: string | null
  branchName: string | null
  exited: boolean
  claudeSessionId: string | null
  dangerousMode: boolean
}> = {}) {
  return {
    id: 's1',
    folderName: 'my-project',
    folderPath: '/path/to/my-project',
    worktreePath: null,
    branchName: null,
    exited: false,
    claudeSessionId: null,
    dangerousMode: false,
    ...overrides,
  }
}

describe('ClaudeSessionsView', () => {
  beforeEach(() => {
    vi.mocked(window.api.rtkDetect).mockResolvedValue({
      installed: false,
      version: null,
      hookActive: false,
      path: null,
    })
    vi.mocked(window.api.getGitStatus).mockResolvedValue({
      isGitRepo: false,
    })
    vi.mocked(window.api.coachGetConfig).mockResolvedValue({
      enabled: false,
      apiKey: '',
      model: 'gpt-4.1-nano',
    })
  })

  it('renders "No active Claude sessions." when sessions is []', () => {
    render(
      <ClaudeSessionsView
        sessions={[]}
        rtkEnabled={false}
        onNewSession={vi.fn()}
        onCloseSession={vi.fn()}
        onResumeSession={vi.fn()}
      />
    )
    expect(screen.getByText('No active Claude sessions.')).toBeInTheDocument()
  })

  it('empty state button calls onNewSession', () => {
    const onNewSession = vi.fn()
    render(
      <ClaudeSessionsView
        sessions={[]}
        rtkEnabled={false}
        onNewSession={onNewSession}
        onCloseSession={vi.fn()}
        onResumeSession={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('New Claude Session'))
    expect(onNewSession).toHaveBeenCalledTimes(1)
  })

  it('+ button calls onNewSession when sessions exist', () => {
    const onNewSession = vi.fn()
    const session = makeSession({ id: 's1', folderName: 'project' })
    render(
      <ClaudeSessionsView
        sessions={[session]}
        rtkEnabled={false}
        onNewSession={onNewSession}
        onCloseSession={vi.fn()}
        onResumeSession={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTitle('New Claude session'))
    expect(onNewSession).toHaveBeenCalledTimes(1)
  })

  it('renders tab for each session with folder name', () => {
    const sessions = [
      makeSession({ id: 'a', folderName: 'project-a' }),
      makeSession({ id: 'b', folderName: 'project-b' }),
    ]
    render(
      <ClaudeSessionsView
        sessions={sessions}
        rtkEnabled={false}
        onNewSession={vi.fn()}
        onCloseSession={vi.fn()}
        onResumeSession={vi.fn()}
      />
    )
    expect(screen.getByText('project-a')).toBeInTheDocument()
    expect(screen.getByText('project-b')).toBeInTheDocument()
  })

  it('clicking × calls onCloseSession with session id', () => {
    const session = makeSession({ id: 'close-me', folderName: 'test-folder' })
    const onCloseSession = vi.fn()
    render(
      <ClaudeSessionsView
        sessions={[session]}
        rtkEnabled={false}
        onNewSession={vi.fn()}
        onCloseSession={onCloseSession}
        onResumeSession={vi.fn()}
      />
    )
    const closeButtons = screen.getAllByTitle('Close session')
    expect(closeButtons.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(closeButtons[0])
    expect(onCloseSession).toHaveBeenCalledWith('close-me')
  })

  it('shows Resume on exited session with claudeSessionId, calls onResumeSession', () => {
    const session = makeSession({
      id: 'resume-me',
      folderName: 'resume-folder',
      exited: true,
      claudeSessionId: 'claude-123',
    })
    const onResumeSession = vi.fn()
    render(
      <ClaudeSessionsView
        sessions={[session]}
        rtkEnabled={false}
        onNewSession={vi.fn()}
        onCloseSession={vi.fn()}
        onResumeSession={onResumeSession}
      />
    )
    const resumeBtn = screen.getByTitle('Resume session')
    fireEvent.click(resumeBtn)
    expect(onResumeSession).toHaveBeenCalledWith('resume-me')
  })

  it('exited session without claudeSessionId has no Resume tab button', () => {
    const session = makeSession({
      id: 'no-resume',
      folderName: 'no-resume-folder',
      exited: true,
      claudeSessionId: null,
    })
    render(
      <ClaudeSessionsView
        sessions={[session]}
        rtkEnabled={false}
        onNewSession={vi.fn()}
        onCloseSession={vi.fn()}
        onResumeSession={vi.fn()}
      />
    )
    const resumeButtons = screen.queryAllByRole('button', { name: /^Resume$/ })
    expect(resumeButtons).toHaveLength(0)
  })

  it('session with dangerousMode=true shows UNSAFE text', () => {
    const session = makeSession({
      id: 'unsafe',
      folderName: 'unsafe-folder',
      dangerousMode: true,
    })
    render(
      <ClaudeSessionsView
        sessions={[session]}
        rtkEnabled={false}
        onNewSession={vi.fn()}
        onCloseSession={vi.fn()}
        onResumeSession={vi.fn()}
      />
    )
    expect(screen.getByText('UNSAFE')).toBeInTheDocument()
  })

  it('session with dangerousMode=false has no UNSAFE text', () => {
    const session = makeSession({
      id: 'safe',
      folderName: 'safe-folder',
      dangerousMode: false,
    })
    render(
      <ClaudeSessionsView
        sessions={[session]}
        rtkEnabled={false}
        onNewSession={vi.fn()}
        onCloseSession={vi.fn()}
        onResumeSession={vi.fn()}
      />
    )
    expect(screen.queryByText('UNSAFE')).not.toBeInTheDocument()
  })

  it('dangerous session shows warning banner text', () => {
    const session = makeSession({
      id: 'danger',
      folderName: 'danger-folder',
      dangerousMode: true,
    })
    render(
      <ClaudeSessionsView
        sessions={[session]}
        rtkEnabled={false}
        onNewSession={vi.fn()}
        onCloseSession={vi.fn()}
        onResumeSession={vi.fn()}
      />
    )
    expect(
      screen.getByText(/DANGEROUS MODE — Claude executes commands without asking permission/)
    ).toBeInTheDocument()
  })

  it('exited active session shows "Session ended" overlay', () => {
    const session = makeSession({
      id: 'exited',
      folderName: 'exited-folder',
      exited: true,
    })
    render(
      <ClaudeSessionsView
        sessions={[session]}
        rtkEnabled={false}
        onNewSession={vi.fn()}
        onCloseSession={vi.fn()}
        onResumeSession={vi.fn()}
      />
    )
    expect(screen.getByText('Session ended')).toBeInTheDocument()
  })

  it('renders multiple tabs, clicking selects different session', () => {
    const sessions = [
      makeSession({ id: 'first', folderName: 'first-folder' }),
      makeSession({ id: 'second', folderName: 'second-folder' }),
    ]
    render(
      <ClaudeSessionsView
        sessions={sessions}
        rtkEnabled={false}
        onNewSession={vi.fn()}
        onCloseSession={vi.fn()}
        onResumeSession={vi.fn()}
      />
    )
    expect(screen.getByText('first-folder')).toBeInTheDocument()
    expect(screen.getByText('second-folder')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-second')).toHaveAttribute(
      'data-active',
      'true'
    )
    fireEvent.click(screen.getByText('first-folder'))
    expect(screen.getByTestId('terminal-first')).toHaveAttribute(
      'data-active',
      'true'
    )
  })
})
