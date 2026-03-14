import React, { useState, useRef, useCallback, useEffect } from 'react'

interface Props {
  sessionId: string
  onSend: (text: string) => void
  onImageUpload: (file: File) => void
  disabled?: boolean
}

type Mode = 'agent' | 'chat'

const MODELS = [
  { id: 'claude-sonnet-4-20250514', label: 'Sonnet 4', short: 'Sonnet 4' },
  { id: 'claude-opus-4-20250514', label: 'Opus 4', short: 'Opus 4' },
  { id: 'claude-sonnet-4-20250514', label: 'Sonnet 4 (Thinking)', short: 'Sonnet 4+' },
  { id: 'claude-haiku-3.5', label: 'Haiku 3.5', short: 'Haiku 3.5' },
]

export function ChatInputBar({ sessionId, onSend, onImageUpload, disabled }: Props) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState<Mode>('agent')
  const [modelIdx, setModelIdx] = useState(0)
  const [images, setImages] = useState<{ name: string; file: File }[]>([])
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [contextPercent, setContextPercent] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modeRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setContextPercent(0)
    setText('')
    setImages([])
  }, [sessionId])

  // Track rough context usage from PTY output length
  useEffect(() => {
    const unsub = window.api.onPtyData(({ sessionId: sid }) => {
      if (sid === sessionId) {
        setContextPercent(prev => Math.min(95, prev + 0.15))
      }
    })
    return unsub
  }, [sessionId])

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modeRef.current && !modeRef.current.contains(e.target as Node)) setShowModeMenu(false)
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setShowModelMenu(false)
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
    textareaRef.current?.focus()
  }, [text, images, onSend, onImageUpload])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleModeChange = useCallback((newMode: Mode) => {
    if (newMode !== mode) {
      setMode(newMode)
      if (newMode === 'chat') {
        onSend('/chat')
      }
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

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        setImages(prev => [...prev, { name: file.name, file }])
      }
    }
    e.target.value = ''
  }, [])

  const removeImage = useCallback((idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (!e.clipboardData) return
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) {
          setImages(prev => [...prev, { name: file.name || 'pasted-image.png', file }])
        }
        return
      }
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (!e.dataTransfer?.files.length) return
    for (const file of Array.from(e.dataTransfer.files)) {
      if (file.type.startsWith('image/')) {
        setImages(prev => [...prev, { name: file.name, file }])
      }
    }
  }, [])

  const contextColor = contextPercent < 50 ? 'var(--green)' : contextPercent < 80 ? 'var(--orange)' : 'var(--red)'

  return (
    <div
      className="chat-input-bar"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {images.length > 0 && (
        <div className="chat-input-images">
          {images.map((img, i) => (
            <div key={i} className="chat-input-image-chip">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
                <path d="M14.5 2.5h-13A.5.5 0 0 0 1 3v10a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5V3a.5.5 0 0 0-.5-.5zM5.3 4a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zm8.2 8H2.5l3-4 2 2.5 3-3.5 3 5z"/>
              </svg>
              <span className="chat-input-image-name">{img.name}</span>
              <button className="chat-input-image-remove" onClick={() => removeImage(i)}>×</button>
            </div>
          ))}
        </div>
      )}

      <div className="chat-input-textarea-wrap">
        <textarea
          ref={textareaRef}
          className="chat-input-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={mode === 'chat' ? 'Ask a question...' : 'Tell Claude what to do...'}
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
      </div>

      <div className="chat-input-controls">
        <div className="chat-input-controls-left">
          {/* Mode selector */}
          <div className="chat-input-dropdown" ref={modeRef}>
            <button
              className="chat-input-pill"
              onClick={() => setShowModeMenu(!showModeMenu)}
            >
              <span className={`chat-input-mode-dot ${mode}`} />
              {mode === 'agent' ? 'Agent' : 'Chat'}
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.5 }}>
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none"/>
              </svg>
            </button>
            {showModeMenu && (
              <div className="chat-input-menu">
                <button
                  className={`chat-input-menu-item ${mode === 'agent' ? 'selected' : ''}`}
                  onClick={() => handleModeChange('agent')}
                >
                  <span className="chat-input-mode-dot agent" />
                  <div>
                    <div className="chat-input-menu-label">Agent</div>
                    <div className="chat-input-menu-desc">Claude makes changes, runs commands</div>
                  </div>
                </button>
                <button
                  className={`chat-input-menu-item ${mode === 'chat' ? 'selected' : ''}`}
                  onClick={() => handleModeChange('chat')}
                >
                  <span className="chat-input-mode-dot chat" />
                  <div>
                    <div className="chat-input-menu-label">Chat</div>
                    <div className="chat-input-menu-desc">Conversational — no tool use</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Model selector */}
          <div className="chat-input-dropdown" ref={modelRef}>
            <button
              className="chat-input-pill"
              onClick={() => setShowModelMenu(!showModelMenu)}
            >
              {MODELS[modelIdx].short}
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.5 }}>
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none"/>
              </svg>
            </button>
            {showModelMenu && (
              <div className="chat-input-menu model-menu">
                {MODELS.map((m, i) => (
                  <button
                    key={m.id + i}
                    className={`chat-input-menu-item ${modelIdx === i ? 'selected' : ''}`}
                    onClick={() => handleModelChange(i)}
                  >
                    <div className="chat-input-menu-label">{m.label}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Image upload */}
          <button
            className="chat-input-icon-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Attach image"
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
        </div>

        <div className="chat-input-controls-right">
          {/* Context usage */}
          <div className="chat-input-context" title={`~${Math.round(contextPercent)}% context window used`}>
            <div className="chat-input-context-bar">
              <div
                className="chat-input-context-fill"
                style={{ width: `${contextPercent}%`, background: contextColor }}
              />
            </div>
            <span className="chat-input-context-label">
              {Math.round(contextPercent)}%
            </span>
          </div>

          <span className="chat-input-hint">
            <kbd>Shift+Enter</kbd> newline
          </span>
        </div>
      </div>
    </div>
  )
}
