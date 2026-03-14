import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'

interface Props {
  sessionId: string
  rootPath: string
  onSend: (text: string) => void
  onImageUpload: (file: File) => void
  disabled?: boolean
}

type Mode = 'agent' | 'chat' | 'plan'

const MODELS = [
  { id: 'sonnet', label: 'Claude Sonnet 4', short: 'Sonnet 4', desc: 'Fast & capable' },
  { id: 'opus', label: 'Claude Opus 4', short: 'Opus 4', desc: 'Most powerful' },
  { id: 'haiku', label: 'Claude Haiku 3.5', short: 'Haiku 3.5', desc: 'Fastest, cheapest' },
  { id: 'sonnet thinking', label: 'Sonnet 4 (Thinking)', short: 'Sonnet 4+', desc: 'Extended thinking' },
  { id: 'opus thinking', label: 'Opus 4 (Thinking)', short: 'Opus 4+', desc: 'Max intelligence' },
]

interface SlashCommand {
  cmd: string
  label: string
  desc: string
  category: 'session' | 'info' | 'project' | 'review'
}

const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: '/compact', label: '/compact', desc: 'Compress conversation to save context', category: 'session' },
  { cmd: '/clear', label: '/clear', desc: 'Wipe conversation history', category: 'session' },
  { cmd: '/resume', label: '/resume', desc: 'Resume a previous session', category: 'session' },
  { cmd: '/fork', label: '/fork', desc: 'Branch conversation into new session', category: 'session' },
  { cmd: '/rewind', label: '/rewind', desc: 'Restore to previous checkpoint', category: 'session' },
  { cmd: '/cost', label: '/cost', desc: 'Show token usage and costs', category: 'info' },
  { cmd: '/context', label: '/context', desc: 'Show context window usage', category: 'info' },
  { cmd: '/status', label: '/status', desc: 'Version, model, account info', category: 'info' },
  { cmd: '/diff', label: '/diff', desc: 'Open interactive diff viewer', category: 'info' },
  { cmd: '/stats', label: '/stats', desc: 'Visualize daily usage stats', category: 'info' },
  { cmd: '/export', label: '/export', desc: 'Export conversation as text', category: 'info' },
  { cmd: '/copy', label: '/copy', desc: 'Copy last response to clipboard', category: 'info' },
  { cmd: '/model', label: '/model', desc: 'Switch AI model', category: 'project' },
  { cmd: '/config', label: '/config', desc: 'Manage settings', category: 'project' },
  { cmd: '/init', label: '/init', desc: 'Initialize project with CLAUDE files', category: 'project' },
  { cmd: '/memory', label: '/memory', desc: 'Edit CLAUDE.md files', category: 'project' },
  { cmd: '/permissions', label: '/permissions', desc: 'Manage tool permissions', category: 'project' },
  { cmd: '/plan', label: '/plan', desc: 'Enter plan mode for complex tasks', category: 'project' },
  { cmd: '/mcp', label: '/mcp', desc: 'Configure MCP servers', category: 'project' },
  { cmd: '/review', label: '/review', desc: 'PR integration & review', category: 'review' },
  { cmd: '/pr-comments', label: '/pr-comments', desc: 'View pull request comments', category: 'review' },
  { cmd: '/simplify', label: '/simplify', desc: 'Review and fix code quality', category: 'review' },
  { cmd: '/doctor', label: '/doctor', desc: 'Run diagnostics on installation', category: 'info' },
  { cmd: '/help', label: '/help', desc: 'List all available commands', category: 'info' },
]

interface FileEntry {
  name: string
  path: string
  isDir: boolean
  relativePath: string
}

