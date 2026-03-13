/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import { join } from 'path'

vi.mock('fs', () => ({
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
}))

vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-123'),
}))

import { scanWorkspace } from './scanner'

describe('scanner', () => {
  const scanPath = '/test/workspace'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array for non-existent directory', () => {
    vi.mocked(fs.readdirSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const result = scanWorkspace(scanPath)
    expect(result).toEqual([])
  })

  it('scans directory and finds projects with package.json', () => {
    vi.mocked(fs.readdirSync)
      .mockReturnValueOnce(['my-project'] as any)
      .mockImplementation((path: any) => {
        if (path === scanPath) return ['my-project'] as any
        if (String(path).includes('my-project') && !String(path).endsWith('.json')) return [] as any
        return [] as any
      })
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)
    vi.mocked(fs.existsSync).mockImplementation((path: any) => {
      const p = String(path)
      return p === join(scanPath, 'my-project', 'package.json')
    })
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      name: 'my-project',
      scripts: { dev: 'vite' },
      dependencies: { vite: '^5.0.0' },
    }))

    const result = scanWorkspace(scanPath)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('my-project')
    expect(result[0].path).toBe(join(scanPath, 'my-project'))
    expect(result[0].runCommand).toBe('npm run dev')
  })

  it('ignores hidden directories', () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['.git', 'my-project'] as any)
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)
    vi.mocked(fs.existsSync).mockImplementation((path: any) => {
      const p = String(path)
      return p === join(scanPath, 'my-project', 'package.json')
    })
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ name: 'my-project', scripts: { start: 'node index.js' } }))

    const result = scanWorkspace(scanPath)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('my-project')
    expect(result.some(p => p.path.includes('.git'))).toBe(false)
  })

  it('ignores node_modules', () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['node_modules', 'my-project'] as any)
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)
    vi.mocked(fs.existsSync).mockImplementation((path: any) => {
      const p = String(path)
      return p === join(scanPath, 'my-project', 'package.json')
    })
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ name: 'my-project', scripts: { start: 'node index.js' } }))

    const result = scanWorkspace(scanPath)
    expect(result).toHaveLength(1)
    expect(result.some(p => p.path.includes('node_modules'))).toBe(false)
  })

  it('extracts project name from package.json', () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['folder-name'] as any)
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)
    vi.mocked(fs.existsSync).mockImplementation((path: any) => {
      const p = String(path)
      return p === join(scanPath, 'folder-name', 'package.json')
    })
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      name: 'my-awesome-app',
      scripts: { dev: 'vite' },
    }))

    const result = scanWorkspace(scanPath)
    expect(result[0].name).toBe('my-awesome-app')
  })

  it('extracts run command from scripts (dev, start, etc.)', () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['proj'] as any)
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)
    vi.mocked(fs.existsSync).mockImplementation((path: any) => {
      const p = String(path)
      return p === join(scanPath, 'proj', 'package.json')
    })
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      name: 'proj',
      scripts: {
        dev: 'vite',
        start: 'node index.js',
        serve: 'serve',
      },
    }))

    const result = scanWorkspace(scanPath)
    expect(result[0].runCommand).toBe('npm run dev')
  })

  it('extracts port from scripts', () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['proj'] as any)
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)
    vi.mocked(fs.existsSync).mockImplementation((path: any) => {
      const p = String(path)
      return p === join(scanPath, 'proj', 'package.json')
    })
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      name: 'proj',
      scripts: { dev: 'vite --port 3456' },
    }))

    const result = scanWorkspace(scanPath)
    expect(result[0].port).toBe(3456)
  })

  it('detects tech stack (React, TypeScript, etc.)', () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['proj'] as any)
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any)
    vi.mocked(fs.existsSync).mockImplementation((path: any) => {
      const p = String(path)
      return p === join(scanPath, 'proj', 'package.json')
    })
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      name: 'proj',
      scripts: { dev: 'vite' },
      dependencies: { react: '^18.0.0', typescript: '^5.0.0', vite: '^5.0.0' },
    }))

    const result = scanWorkspace(scanPath)
    expect(result[0].techStack).toContain('React')
    expect(result[0].techStack).toContain('TypeScript')
    expect(result[0].techStack).toContain('Vite')
  })
})
