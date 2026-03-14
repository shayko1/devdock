import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs'

export interface SessionRecord {
  id: string
  claudeSessionId: string | null
  folderName: string
  folderPath: string
  worktreePath: string | null
  branchName: string | null
  dangerousMode?: boolean
  createdAt: number
  lastActiveAt: number
  closedAt: number | null
  autoRestore: boolean
}

const HISTORY_DIR = join(homedir(), '.devdock')
const HISTORY_FILE = join(HISTORY_DIR, 'session-history.json')
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000 // 6 months

class SessionHistory {
  private records: SessionRecord[] = []
  private loaded = false

  private load() {
    if (this.loaded) return
    this.loaded = true
    try {
      mkdirSync(HISTORY_DIR, { recursive: true })
      if (existsSync(HISTORY_FILE)) {
        this.records = JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'))
      }
    } catch {
      this.records = []
    }
    this.prune()
  }

  private save() {
    try {
      mkdirSync(HISTORY_DIR, { recursive: true })
      writeFileSync(HISTORY_FILE, JSON.stringify(this.records, null, 2), 'utf-8')
    } catch (err) {
      console.error('[SessionHistory] Failed to save:', err)
    }
  }

  private prune() {
    const cutoff = Date.now() - MAX_AGE_MS
    this.records = this.records.filter(r => r.lastActiveAt > cutoff)
  }

  add(record: Omit<SessionRecord, 'createdAt' | 'lastActiveAt' | 'closedAt' | 'autoRestore'>) {
    this.load()
    const existing = this.records.find(r => r.id === record.id)
    if (existing) {
      Object.assign(existing, record, { lastActiveAt: Date.now() })
    } else {
      this.records.push({
        ...record,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        closedAt: null,
        autoRestore: true,
      })
    }
    this.save()
  }

  updateClaudeSessionId(id: string, claudeSessionId: string) {
    this.load()
    const rec = this.records.find(r => r.id === id)
    if (rec) {
      rec.claudeSessionId = claudeSessionId
      rec.lastActiveAt = Date.now()
      this.save()
    }
  }

  touch(id: string) {
    this.load()
    const rec = this.records.find(r => r.id === id)
    if (rec) {
      rec.lastActiveAt = Date.now()
      this.save()
    }
  }

  markClosed(id: string) {
    this.load()
    const rec = this.records.find(r => r.id === id)
    if (rec) {
      rec.closedAt = Date.now()
      rec.autoRestore = false
      this.save()
    }
  }

  markExited(id: string) {
    this.load()
    const rec = this.records.find(r => r.id === id)
    if (rec) {
      rec.lastActiveAt = Date.now()
      // Keep autoRestore true so it resumes on next app start
      this.save()
    }
  }

  setAutoRestore(id: string, value: boolean) {
    this.load()
    const rec = this.records.find(r => r.id === id)
    if (rec) {
      rec.autoRestore = value
      this.save()
    }
  }

  getRestorableSessions(): SessionRecord[] {
    this.load()
    return this.records.filter(r => r.autoRestore && !r.closedAt)
  }

  getHistory(): SessionRecord[] {
    this.load()
    this.prune()
    return [...this.records].sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  }

  getByClaudeSessionId(claudeSessionId: string): SessionRecord | undefined {
    this.load()
    return this.records.find(r => r.claudeSessionId === claudeSessionId)
  }

  remove(id: string) {
    this.load()
    this.records = this.records.filter(r => r.id !== id)
    this.save()
  }

  /** Scan Claude Code's own session files to find resumable conversations for a project */
  scanClaudeSessions(folderPath: string): { claudeSessionId: string; mtime: number; size: number }[] {
    try {
      const encoded = folderPath.replace(/\//g, '-')
      const claudeProjectDir = join(homedir(), '.claude', 'projects', encoded)
      if (!existsSync(claudeProjectDir)) return []

      return readdirSync(claudeProjectDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => {
          const fullPath = join(claudeProjectDir, f)
          const stat = statSync(fullPath)
          return {
            claudeSessionId: f.replace('.jsonl', ''),
            mtime: stat.mtime.getTime(),
            size: stat.size,
          }
        })
        .sort((a, b) => b.mtime - a.mtime)
    } catch {
      return []
    }
  }
}

export const sessionHistory = new SessionHistory()
