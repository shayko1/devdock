import React, { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import './XTerminal.css'

interface Props {
  sessionId: string
  active: boolean
  onWaitingChange?: (waiting: boolean) => void
}

const DARK_THEME = {
  background: '#0d1117',
  foreground: '#e6edf3',
  cursor: '#58a6ff',
  selectionBackground: '#264f78',
  selectionForeground: '#ffffff',
  black: '#0d1117',
  red: '#f85149',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#e6edf3',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#ffffff',
}

async function handleImageFile(file: File, sessionId: string): Promise<string | null> {
  const buffer = await file.arrayBuffer()
  const result = await window.api.saveTempImage({
    name: file.name,
    data: Array.from(new Uint8Array(buffer)),
    sessionId,
  })
  return result.path || null
}

// Improved URL regex: matches http(s) URLs, strips trailing punctuation that's not part of the URL
const URL_REGEX = /https?:\/\/[^\s<>"'`\x00-\x1f]+/g
function cleanUrl(raw: string): string {
  // Strip trailing punctuation that's unlikely to be part of the URL
  // but preserve balanced parens (common in Wikipedia URLs)
  let url = raw
  // Remove trailing dots, commas, semicolons, colons, exclamation, question marks
  url = url.replace(/[.,;:!?]+$/, '')
  // Remove trailing single closing chars if unbalanced
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  while (url.length > 0) {
    const last = url[url.length - 1]
    const opener = pairs[last]
    if (!opener) break
    // Count openers vs closers in the URL
    const opens = (url.match(new RegExp('\\' + opener, 'g')) || []).length
    const closes = (url.match(new RegExp('\\' + last, 'g')) || []).length
    if (closes > opens) {
      url = url.slice(0, -1)
    } else {
      break
    }
  }
  return url
}

export function XTerminal({ sessionId, active, onWaitingChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const unsubDataRef = useRef<(() => void) | null>(null)
  const unsubExitRef = useRef<(() => void) | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const waitingRef = useRef(false)
  const onWaitingChangeRef = useRef(onWaitingChange)
  onWaitingChangeRef.current = onWaitingChange
  // Track saved scroll position for tab switches (viewportY is lost on display:none)
  const savedScrollRef = useRef<{ viewportY: number; baseY: number } | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    let fontSize = 14
    const term = new Terminal({
      fontSize,
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Menlo', monospace",
      lineHeight: 1.4,
      letterSpacing: 0.3,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      theme: DARK_THEME,
      allowProposedApi: true,
      rightClickSelectsWord: true,
      scrollback: 10000,
      scrollOnUserInput: true,
      overviewRuler: undefined,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    // Defer term.open() until container is visible — xterm.js crashes with
    // "Cannot read properties of undefined (reading 'width')" when opened
    // in a display:none container because it can't measure cell dimensions.
    const openWhenVisible = () => {
      const el = containerRef.current
      if (el && el.clientWidth > 0 && el.clientHeight > 0) {
        term.open(el)
        try { fitAddon.fit() } catch { /* render dimensions not ready yet */ }
        return true
      }
      return false
    }

    if (!openWhenVisible()) {
      const retryInterval = setInterval(() => {
        if (openWhenVisible()) clearInterval(retryInterval)
      }, 50)
      // Safety: stop retrying after 5 seconds
      setTimeout(() => clearInterval(retryInterval), 5000)
    }

    termRef.current = term
    fitAddonRef.current = fitAddon

    // Helper to fit terminal while preserving scroll position
    // Skips fit if cols/rows haven't changed to prevent unnecessary redraws (flickering)
    let lastCols = term.cols
    let lastRows = term.rows
    const safeFit = () => {
      try {
        const dims = fitAddon.proposeDimensions()
        if (!dims) return
        if (dims.cols === lastCols && dims.rows === lastRows) return
        lastCols = dims.cols
        lastRows = dims.rows
        const buf = term.buffer.active
        const wasAtBottom = buf.viewportY >= buf.baseY
        fitAddon.fit()
        if (wasAtBottom) {
          term.scrollToBottom()
        }
      } catch {
        // FitAddon can throw when render service dimensions aren't available yet
      }
    }

    // ── Link detection ──
    // Use registerLinkProvider for robust URL detection with proper cleanup
    term.registerLinkProvider({
      provideLinks(bufferLineNumber: number, callback: (links: any[] | undefined) => void) {
        const line = term.buffer.active.getLine(bufferLineNumber - 1)
        if (!line) { callback(undefined); return }
        const text = line.translateToString()
        const links: any[] = []
        let match
        URL_REGEX.lastIndex = 0
        while ((match = URL_REGEX.exec(text)) !== null) {
          const raw = match[0]
          const url = cleanUrl(raw)
          if (url.length < 10) continue // skip degenerate matches like "http://x"
          links.push({
            range: {
              start: { x: match.index + 1, y: bufferLineNumber },
              end: { x: match.index + url.length + 1, y: bufferLineNumber }
            },
            text: url,
            activate() {
              window.api.openInBrowser(url)
            }
          })
        }
        callback(links.length > 0 ? links : undefined)
      }
    })

    // ── Keyboard shortcuts ──
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== 'keydown') return true
      const isMeta = e.metaKey || e.ctrlKey

      // Cmd+C — copy selection to clipboard, prevent xterm from sending ^C
      if (isMeta && e.key === 'c' && term.hasSelection()) {
        const selection = term.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
        }
        return false
      }

      // Cmd+V — let xterm handle paste natively (flows through onData -> ptyWrite)
      if (isMeta && e.key === 'v') {
        return true
      }

      // Cmd+A — select all terminal content
      if (isMeta && e.key === 'a') {
        term.selectAll()
        return false
      }

      // Shift+Enter — insert newline via bracketed paste so Claude treats it as
      // a literal newline character rather than "submit"
      if (e.shiftKey && e.key === 'Enter') {
        window.api.ptyWrite(sessionId, '\x1b[200~\n\x1b[201~')
        return false
      }

      // Cmd+K — clear terminal
      if (isMeta && e.key === 'k') {
        term.clear()
        return false
      }

      // Cmd+= or Cmd++ — increase font size
      if (isMeta && (e.key === '=' || e.key === '+')) {
        fontSize = Math.min(28, fontSize + 1)
        term.options.fontSize = fontSize
        safeFit()
        return false
      }

      // Cmd+- — decrease font size
      if (isMeta && e.key === '-') {
        fontSize = Math.max(11, fontSize - 1)
        term.options.fontSize = fontSize
        safeFit()
        return false
      }

      // Cmd+0 — reset font size
      if (isMeta && e.key === '0') {
        fontSize = 14
        term.options.fontSize = fontSize
        safeFit()
        return false
      }

      return true
    })

    // ── PTY data flow ──

    // Send input to PTY
    term.onData((data) => {
      window.api.ptyWrite(sessionId, data)
      if (waitingRef.current) {
        waitingRef.current = false
        onWaitingChangeRef.current?.(false)
      }
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    })

    // Receive output from PTY
    unsubDataRef.current = window.api.onPtyData(({ sessionId: sid, data }) => {
      if (sid === sessionId) {
        term.write(data)
        if (waitingRef.current) {
          waitingRef.current = false
          onWaitingChangeRef.current?.(false)
        }
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
        idleTimerRef.current = setTimeout(() => {
          waitingRef.current = true
          onWaitingChangeRef.current?.(true)
        }, 8000)
      }
    })

    // Handle PTY exit
    unsubExitRef.current = window.api.onPtyExit(({ sessionId: sid, exitCode }) => {
      if (sid === sessionId) {
        term.writeln(`\r\n\x1b[2m[session ended with code ${exitCode}]\x1b[0m`)
      }
    })

    // Handle resize — notify PTY of new dimensions
    term.onResize(({ cols, rows }) => {
      window.api.ptyResize(sessionId, cols, rows)
    })

    // ── Paste handling ──
    // Intercept on xterm's internal textarea to catch images before xterm processes paste
    const xtermTextarea = containerRef.current.querySelector('textarea.xterm-helper-textarea') as HTMLTextAreaElement | null
    const pasteTarget = xtermTextarea || containerRef.current

    const handlePaste = async (e: ClipboardEvent) => {
      if (!e.clipboardData) return

      for (const item of Array.from(e.clipboardData.items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          e.stopImmediatePropagation()
          const file = item.getAsFile()
          if (!file) continue

          term.writeln('\r\n\x1b[33m[Saving image from clipboard...]\x1b[0m')
          const imagePath = await handleImageFile(file, sessionId)
          if (imagePath) {
            term.writeln(`\x1b[32m[Image saved: ${imagePath}]\x1b[0m`)
            window.api.ptyWrite(sessionId, imagePath)
          } else {
            term.writeln('\x1b[31m[Failed to save image]\x1b[0m')
          }
          return
        }
      }
      // Text paste — let xterm handle natively (flows through onData -> ptyWrite)
    }

    // ── Drag and drop ──
    const container = containerRef.current
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy'
      }
      container?.classList.add('xterminal-dragover')
    }

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault()
      container?.classList.remove('xterminal-dragover')
    }

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      container?.classList.remove('xterminal-dragover')

      if (!e.dataTransfer?.files.length) return

      for (const file of Array.from(e.dataTransfer.files)) {
        if (file.type.startsWith('image/')) {
          term.writeln(`\r\n\x1b[33m[Saving dropped image: ${file.name}...]\x1b[0m`)
          const imagePath = await handleImageFile(file, sessionId)
          if (imagePath) {
            term.writeln(`\x1b[32m[Image saved: ${imagePath}]\x1b[0m`)
            window.api.ptyWrite(sessionId, imagePath)
          } else {
            term.writeln('\x1b[31m[Failed to save image]\x1b[0m')
          }
        } else {
          const filePath = (file as any).path
          if (filePath) {
            window.api.ptyWrite(sessionId, filePath)
          }
        }
      }
    }

    // Attach event listeners
    pasteTarget.addEventListener('paste', handlePaste, true)
    container?.addEventListener('dragover', handleDragOver)
    container?.addEventListener('dragleave', handleDragLeave)
    container?.addEventListener('drop', handleDrop)

    // ── Resize observer ──
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (containerRef.current && containerRef.current.clientWidth > 0) {
          safeFit()
        }
      }, 80)
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      if (resizeTimer) clearTimeout(resizeTimer)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      pasteTarget.removeEventListener('paste', handlePaste, true)
      container?.removeEventListener('dragover', handleDragOver)
      container?.removeEventListener('dragleave', handleDragLeave)
      container?.removeEventListener('drop', handleDrop)
      unsubDataRef.current?.()
      unsubExitRef.current?.()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [sessionId])

  // Save scroll position when tab becomes inactive
  useEffect(() => {
    if (!active && termRef.current) {
      const buf = termRef.current.buffer.active
      savedScrollRef.current = { viewportY: buf.viewportY, baseY: buf.baseY }
    }
  }, [active])

  // Re-fit and restore scroll when tab becomes active
  useEffect(() => {
    if (active && fitAddonRef.current && termRef.current) {
      setTimeout(() => {
        const term = termRef.current
        const fitAddon = fitAddonRef.current
        if (!term || !fitAddon) return

        // Re-fit if dimensions changed
        try {
          const dims = fitAddon.proposeDimensions()
          if (dims && (dims.cols !== term.cols || dims.rows !== term.rows)) {
            fitAddon.fit()
          }
        } catch {
          // FitAddon can throw when render service dimensions aren't available yet
        }

        // Restore scroll position saved before deactivation.
        // display:none resets xterm viewport to 0, so we must restore it.
        const saved = savedScrollRef.current
        if (saved) {
          const wasAtBottom = saved.viewportY >= saved.baseY
          if (wasAtBottom) {
            term.scrollToBottom()
          } else {
            // Restore exact scroll offset — user was scrolled up reading output
            term.scrollToLine(saved.viewportY)
          }
          savedScrollRef.current = null
        } else {
          // No saved state (first activation) — scroll to bottom
          term.scrollToBottom()
        }

        term.focus()
      }, 50)
    }
  }, [active])

  return (
    <div
      ref={containerRef}
      className="xterminal-container"
    />
  )
}
