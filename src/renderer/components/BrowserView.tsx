import React, { useState, useEffect, useCallback } from 'react'

interface Props {
  sessionId: string
  onClose: () => void
}

export function BrowserView({ sessionId, onClose }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [lastNav, setLastNav] = useState<{ url: string; title: string } | null>(null)
  const [urlInput, setUrlInput] = useState('')

  // Check if browser is already open
  useEffect(() => {
    window.api.isBrowserOpen(sessionId).then(setIsOpen)
  }, [sessionId])

  // Listen for browser events (screenshots, navigation, close)
  useEffect(() => {
    const unsub = window.api.onBrowserEvent(({ sessionId: sid, event, data }) => {
      if (sid !== sessionId) return
      if (event === 'screenshot') {
        setScreenshotUrl(data.dataUrl)
      } else if (event === 'navigated') {
        setLastNav({ url: data.url, title: data.title })
      } else if (event === 'browser-closed') {
        setIsOpen(false)
        setScreenshotUrl(null)
      }
    })
    return unsub
  }, [sessionId])

  const handleOpen = useCallback(() => {
    window.api.openBrowser(sessionId, urlInput || 'https://www.google.com')
    setIsOpen(true)
  }, [sessionId, urlInput])

  const handleNavigate = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (urlInput.trim()) {
      window.api.openBrowser(sessionId, urlInput.trim())
      setIsOpen(true)
    }
  }, [sessionId, urlInput])

  const handleCloseBrowser = useCallback(() => {
    window.api.closeBrowser(sessionId)
    setIsOpen(false)
    setScreenshotUrl(null)
  }, [sessionId])

  return (
    <div className="browser-view">
      <div className="bv-header">
        <span className="bv-title">Browser</span>
        <span className={`bv-status ${isOpen ? 'bv-status-open' : ''}`}>
          {isOpen ? 'Open' : 'Closed'}
        </span>
        <button className="bv-close-btn" onClick={onClose}>×</button>
      </div>

      <form className="bv-url-bar" onSubmit={handleNavigate}>
        <input
          className="bv-url-input"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="Enter URL or search..."
        />
        <button className="btn btn-sm" type="submit">Go</button>
      </form>

      <div className="bv-actions">
        {!isOpen ? (
          <button className="btn btn-primary btn-sm" onClick={handleOpen}>
            Open Browser Window
          </button>
        ) : (
          <button className="btn btn-sm btn-danger" onClick={handleCloseBrowser}>
            Close Browser
          </button>
        )}
      </div>

      {lastNav && (
        <div className="bv-nav-info">
          <div className="bv-nav-title" title={lastNav.title}>{lastNav.title}</div>
          <div className="bv-nav-url" title={lastNav.url}>{lastNav.url}</div>
        </div>
      )}

      {screenshotUrl && (
        <div className="bv-screenshot">
          <div className="bv-screenshot-label">Last Screenshot</div>
          <img src={screenshotUrl} className="bv-screenshot-img" alt="Browser screenshot" />
        </div>
      )}

      <div className="bv-help">
        <div className="bv-help-title">Claude can control this browser from the terminal:</div>
        <pre className="bv-help-code">{`browser open
browser navigate https://localhost:3000
browser screenshot
browser click '#submit-btn'
browser type '#email' hello@test.com
browser text
browser eval 'document.title'`}</pre>
      </div>
    </div>
  )
}
