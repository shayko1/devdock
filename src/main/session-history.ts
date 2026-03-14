import { join, basename } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs'

// ── Active session tracking (for auto-resume on restart) ──

export interface ActiveSession {
  id: string
  claudeSessionId: string | null
  folderName: string
  folderPath: string
  worktreePath: string | null
  branchName: string | null
  dangerousMode?: boolean
}

const DEVDOCK_DIR = join(homedir(), '.devdock')
const ACTIVE_FILE = join(DEVDOCK_DIR, 'active-sessions.json')

class ActiveSessionStore {
  private sessions: ActiveSession[] = []

  private load() {
    try {
      if (existsSync(ACTIVE_FILE)) {
        this.sessions = JSON.parse(readFileSync(ACTIVE_FILE, 'utf-8'))
      }
    } catch { this.sessions = [] }
  }

  private save() {
    try {
      mkdirSync(DEVDOCK_DIR, { recursive: true })
      writeFileSync(ACTIVE_FILE, JSON.stringify(this.sessions, null, 2), 'utf-8')
    } catch (err) {
      console.error('[ActiveSessions] save failed:', err)
    }
  }

  set(session: ActiveSession) {
    this.load()
    const idx = this.sessions.findIndex(s => s.id === session.id)
    if (idx >= 0) this.sessions[idx] = session
    else this.sessions.push(session)
    this.save()
  }

  updateClaudeId(id: string, claudeSessionId: string) {
    this.load()
    const s = this.sessions.find(r => r.id === id)
    if (s) { s.claudeSessionId = claudeSessionId; this.save() }
  }

  remove(id: string) {
    this.load()
    this.sessions = this.sessions.filter(s => s.id !== id)
    this.save()
  }

  getAll(): ActiveSession[] {
    this.load()
    return [...this.sessions]
  }

  clear() {
    this.sessions = []
    this.save()
  }
}

export const activeSessions = new ActiveSessionStore()

// ── Claude session history (scan Claude's own files) ──

export interface ClaudeSessionInfo {
  claudeSessionId: string
  folderName: string
  folderPath: string
  cwd: string
  isWorktree: boolean
  branchHint: string | null
  mtime: number
  size: number
}

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')

/**
 * Scan Claude Code's actual session files for a given project.
 * Finds sessions from the main path AND any worktree paths that belong to the project.
 */
export function scanProjectSessions(folderPath: string, folderName: string): ClaudeSessionInfo[] {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return []

  const results: ClaudeSessionInfo[] = []
  const seen = new Set<string>()

  // The project slug is used in worktree directory names
  const projectSlug = basename(folderPath).toLowerCase()

  try {
    const allDirs = readdirSync(CLAUDE_PROJECTS_DIR)

    for (const dirName of allDirs) {
      // Decode the directory name back to a path
      const decodedPath = dirName.replace(/^-/, '/').replace(/-/g, '/')

      // Match if: exact project path, or worktree containing the project name
      const isMainPath = decodedPath === folderPath
      const isDevdockWorktree = decodedPath.includes('/devdock/worktrees/') && decodedPath.toLowerCase().includes(projectSlug)
      const isDev3Worktree = decodedPath.includes('/dev3.0/worktrees/') && decodedPath.toLowerCase().includes(projectSlug)
      const isGenericWorktree = decodedPath.includes('/worktrees/') && decodedPath.toLowerCase().includes(projectSlug)

      if (!isMainPath && !isDevdockWorktree && !isDev3Worktree && !isGenericWorktree) continue

      const projDir = join(CLAUDE_PROJECTS_DIR, dirName)
      try {
        const stat = statSync(projDir)
        if (!stat.isDirectory()) continue
      } catch { continue }

      // Scan .jsonl session files in this directory
      try {
        const files = readdirSync(projDir).filter(f => f.endsWith('.jsonl'))
        for (const f of files) {
          const sessionId = f.replace('.jsonl', '')
          if (seen.has(sessionId)) continue
          seen.add(sessionId)

          try {
            const filePath = join(projDir, f)
            const fileStat = statSync(filePath)

            // Extract branch hint from worktree path
            let branchHint: string | null = null
            if (!isMainPath) {
              const parts = decodedPath.split('/')
              const wtIdx = parts.indexOf('worktrees')
              if (wtIdx >= 0 && wtIdx + 1 < parts.length) {
                branchHint = parts.slice(wtIdx + 1).join('/').replace('/worktree', '')
              }
            }

            results.push({
              claudeSessionId: sessionId,
              folderName,
              folderPath,
              cwd: decodedPath,
              isWorktree: !isMainPath,
              branchHint,
              mtime: fileStat.mtime.getTime(),
              size: fileStat.size,
            })
          } catch { /* skip unreadable files */ }
        }
      } catch { /* skip unreadable dirs */ }
    }
  } catch { /* projects dir not readable */ }

  return results.sort((a, b) => b.mtime - a.mtime)
}

/**
 * Read the first user message from a Claude session file to use as a title.
 */
export function getSessionTitle(claudeSessionId: string, folderPath: string, cwd?: string): string | null {
  const paths = [cwd, folderPath].filter(Boolean) as string[]

  for (const p of paths) {
    const encoded = p.replace(/\//g, '-')
    const filePath = join(CLAUDE_PROJECTS_DIR, encoded, `${claudeSessionId}.jsonl`)
    if (!existsSync(filePath)) continue

    try {
      const content = readFileSync(filePath, 'utf-8')
      const lines = content.split('\n').filter(Boolean)
      for (const line of lines.slice(0, 20)) {
        try {
          const entry = JSON.parse(line)
          if (entry.type === 'human' || entry.role === 'user') {
            const text = typeof entry.message === 'string'
              ? entry.message
              : entry.content?.[0]?.text || entry.message?.content?.[0]?.text || ''
            if (text) return text.slice(0, 120)
          }
        } catch { continue }
      }
    } catch { continue }
  }
  return null
}
