import { ipcMain } from 'electron'
import { join } from 'path'
import { readdirSync, statSync, mkdirSync, existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs'
import { homedir } from 'os'

export function registerMcpHandlers() {
  ipcMain.handle('mcp-get-config', (_event, projectPath?: string) => {
    const configs: { scope: string; path: string; servers: Record<string, any> }[] = []
    const home = homedir()

    const userFile = join(home, '.claude.json')
    try {
      if (existsSync(userFile)) {
        const data = JSON.parse(readFileSync(userFile, 'utf-8'))
        if (data.mcpServers && Object.keys(data.mcpServers).length > 0) {
          configs.push({ scope: 'user', path: userFile, servers: data.mcpServers })
        }
      }
    } catch { /* ignore */ }

    if (projectPath) {
      const projectFile = join(projectPath, '.mcp.json')
      try {
        if (existsSync(projectFile)) {
          const data = JSON.parse(readFileSync(projectFile, 'utf-8'))
          if (data.mcpServers && Object.keys(data.mcpServers).length > 0) {
            configs.push({ scope: 'project', path: projectFile, servers: data.mcpServers })
          }
        }
      } catch { /* ignore */ }
    }

    return configs
  })

  ipcMain.handle('mcp-save-config', (_event, filePath: string, servers: Record<string, any>) => {
    try {
      let data: any = {}
      if (existsSync(filePath)) {
        data = JSON.parse(readFileSync(filePath, 'utf-8'))
      }
      data.mcpServers = servers
      mkdirSync(join(filePath, '..'), { recursive: true })
      writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('skills-list', (_event, projectPath?: string) => {
    const skills: { name: string; scope: string; path: string; description: string }[] = []
    const home = homedir()

    const scanDir = (dir: string, scope: string) => {
      try {
        if (!existsSync(dir)) return
        for (const entry of readdirSync(dir)) {
          const entryPath = join(dir, entry)
          const stat = statSync(entryPath)
          if (stat.isDirectory()) {
            const skillFile = join(entryPath, 'SKILL.md')
            if (existsSync(skillFile)) {
              const content = readFileSync(skillFile, 'utf-8').slice(0, 500)
              const descMatch = content.match(/description:\s*(.+)/i)
              skills.push({
                name: entry,
                scope,
                path: skillFile,
                description: descMatch ? descMatch[1].trim() : ''
              })
            }
          }
          if (stat.isFile() && entry.endsWith('.md')) {
            const content = readFileSync(entryPath, 'utf-8').slice(0, 200)
            skills.push({
              name: '/' + entry.replace(/\.md$/, ''),
              scope,
              path: entryPath,
              description: content.split('\n').find(l => l.trim() && !l.startsWith('#') && !l.startsWith('---'))?.trim() || ''
            })
          }
        }
      } catch { /* ignore */ }
    }

    scanDir(join(home, '.claude', 'skills'), 'user')
    scanDir(join(home, '.claude', 'commands'), 'user')

    if (projectPath) {
      scanDir(join(projectPath, '.claude', 'skills'), 'project')
      scanDir(join(projectPath, '.claude', 'commands'), 'project')
    }

    return skills
  })

  ipcMain.handle('create-command', (_event, opts: { name: string; content: string; scope: 'user' | 'project'; projectPath?: string }) => {
    try {
      const home = homedir()
      const dir = opts.scope === 'user'
        ? join(home, '.claude', 'commands')
        : join(opts.projectPath || '', '.claude', 'commands')
      mkdirSync(dir, { recursive: true })
      const filename = opts.name.replace(/^\//, '').replace(/[^a-zA-Z0-9_-]/g, '-') + '.md'
      const filePath = join(dir, filename)
      if (existsSync(filePath)) {
        return { success: false, error: 'Command already exists' }
      }
      writeFileSync(filePath, opts.content, 'utf-8')
      return { success: true, path: filePath }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('delete-command', (_event, filePath: string) => {
    try {
      unlinkSync(filePath)
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