const CONTEXT_WINDOW_SIZE = 200_000 // 200k tokens for most Claude models

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function ChatInputBar({ sessionId, rootPath, onSend, onImageUpload, disabled }: Props) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState<Mode>('agent')
  const [modelIdx, setModelIdx] = useState(0)
  const [images, setImages] = useState<{ name: string; file: File; preview: string }[]>([])
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)

  // Context tracking
  const [contextUsedTokens, setContextUsedTokens] = useState(0)
  const [contextMaxTokens, setContextMaxTokens] = useState(CONTEXT_WINDOW_SIZE)
  const [contextPercent, setContextPercent] = useState(0)
  const [contextSource, setContextSource] = useState<'parsed' | 'estimated'>('estimated')
  const [sessionCost, setSessionCost] = useState(0)
  const charCountRef = useRef(0)

  // Autocomplete state
  const [acType, setAcType] = useState<'none' | 'slash' | 'file'>('none')
  const [acQuery, setAcQuery] = useState('')
  const [acIndex, setAcIndex] = useState(0)
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([])
  const [fileBrowsePath, setFileBrowsePath] = useState('')
  const [fileLoading, setFileLoading] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modeRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<HTMLDivElement>(null)
  const acRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setContextUsedTokens(0)
    setContextMaxTokens(CONTEXT_WINDOW_SIZE)
    setContextPercent(0)
    setContextSource('estimated')
    setSessionCost(0)
    charCountRef.current = 0
    setText('')
    setImages([])
    setAcType('none')
  }, [sessionId])

  // Track context from PTY data — parse real numbers when available, estimate otherwise
  useEffect(() => {
    // Strip ANSI escapes for reliable text matching
    const strip = (s: string) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')

    const unsub = window.api.onPtyData(({ sessionId: sid, data }) => {
      if (sid !== sessionId) return
      const clean = strip(data)

      // Try to parse actual context percentage from Claude Code output
      // Patterns: "XX% context", "XX% of context", "used_percentage: XX"
      const pctMatch = clean.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?context/i)
        || clean.match(/used_percentage[:\s]+(\d+(?:\.\d+)?)/i)
        || clean.match(/Context:\s*(\d+(?:\.\d+)?)\s*%/i)
      if (pctMatch) {
        const pct = parseFloat(pctMatch[1])
        if (pct >= 0 && pct <= 100) {
          setContextPercent(pct)
          setContextUsedTokens(Math.round((pct / 100) * contextMaxTokens))
          setContextSource('parsed')
        }
      }

      // Parse token counts: "XXk/200k tokens" or "XX,XXX / 200,000"
      const tokenMatch = clean.match(/([\d,.]+)\s*[kK]?\s*\/\s*([\d,.]+)\s*[kK]?\s*(?:tokens?)?/i)
      if (tokenMatch) {
        const parse = (s: string): number => {
          const n = parseFloat(s.replace(/,/g, ''))
          return s.toLowerCase().includes('k') ? n * 1000 : n
        }
        const used = parse(tokenMatch[1])
        const max = parse(tokenMatch[2])
        if (used > 0 && max > 0 && max >= 10000) {
          setContextUsedTokens(Math.round(used))
          setContextMaxTokens(Math.round(max))
          setContextPercent(Math.round((used / max) * 100))
          setContextSource('parsed')
        }
      }

      // Parse cost: "$X.XXXX" or "cost: $X.XX"
      const costMatch = clean.match(/\$(\d+\.\d{2,5})/i)
      if (costMatch) {
        const cost = parseFloat(costMatch[1])
        if (cost > 0 && cost < 100) setSessionCost(cost)
      }

      // Detect clear/compact resets
      if (clean.includes('Conversation has been') || clean.includes('Context cleared') || clean.includes('conversation cleared')) {
        setContextUsedTokens(0)
        setContextPercent(2)
        setContextSource('estimated')
        charCountRef.current = 0
        return
      }

      // Fallback: estimate from character volume (~4 chars per token)
      charCountRef.current += data.length
      if (contextSource === 'estimated') {
        const estTokens = Math.round(charCountRef.current / 4)
        const estPct = Math.min(95, (estTokens / contextMaxTokens) * 100)
        setContextUsedTokens(estTokens)
        setContextPercent(estPct)
      }
    })
    return unsub
  }, [sessionId, contextMaxTokens, contextSource])

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modeRef.current && !modeRef.current.contains(e.target as Node)) setShowModeMenu(false)
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setShowModelMenu(false)
      if (acRef.current && !acRef.current.contains(e.target as Node) &&
          textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        setAcType('none')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = '24px'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }, [text])

  // Load files when browsing for @ mentions
  const loadFiles = useCallback(async (dirPath: string) => {
    setFileLoading(true)
    try {
      const items = await window.api.listDirectory(dirPath || rootPath)
      const relative = (p: string) => {
        const base = rootPath.endsWith('/') ? rootPath : rootPath + '/'
        return p.startsWith(base) ? p.slice(base.length) : p
      }
      const entries: FileEntry[] = items
        .filter(i => !i.name.startsWith('.'))
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        .map(i => ({ ...i, relativePath: relative(i.path) }))
      setFileEntries(entries)
    } catch {
      setFileEntries([])
    }
    setFileLoading(false)
  }, [rootPath])

  // Detect @ and / triggers as user types
  useEffect(() => {
    const cursor = textareaRef.current?.selectionStart ?? text.length
    const before = text.slice(0, cursor)

    // Check for / at start of input
    const slashMatch = before.match(/^\/(\S*)$/)
    if (slashMatch) {
      setAcType('slash')
      setAcQuery(slashMatch[1].toLowerCase())
      setAcIndex(0)
      return
    }

    // Check for @ trigger
    const atMatch = before.match(/@([^\s]*)$/)
    if (atMatch) {
      setAcType('file')
      setAcQuery(atMatch[1].toLowerCase())
      setAcIndex(0)
      const parts = atMatch[1].split('/')
      if (parts.length > 1) {
        const dirPart = parts.slice(0, -1).join('/')
        const newBrowsePath = rootPath + '/' + dirPart
        if (newBrowsePath !== fileBrowsePath) {
          setFileBrowsePath(newBrowsePath)
          loadFiles(newBrowsePath)
        }
      } else if (fileBrowsePath !== rootPath) {
        setFileBrowsePath(rootPath)
        loadFiles(rootPath)
      }
      return
    }

    setAcType('none')
  }, [text, rootPath, fileBrowsePath, loadFiles])

  // Initial file load for @
  useEffect(() => {
    if (rootPath) loadFiles(rootPath)
  }, [rootPath, loadFiles])

  // Filtered slash commands
  const filteredCommands = useMemo(() => {
    if (acType !== 'slash') return []
    return SLASH_COMMANDS.filter(c =>
      c.cmd.toLowerCase().includes(acQuery) || c.desc.toLowerCase().includes(acQuery)
    ).slice(0, 12)
  }, [acType, acQuery])

  // Filtered files
  const filteredFiles = useMemo(() => {
    if (acType !== 'file') return []
    const q = acQuery.split('/').pop() || ''
    return fileEntries.filter(f =>
      f.name.toLowerCase().includes(q)
    ).slice(0, 12)
  }, [acType, acQuery, fileEntries])

  const acItems = acType === 'slash' ? filteredCommands : filteredFiles

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed && images.length === 0) return

    for (const img of images) {
      onImageUpload(img.file)
    }

    if (trimmed) {
      onSend(trimmed)
    }

    setText('')
    setImages([])
    setAcType('none')
    textareaRef.current?.focus()
  }, [text, images, onSend, onImageUpload])

  const insertAutocomplete = useCallback((value: string, isDir: boolean) => {
    const cursor = textareaRef.current?.selectionStart ?? text.length
    const before = text.slice(0, cursor)
    const after = text.slice(cursor)

    if (acType === 'slash') {
      const newText = value + (value === '/model' || value === '/compact' || value === '/resume' || value === '/fork' || value === '/export' || value === '/simplify' ? ' ' : '') + after
      setText(newText)
      setAcType('none')
    } else if (acType === 'file') {
      const atIdx = before.lastIndexOf('@')
      const prefix = before.slice(0, atIdx + 1)
      const relPath = value
      const suffix = isDir ? '/' : ' '
      const newText = prefix + relPath + suffix + after
      setText(newText)
      if (isDir) {
        const newBrowsePath = rootPath + '/' + relPath
        setFileBrowsePath(newBrowsePath)
        loadFiles(newBrowsePath)
      } else {
        setAcType('none')
      }
    }

    setTimeout(() => textareaRef.current?.focus(), 10)
  }, [text, acType, rootPath, loadFiles])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Autocomplete navigation
    if (acType !== 'none' && acItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAcIndex(prev => (prev + 1) % acItems.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAcIndex(prev => (prev - 1 + acItems.length) % acItems.length)
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        const item = acItems[acIndex]
        if (acType === 'slash') {
          insertAutocomplete((item as SlashCommand).cmd, false)
        } else {
          const f = item as FileEntry
          insertAutocomplete(f.relativePath, f.isDir)
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setAcType('none')
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [acType, acItems, acIndex, handleSend, insertAutocomplete])

  const handleModeChange = useCallback((newMode: Mode) => {
    if (newMode !== mode) {
      setMode(newMode)
      if (newMode === 'chat') onSend('/chat')
      else if (newMode === 'plan') onSend('/plan')
    }
    setShowModeMenu(false)
  }, [mode, onSend])

  const handleModelChange = useCallback((idx: number) => {
    if (idx !== modelIdx) {
      setModelIdx(idx)
      onSend(`/model ${MODELS[idx].id}`)
    }
    setShowModelMenu(false)
  }, [modelIdx, onSend])

  // Image handling with thumbnail previews
  const addImageFiles = useCallback((files: File[]) => {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      const preview = URL.createObjectURL(file)
      setImages(prev => [...prev, { name: file.name || 'pasted-image.png', file, preview }])
    }
  }, [])

  // Cleanup object URLs
  useEffect(() => {
    return () => {
      images.forEach(img => URL.revokeObjectURL(img.preview))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const removeImage = useCallback((idx: number) => {
    setImages(prev => {
      URL.revokeObjectURL(prev[idx].preview)
      return prev.filter((_, i) => i !== idx)
    })
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addImageFiles(Array.from(e.target.files))
    e.target.value = ''
  }, [addImageFiles])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (!e.clipboardData) return
    const imageFiles: File[] = []
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault()
      addImageFiles(imageFiles)
    }
  }, [addImageFiles])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer?.files.length) {
      addImageFiles(Array.from(e.dataTransfer.files))
    }
  }, [addImageFiles])

  const contextColor = contextPercent < 50 ? 'var(--green)' : contextPercent < 80 ? 'var(--orange)' : 'var(--red)'

  const modeConfig = {
    agent: { dot: 'agent', label: 'Agent', desc: 'Makes changes, runs commands, edits files' },
    chat: { dot: 'chat', label: 'Chat', desc: 'Conversational — read-only, no tool use' },
    plan: { dot: 'plan', label: 'Plan', desc: 'Plan mode — designs approach before coding' },
  }

  return (
    <div
      className="chat-input-bar"
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
    >
      {/* Image thumbnails */}
      {images.length > 0 && (
        <div className="chat-input-images">
          {images.map((img, i) => (
            <div key={i} className="chat-input-image-thumb">
              <img src={img.preview} alt={img.name} className="chat-input-thumb-img" />
              <button className="chat-input-thumb-remove" onClick={() => removeImage(i)}>×</button>
              <div className="chat-input-thumb-name">{img.name}</div>
            </div>
          ))}
        </div>
      )}

      {/* Textarea with autocomplete */}
      <div className="chat-input-textarea-wrap">
        <textarea
          ref={textareaRef}
          className="chat-input-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            mode === 'chat' ? 'Ask a question... (@ files, / commands)'
            : mode === 'plan' ? 'Describe what to plan... (@ files, / commands)'
            : 'Tell Claude what to do... (@ files, / commands)'
          }
          disabled={disabled}
          rows={1}
        />
        <button
          className={`chat-input-send ${text.trim() || images.length > 0 ? 'active' : ''}`}
          onClick={handleSend}
          disabled={disabled || (!text.trim() && images.length === 0)}
          title="Send (Enter)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.7 1.7a.5.5 0 0 1 .6-.1l12 6a.5.5 0 0 1 0 .8l-12 6a.5.5 0 0 1-.7-.5V8.5h6a.5.5 0 0 0 0-1h-6V2.2a.5.5 0 0 1 .1-.5z"/>
          </svg>
        </button>

        {/* Autocomplete popup */}
        {acType !== 'none' && acItems.length > 0 && (
          <div className="chat-ac-popup" ref={acRef}>
            {acType === 'slash' && (
              <div className="chat-ac-header">Commands</div>
            )}
            {acType === 'file' && (
              <div className="chat-ac-header">
                <span>Files</span>
                {fileBrowsePath !== rootPath && (
                  <span className="chat-ac-breadcrumb">
                    {fileBrowsePath.replace(rootPath, '').replace(/^\//, '')}
                  </span>
                )}
              </div>
            )}
            <div className="chat-ac-list">
              {acType === 'slash' && filteredCommands.map((cmd, i) => (
                <button
                  key={cmd.cmd}
                  className={`chat-ac-item ${i === acIndex ? 'active' : ''}`}
                  onMouseEnter={() => setAcIndex(i)}
                  onClick={() => insertAutocomplete(cmd.cmd, false)}
                >
                  <span className="chat-ac-cmd">{cmd.cmd}</span>
                  <span className="chat-ac-desc">{cmd.desc}</span>
                </button>
              ))}
              {acType === 'file' && filteredFiles.map((f, i) => (
                <button
                  key={f.path}
                  className={`chat-ac-item ${i === acIndex ? 'active' : ''}`}
                  onMouseEnter={() => setAcIndex(i)}
                  onClick={() => insertAutocomplete(f.relativePath, f.isDir)}
                >
                  <span className={`chat-ac-file-icon ${f.isDir ? 'dir' : 'file'}`}>
                    {f.isDir ? '▸' : '○'}
                  </span>
                  <span className="chat-ac-filename">{f.name}</span>
                  {f.isDir && <span className="chat-ac-desc">folder</span>}
                </button>
              ))}
              {fileLoading && <div className="chat-ac-loading">Loading...</div>}
            </div>
            <div className="chat-ac-footer">
              <kbd>↑↓</kbd> navigate <kbd>Tab</kbd> select <kbd>Esc</kbd> close
            </div>
          </div>
        )}
      </div>

      {/* Controls row */}
      <div className="chat-input-controls">
        <div className="chat-input-controls-left">
          {/* Mode selector */}
          <div className="chat-input-dropdown" ref={modeRef}>
            <button className="chat-input-pill" onClick={() => setShowModeMenu(!showModeMenu)}>
              <span className={`chat-input-mode-dot ${mode}`} />
              {modeConfig[mode].label}
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.5 }}>
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none"/>
              </svg>
            </button>
            {showModeMenu && (
              <div className="chat-input-menu">
                {(Object.entries(modeConfig) as [Mode, typeof modeConfig.agent][]).map(([key, cfg]) => (
                  <button
                    key={key}
                    className={`chat-input-menu-item ${mode === key ? 'selected' : ''}`}
                    onClick={() => handleModeChange(key)}
                  >
                    <span className={`chat-input-mode-dot ${cfg.dot}`} />
                    <div>
                      <div className="chat-input-menu-label">{cfg.label}</div>
                      <div className="chat-input-menu-desc">{cfg.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Model selector */}
          <div className="chat-input-dropdown" ref={modelRef}>
            <button className="chat-input-pill" onClick={() => setShowModelMenu(!showModelMenu)}>
              {MODELS[modelIdx].short}
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.5 }}>
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none"/>
              </svg>
            </button>
            {showModelMenu && (
              <div className="chat-input-menu model-menu">
                {MODELS.map((m, i) => (
                  <button
                    key={m.id}
                    className={`chat-input-menu-item ${modelIdx === i ? 'selected' : ''}`}
                    onClick={() => handleModelChange(i)}
                  >
                    <div>
                      <div className="chat-input-menu-label">{m.label}</div>
                      <div className="chat-input-menu-desc">{m.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Image upload */}
          <button
            className="chat-input-icon-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Attach image (or paste / drag-drop)"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.5 3A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13h7a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 11.5 3h-7zM2 4.5A2.5 2.5 0 0 1 4.5 2h7A2.5 2.5 0 0 1 14 4.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 11.5v-7zm4.5 2a1 1 0 1 0-2 0 1 1 0 0 0 2 0zM5.5 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm-.3 7l2.8-3.5 2 2.5 1.5-1.5 1.5 2.5H5.2z"/>
            </svg>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
          </button>

          {/* @ file shortcut button */}
          <button
            className="chat-input-icon-btn"
            onClick={() => {
              setText(prev => prev + '@')
              textareaRef.current?.focus()
            }}
            title="Mention file (@)"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a7 7 0 1 0 3.5 13.06.5.5 0 0 0-.5-.87A6 6 0 1 1 14 8c0 1.12-.5 2-1.5 2-.83 0-1.25-.5-1.25-1.25V5.5a.5.5 0 0 0-1 0v.27A3 3 0 1 0 11 10.75c.44.72 1.2 1.25 2.25 1.25C14.75 12 16 10.56 16 8A8 8 0 0 0 8 1zm0 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>
            </svg>
          </button>

          {/* / command shortcut button */}
          <button
            className="chat-input-icon-btn"
            onClick={() => {
              setText('/')
              textareaRef.current?.focus()
            }}
            title="Commands (/)"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5.56 14a.5.5 0 0 1-.46-.3l-.03-.1L3.1 6.97a.5.5 0 0 1 .87-.49l.04.06L5.56 12 10.44 2a.5.5 0 0 1 .87.49l-.04.06-5.25 11.14a.5.5 0 0 1-.46.31z"/>
            </svg>
          </button>
        </div>

        <div className="chat-input-controls-right">
          {sessionCost > 0 && (
            <span className="chat-input-cost" title="Session cost">
              ${sessionCost < 0.01 ? sessionCost.toFixed(4) : sessionCost.toFixed(2)}
            </span>
          )}

          {/* Context usage — tokens used / max with bar */}
          <div
            className="chat-input-context"
            title={`${formatTokens(contextUsedTokens)} / ${formatTokens(contextMaxTokens)} tokens (${Math.round(contextPercent)}%)${contextSource === 'estimated' ? ' — estimated' : ''}`}
          >
            <div className="chat-input-context-bar">
              <div className="chat-input-context-fill" style={{ width: `${Math.min(contextPercent, 100)}%`, background: contextColor }} />
            </div>
            <span className="chat-input-context-label">
              {formatTokens(contextUsedTokens)}<span className="chat-input-context-sep">/</span>{formatTokens(contextMaxTokens)}
            </span>
          </div>

          <span className="chat-input-hint">
            <kbd>⏎</kbd> send · <kbd>⇧⏎</kbd> newline
          </span>
        </div>
      </div>
    </div>
  )
}
