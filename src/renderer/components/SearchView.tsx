import React, { useState, useRef, useCallback } from 'react'

interface SearchMatch {
  line: number
  text: string
}

interface SearchResult {
  file: string
  relativePath: string
  matches: SearchMatch[]
}

interface Props {
  rootPath: string
  onFileSelect: (filePath: string, line?: number) => void
  onClose: () => void
}

export function SearchView({ rootPath, onFileSelect, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSearch = useCallback((q: string) => {
    if (q.length < 2) {
      setResults([])
      setSearched(false)
      return
    }
    setSearching(true)
    setSearched(true)
    window.api.searchFiles(rootPath, q).then((res) => {
      setResults(res.results)
      // Auto-expand first 5 results
      const autoExpand = new Set<string>()
      res.results.slice(0, 5).forEach(r => autoExpand.add(r.file))
      setExpanded(autoExpand)
      setSearching(false)
    })
  }, [rootPath])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 400)
  }, [doSearch])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      doSearch(query)
    }
  }, [query, doSearch])

  const toggleFile = useCallback((file: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }, [])

  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0)

  return (
    <div className="search-view">
      <div className="sv-header">
        <span className="sv-title">Search</span>
        <button className="sv-close" onClick={onClose}>×</button>
      </div>
      <div className="sv-input-row">
        <input
          ref={inputRef}
          className="sv-input"
          type="text"
          placeholder="Search in files..."
          value={query}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          autoFocus
        />
      </div>
      <div className="sv-results">
        {searching ? (
          <div className="sv-status">Searching...</div>
        ) : searched && results.length === 0 ? (
          <div className="sv-status">No results found</div>
        ) : results.length > 0 ? (
          <>
            <div className="sv-summary">
              {results.length} file{results.length !== 1 ? 's' : ''}, {totalMatches} match{totalMatches !== 1 ? 'es' : ''}
            </div>
            {results.map((result) => (
              <div key={result.file} className="sv-file-group">
                <div
                  className="sv-file-header"
                  onClick={() => toggleFile(result.file)}
                >
                  <span className="sv-expand">{expanded.has(result.file) ? '▾' : '▸'}</span>
                  <span className="sv-file-path">{result.relativePath}</span>
                  <span className="sv-match-count">{result.matches.length}</span>
                </div>
                {expanded.has(result.file) && result.matches.map((match, i) => (
                  <div
                    key={i}
                    className="sv-match-row"
                    onClick={() => onFileSelect(result.file, match.line)}
                  >
                    <span className="sv-line-num">{match.line}</span>
                    <span className="sv-line-text">
                      {highlightMatch(match.text, query)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </>
        ) : null}
      </div>
    </div>
  )
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0
  const lowerQuery = query.toLowerCase()

  while (remaining.length > 0) {
    const idx = remaining.toLowerCase().indexOf(lowerQuery)
    if (idx === -1) {
      parts.push(remaining)
      break
    }
    if (idx > 0) parts.push(remaining.substring(0, idx))
    parts.push(
      <span key={key++} className="sv-highlight">
        {remaining.substring(idx, idx + query.length)}
      </span>
    )
    remaining = remaining.substring(idx + query.length)
  }
  return parts
}
