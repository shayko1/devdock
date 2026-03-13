import React, { useEffect, useRef, useState } from 'react'

interface Props {
  projectName: string | null
  logs: string[]
}

export function LogPanel({ projectName, logs }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  return (
    <div className={`log-panel ${collapsed ? 'collapsed' : ''}`}>
      <div className="log-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="log-header-title">
          {projectName ? `Logs: ${projectName}` : 'Logs'}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {collapsed ? 'Show' : 'Hide'}
        </span>
      </div>
      {!collapsed && (
        <div className="log-content" ref={scrollRef}>
          {logs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
              {projectName ? 'Waiting for output...' : 'Select a running project to view logs'}
            </div>
          ) : (
            logs.map((line, i) => (
              <div key={i} className="log-line">{line}</div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
