import React, { useState, useEffect, useRef, useMemo } from 'react'
import { tokenizeLine, renderTokens } from './syntax-highlight'

interface Props {
  filePath: string
  scrollToLine?: number
  onClose: () => void
}

function getLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', scala: 'scala', sc: 'scala', sbt: 'scala',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', css: 'css', scss: 'scss', html: 'html',
    sh: 'bash', zsh: 'bash', sql: 'sql', graphql: 'graphql',
  }
  return map[ext] || 'text'
}

function getFileName(path: string): string {
  return path.split('/').pop() || path
}

export function FileViewer({ filePath, scrollToLine, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const targetLineRef = useRef<HTMLTableRowElement>(null)

  useEffect(() => {
    setContent(null)
    setError(null)
    window.api.readFile(filePath).then((result) => {
      if (result.error) {
        setError(result.error)
      } else {
        setContent(result.content || '')
      }
    })
  }, [filePath])

  useEffect(() => {
    if (content !== null && scrollToLine && targetLineRef.current) {
      targetLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [content, scrollToLine])

  const lines = content?.split('\n') || []
  const lang = getLanguage(filePath)

  const highlightedLines = useMemo(() => {
    if (!content) return []
    return lines.map(line => renderTokens(tokenizeLine(line, lang)))
  }, [content, lang])

  return (
    <div className="file-viewer">
      <div className="fv-header">
        <span className="fv-path" title={filePath}>{getFileName(filePath)}</span>
        <span className="fv-lang">{lang}</span>
        <span className="fv-lines">{lines.length > 0 ? `${lines.length} lines` : ''}</span>
        <button className="fv-close" onClick={onClose}>×</button>
      </div>
      <div className="fv-content">
        {error ? (
          <div className="fv-error">{error}</div>
        ) : content === null ? (
          <div className="fv-loading">Loading...</div>
        ) : (
          <pre className="fv-code">
            <table className="fv-table">
              <tbody>
                {highlightedLines.map((highlighted, i) => {
                  const isTarget = scrollToLine === i + 1
                  return (
                    <tr
                      key={i}
                      ref={isTarget ? targetLineRef : undefined}
                      className={isTarget ? 'fv-line-highlight' : undefined}
                    >
                      <td className="fv-line-num">{i + 1}</td>
                      <td className="fv-line-code">{highlighted}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </pre>
        )}
      </div>
    </div>
  )
}
