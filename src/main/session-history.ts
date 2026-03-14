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
  dirName: string
  isWorktree: boolean
  branchHint: string | null
  mtime: number
  size: number
}

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')

/**
 * Claude encodes CWD paths as directory names by replacing / with -
 * and stripping leading dots from hidden folders.
 * We match on the RAW encoded directory names, never try to decode.
 */
export function scanProjectSessions(folderPath: string, folderName: string): ClaudeSessionInfo[] {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return []

  // Claude's encoding: replace / with -, dots in folder names get stripped
  // e.g. /Users/shayk/Workspace/premium-billing → -Users-shayk-Workspace-premium-billing
  // e.g. /Users/shayk/.devdock/worktrees/... → -Users-shayk--devdock-worktrees-...
  const encodedMainPath = folderPath.replace(/\//g, '-')
  const slug = basename(folderPath).toLowerCase()

  const results: ClaudeSessionInfo[] = []
  const seen = new Set<string>()

  try {
    const allDirs = readdirSync(CLAUDE_PROJECTS_DIR)

    for (const dirName of allDirs) {
      const isMainPath = dirName === encodedMainPath
      // Match worktree dirs: contain "worktrees" AND the project slug in the dir name
      const isWorktree = !isMainPath &&
        dirName.toLowerCase().includes('worktrees') &&
        dirName.toLowerCase().includes(slug)

      if (!isMainPath && !isWorktree) continue

      const projDir = join(CLAUDE_PROJECTS_DIR, dirName)
      try {
        if (!statSync(projDir).isDirectory()) continue
      } catch { continue }

      try {
        const files = readdirSync(projDir).filter(f => f.endsWith('.jsonl'))
        for (const f of files) {
          const sessionId = f.replace('.jsonl', '')
          if (seen.has(sessionId)) continue
          seen.add(sessionId)

          try {
            const fileStat = statSync(join(projDir, f))

            let branchHint: string | null = null
            if (isWorktree) {
              // Extract meaningful part from dir name after "worktrees-"
              const wtIdx = dirName.toLowerCase().indexOf('worktrees-')
              if (wtIdx >= 0) {
                branchHint = dirName.slice(wtIdx + 'worktrees-'.length).replace(/-worktree$/, '')
              }
            }

            results.push({
              claudeSessionId: sessionId,
              folderName,
              folderPath,
              dirName,
              isWorktree,
              branchHint,
              mtime: fileStat.mtime.getTime(),
              size: fileStat.size,
            })
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  } catch { /* projects dir not readable */ }

  return results.sort((a, b) => b.mtime - a.mtime)
}

/**
 * Read the first user message from a Claude session file to use as a title.
 */
export function getSessionTitle(claudeSessionId: string, dirName: string): string | null {
  const filePath = join(CLAUDE_PROJECTS_DIR, dirName, `${claudeSessionId}.jsonl`)
  if (!existsSync(filePath)) return null

  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').filter(Boolean)
    for (const line of lines.slice(0, 30)) {
      try {
        const entry = JSON.parse(line)
        // Claude Code JSONL format: look for user/human messages
        if (entry.type === 'human' || entry.role === 'user') {
          const text = typeof entry.message === 'string'
            ? entry.message
            : entry.content?.[0]?.text || entry.message?.content?.[0]?.text || ''
          if (text && text.length > 2) return text.slice(0, 120)
        }
      } catch { continue }
    }
  } catch { /* unreadable */ }
  return null
}
