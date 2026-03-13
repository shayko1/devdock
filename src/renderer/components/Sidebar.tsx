import React from 'react'
import { Project } from '../../shared/types'

interface Props {
  projects: Project[]
  tags: string[]
  activeFilter: string
  runningCount: number
  systemRunningCount: number
  noCommandCount: number
  onFilterChange: (filter: string) => void
  onScan: () => void
}

export function Sidebar({ projects, tags, activeFilter, runningCount, systemRunningCount, noCommandCount, onFilterChange, onScan }: Props) {
  const visibleProjects = projects.filter((p) => !p.hidden)
  const hiddenCount = projects.filter((p) => p.hidden).length

  const tagCounts = tags.reduce<Record<string, number>>((acc, tag) => {
    acc[tag] = visibleProjects.filter((p) => p.tags.includes(tag)).length
    return acc
  }, {})

  const untaggedCount = visibleProjects.filter((p) => p.tags.length === 0).length

  return (
    <div className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-section-title">Filter</div>

        <div
          className={`sidebar-item ${activeFilter === 'all' ? 'active' : ''}`}
          onClick={() => onFilterChange('all')}
        >
          <span>All Projects</span>
          <span className="sidebar-count">{visibleProjects.length}</span>
        </div>

        <div
          className={`sidebar-item ${activeFilter === 'running' ? 'active' : ''}`}
          onClick={() => onFilterChange('running')}
        >
          <span>Running</span>
          <span className="running-count">{runningCount}</span>
        </div>

        {systemRunningCount > 0 && (
          <div
            className={`sidebar-item ${activeFilter === 'system-running' ? 'active' : ''}`}
            onClick={() => onFilterChange('system-running')}
          >
            <span>Running (System)</span>
            <span style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 600 }}>{systemRunningCount}</span>
          </div>
        )}

        {noCommandCount > 0 && (
          <div
            className={`sidebar-item ${activeFilter === 'no-command' ? 'active' : ''}`}
            onClick={() => onFilterChange('no-command')}
          >
            <span>No Command</span>
            <span className="sidebar-count">{noCommandCount}</span>
          </div>
        )}
      </div>

      <div className="sidebar-divider" />

      <div className="sidebar-section">
        <div className="sidebar-section-title">Tags</div>

        {tags.sort().map((tag) => (
          <div
            key={tag}
            className={`sidebar-item ${activeFilter === `tag:${tag}` ? 'active' : ''}`}
            onClick={() => onFilterChange(`tag:${tag}`)}
          >
            <span>{tag}</span>
            <span className="sidebar-count">{tagCounts[tag] || 0}</span>
          </div>
        ))}

        {untaggedCount > 0 && (
          <div
            className={`sidebar-item ${activeFilter === 'untagged' ? 'active' : ''}`}
            onClick={() => onFilterChange('untagged')}
          >
            <span>Untagged</span>
            <span className="sidebar-count">{untaggedCount}</span>
          </div>
        )}
      </div>

      <div className="sidebar-divider" />

      <div className="sidebar-section">
        <div
          className={`sidebar-item ${activeFilter === 'hidden' ? 'active' : ''}`}
          onClick={() => onFilterChange('hidden')}
        >
          <span>Hidden</span>
          <span className="sidebar-count">{hiddenCount}</span>
        </div>
      </div>

      <div className="scan-section">
        <button className="btn btn-accent" style={{ width: '100%' }} onClick={onScan}>
          Rescan Workspace
        </button>
      </div>
    </div>
  )
}
