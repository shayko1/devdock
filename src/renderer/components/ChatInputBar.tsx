import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'

interface Props {
  sessionId: string
  rootPath: string
  onSend: (text: string) => void
  onImageUpload: (file: File) => void
  disabled?: boolean
}

type Mode = 'agent' | 'chat' | 'plan'

// Context window sizes per model family
const MODEL_CONTEXT_SIZES: Record<string, number> = {
  'opus': 200_000,
  'opus-4': 200_000,
  'opus-4-6': 1_000_000,
  'claude-opus-4-6': 1_000_000,
  'sonnet': 200_000,
  'sonnet-4': 200_000,
  'sonnet-4-6': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'haiku': 200_000,
  'haiku-3.5': 200_000,
  'haiku-4.5': 200_000,
  'claude-haiku-4-5': 200_000,
}

function contextSizeForModel(modelId: string): number {
  const lower = modelId.toLowerCase().trim()
  for (const [key, val] of Object.entries(MODEL_CONTEXT_SIZES)) {
    if (lower.includes(key)) return val
  }
  return 200_000
}

const MODELS = [
  { id: 'sonnet', label: 'Claude Sonnet 4', short: 'Sonnet 4', desc: 'Fast & capable', ctx: 200_000 },
  { id: 'opus', label: 'Claude Opus 4', short: 'Opus 4', desc: 'Most powerful', ctx: 200_000 },
  { id: 'haiku', label: 'Claude Haiku 3.5', short: 'Haiku 3.5', desc: 'Fastest, cheapest', ctx: 200_000 },
  { id: 'sonnet thinking', label: 'Sonnet 4 (Thinking)', short: 'Sonnet 4+', desc: 'Extended thinking', ctx: 200_000 },
  { id: 'opus thinking', label: 'Opus 4 (Thinking)', short: 'Opus 4+', desc: 'Max intelligence', ctx: 200_000 },
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

interface FileResult {
  name: string
  path: string
  relativePath: string
  isDir: boolean
}

type SessionStatus = 'idle' | 'thinking' | 'writing' | 'tool' | 'waiting' | 'compact'

const STATUS_CONFIG: Record<SessionStatus, { label: string; color: string; icon: string }> = {
  idle: { label: 'Ready', color: 'var(--green)', icon: '●' },
  thinking: { label: 'Thinking...', color: 'var(--orange)', icon: '◉' },
  writing: { label: 'Writing...', color: 'var(--accent)', icon: '✎' },
  tool: { label: 'Running tool...', color: 'var(--purple, #a371f7)', icon: '⚙' },
  waiting: { label: 'Waiting for input', color: 'var(--text-muted)', icon: '◯' },
  compact: { label: 'Compacting...', color: 'var(--orange)', icon: '⟳' },
}

const COMPACT_THRESHOLD = 80
const CRITICAL_THRESHOLD = 92

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

  // Context tracking (real from Claude Code statusline data or estimated)
  const [contextUsedTokens, setContextUsedTokens] = useState(0)
  const [contextMaxTokens, setContextMaxTokens] = useState(200_000)
  const [contextPercent, setContextPercent] = useState(0)
  const [contextSource, setContextSource] = useState<'parsed' | 'estimated'>('estimated')
  const [sessionCost, setSessionCost] = useState(0)
  const [detectedModel, setDetectedModel] = useState('')
  const charCountRef = useRef(0)

  // Session status
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle')
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Compact suggestion
  const [showCompactHint, setShowCompactHint] = useState(false)
  const compactDismissedRef = useRef(false)

  // Autocomplete state
  const [acType, setAcType] = useState<'none' | 'slash' | 'file'>('none')
  const [acQuery, setAcQuery] = useState('')
  const [acIndex, setAcIndex] = useState(0)
  const [fileResults, setFileResults] = useState<FileResult[]>([])
  const [fileLoading, setFileLoading] = useState(false)
  const fileSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modeRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<HTMLDivElement>(null)
  const acRef = useRef<HTMLDivElement>(null)

  // Reset on session change
  useEffect(() => {
    setContextUsedTokens(0)
    setContextMaxTokens(200_000)
    setContextPercent(0)
    setContextSource('estimated')
    setSessionCost(0)
    setDetectedModel('')
    setSessionStatus('idle')
    setShowCompactHint(false)
    compactDismissedRef.current = false
    charCountRef.current = 0
    setText('')
    setImages([])
    setAcType('none')
  }, [sessionId])

  // PTY data listener — parse real-time context, status, model, cost
  useEffect(() => {
    const strip = (s: string) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')

    const unsub = window.api.onPtyData(({ sessionId: sid, data }) => {
      if (sid !== sessionId) return
      const clean = strip(data)

      // ── Model detection ──
      // Claude Code outputs model info: "model: claude-sonnet-4-6", "Using Claude Sonnet 4"
      const modelIdMatch = clean.match(/model[:\s]+["']?(claude-[a-z0-9.-]+)/i)
        || clean.match(/Using\s+(Claude\s+\w+\s*\d*(?:\.\d+)?)/i)
      if (modelIdMatch) {
        const m = modelIdMatch[1].trim()
        setDetectedModel(m)
        const newMax = contextSizeForModel(m)
        setContextMaxTokens(newMax)
      }

      // ── Context window from statusline JSON fragments ──
      // Claude Code sends statusline data containing context_window object
      const cwSizeMatch = clean.match(/context_window_size["\s:]+(\d+)/i)
      if (cwSizeMatch) {
        const cws = parseInt(cwSizeMatch[1], 10)
        if (cws >= 100_000) setContextMaxTokens(cws)
      }

      const usedPctMatch = clean.match(/used_percentage["\s:]+(\d+(?:\.\d+)?)/i)
      if (usedPctMatch) {
        const pct = parseFloat(usedPctMatch[1])
        if (pct >= 0 && pct <= 100) {
          setContextPercent(pct)
          setContextUsedTokens(prev => {
            const fromPct = Math.round((pct / 100) * contextMaxTokens)
            return fromPct || prev
          })
          setContextSource('parsed')
        }
      }

      // ── Context percentage from terminal text ──
      const pctMatch = clean.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?context/i)
        || clean.match(/Context:\s*(\d+(?:\.\d+)?)\s*%/i)
      if (pctMatch) {
        const pct = parseFloat(pctMatch[1])
        if (pct >= 0 && pct <= 100) {
          setContextPercent(pct)
          setContextUsedTokens(Math.round((pct / 100) * contextMaxTokens))
          setContextSource('parsed')
        }
      }

      // ── Token counts "XXk/200k tokens" ──
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

      // ── Cost tracking ──
      const costMatch = clean.match(/total_cost_usd["\s:]+(\d+\.?\d*)/i)
        || clean.match(/\$(\d+\.\d{2,5})/i)
      if (costMatch) {
        const cost = parseFloat(costMatch[1])
        if (cost > 0 && cost < 1000) setSessionCost(cost)
      }

      // ── Session status detection ──
      // Thinking indicators
      if (clean.includes('Thinking') || clean.includes('thinking...') || clean.match(/⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/)) {
        setSessionStatus('thinking')
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
        statusTimerRef.current = setTimeout(() => setSessionStatus('idle'), 30000)
      }
      // Tool execution
      else if (clean.match(/Running|Executing|Reading|Writing|Searching|Editing/i) && clean.match(/\.\.\.|…/)) {
        setSessionStatus('tool')
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
        statusTimerRef.current = setTimeout(() => setSessionStatus('idle'), 30000)
      }
      // Writing code / generating output
      else if (clean.match(/^[│┃├┌└─┐┘┤┬┴┼╔╗╚╝╠╣╦╩╬]/) || clean.match(/\s{2,}(import|export|function|const|let|var|class|def|if|for|while)\s/)) {
        setSessionStatus('writing')
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
        statusTimerRef.current = setTimeout(() => setSessionStatus('idle'), 10000)
      }
      // Compacting
      else if (clean.includes('Compacting') || clean.includes('compacting') || clean.includes('Summarizing conversation')) {
        setSessionStatus('compact')
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
        statusTimerRef.current = setTimeout(() => setSessionStatus('idle'), 60000)
      }

      // Prompt waiting (Claude Code shows ">" or "❯" when waiting)
      if (clean.match(/^[>❯]\s*$/) || clean.includes('What would you like')) {
        setSessionStatus('idle')
        if (statusTimerRef.current) { clearTimeout(statusTimerRef.current); statusTimerRef.current = null }
      }

      // Clear/compact resets
      if (clean.includes('Conversation has been') || clean.includes('Context cleared') || clean.includes('conversation cleared') || clean.includes('compacted to')) {
        setContextUsedTokens(0)
        setContextPercent(2)
        setContextSource('estimated')
        charCountRef.current = 0
        setShowCompactHint(false)
        compactDismissedRef.current = false
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
    return () => {
      unsub()
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    }
  }, [sessionId, contextMaxTokens, contextSource])

  // Show compact suggestion when context is high
  useEffect(() => {
    if (contextPercent >= COMPACT_THRESHOLD && !compactDismissedRef.current && !showCompactHint) {
      setShowCompactHint(true)
    }
  }, [contextPercent, showCompactHint])

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

  // File search by name (debounced)
  const searchFilesByName = useCallback(async (query: string) => {
    if (!query.trim()) {
      setFileResults([])
      setFileLoading(false)
      return
    }
    setFileLoading(true)
    try {
      const results = await window.api.findFilesByName(rootPath, query)
      setFileResults(results)
    } catch {
      setFileResults([])
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

    // Check for @ trigger — search by filename
    const atMatch = before.match(/@([^\s]*)$/)
    if (atMatch) {
      setAcType('file')
      const q = atMatch[1]
      setAcQuery(q.toLowerCase())
      setAcIndex(0)

      // Debounced file search
      if (fileSearchTimer.current) clearTimeout(fileSearchTimer.current)
      fileSearchTimer.current = setTimeout(() => searchFilesByName(q), 150)
      return
    }

    setAcType('none')
  }, [text, searchFilesByName])

  // Filtered slash commands
  const filteredCommands = useMemo(() => {
    if (acType !== 'slash') return []
    return SLASH_COMMANDS.filter(c =>
      c.cmd.toLowerCase().includes(acQuery) || c.desc.toLowerCase().includes(acQuery)
    ).slice(0, 12)
  }, [acType, acQuery])

  const acItems = acType === 'slash' ? filteredCommands : fileResults

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
      const newText = prefix + value + ' ' + after
      setText(newText)
      setAcType('none')
    }

    setTimeout(() => textareaRef.current?.focus(), 10)
  }, [text, acType])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
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
          const f = item as FileResult
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
      setContextMaxTokens(MODELS[idx].ctx)
    }
    setShowModelMenu(false)
  }, [modelIdx, onSend])

  const handleCompactNow = useCallback(() => {
    onSend('/compact')
    setShowCompactHint(false)
    compactDismissedRef.current = true
  }, [onSend])

  const dismissCompactHint = useCallback(() => {
    setShowCompactHint(false)
    compactDismissedRef.current = true
  }, [])

  // Image handling
  const addImageFiles = useCallback((files: File[]) => {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      const preview = URL.createObjectURL(file)
      setImages(prev => [...prev, { name: file.name || 'pasted-image.png', file, preview }])
    }
  }, [])

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

  const contextColor = contextPercent < 50 ? 'var(--green)' : contextPercent < COMPACT_THRESHOLD ? 'var(--orange)' : 'var(--red)'
  const statusCfg = STATUS_CONFIG[sessionStatus]

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
      {/* Compact / summary suggestion banner */}
      {showCompactHint && (
        <div className="chat-compact-hint">
          <span className="chat-compact-hint-icon">⚠</span>
          <span>
            Context is {Math.round(contextPercent)}% full.
            {contextPercent >= CRITICAL_THRESHOLD
              ? ' Auto-compact may trigger soon — consider running /compact now to stay in control.'
              : ' Consider running /compact to free up space and keep responses sharp.'}
          </span>
          <button className="btn btn-xs btn-accent" onClick={handleCompactNow}>/compact</button>
          <button className="btn btn-xs" onClick={() => { onSend('/compact with a detailed summary'); setShowCompactHint(false); compactDismissedRef.current = true }}>
            /compact summary
          </button>
          <button className="chat-compact-hint-dismiss" onClick={dismissCompactHint}>×</button>
        </div>
      )}

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
                {acQuery && <span className="chat-ac-breadcrumb">searching: {acQuery}</span>}
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
              {acType === 'file' && fileResults.map((f, i) => (
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
                  <span className="chat-ac-file-path">{f.relativePath}</span>
                </button>
              ))}
              {acType === 'file' && fileLoading && <div className="chat-ac-loading">Searching...</div>}
              {acType === 'file' && !fileLoading && acQuery && fileResults.length === 0 && (
                <div className="chat-ac-loading">No files found</div>
              )}
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
          {/* Session status indicator */}
          <span
            className="chat-input-status"
            style={{ color: statusCfg.color }}
            title={statusCfg.label + (detectedModel ? ` · ${detectedModel}` : '')}
          >
            <span className={`chat-input-status-dot ${sessionStatus}`}>{statusCfg.icon}</span>
            {sessionStatus !== 'idle' && <span className="chat-input-status-text">{statusCfg.label}</span>}
          </span>

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
              {detectedModel || MODELS[modelIdx].short}
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
                      <div className="chat-input-menu-desc">{m.desc} · {formatTokens(m.ctx)} ctx</div>
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
            title="Search files (@)"
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
            <span className="chat-input-cost" title={`Session cost: $${sessionCost.toFixed(4)}`}>
              ${sessionCost < 0.01 ? sessionCost.toFixed(4) : sessionCost.toFixed(2)}
            </span>
          )}

          {/* Context usage — tokens used / max with bar */}
          <div
            className="chat-input-context"
            title={[
              `${formatTokens(contextUsedTokens)} / ${formatTokens(contextMaxTokens)} tokens (${Math.round(contextPercent)}%)`,
              contextSource === 'estimated' ? 'Estimated from character volume' : 'From Claude Code',
              detectedModel ? `Model: ${detectedModel}` : '',
              contextPercent >= COMPACT_THRESHOLD ? 'Tip: Run /compact to free space' : '',
            ].filter(Boolean).join('\n')}
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
