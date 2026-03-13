import React from 'react'
import { ProcessStatus, Project, SystemPortInfo } from '../../shared/types'

interface Props {
  project: Project
  status: ProcessStatus | undefined
  systemPortInfo: SystemPortInfo | undefined
  selected: boolean
  onStart: () => void
  onStop: () => void
  onEdit: () => void
  onRemove: () => void
  onSelect: () => void
  onOpenBrowser: () => void
  onKillSystemProcess: (pid: number) => void
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function ProjectCard({
  project, status, systemPortInfo, selected,
  onStart, onStop, onEdit, onRemove, onSelect, onOpenBrowser, onKillSystemProcess
}: Props) {
  const isRunning = status?.running ?? false
  const isSystemRunning = !isRunning && !!systemPortInfo

  return (
    <div
      className={`project-card ${isRunning ? 'running' : ''} ${isSystemRunning ? 'system-running' : ''} ${selected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <div className="project-card-header">
        <span className="project-card-name" title={project.name}>
          {project.name}
        </span>
        <span className="project-card-header-actions">
          <button
            className="card-remove-btn"
            title="Remove project"
            onClick={(e) => { e.stopPropagation(); onRemove() }}
          >×</button>
          <span className={`status-dot ${isRunning ? 'running' : isSystemRunning ? 'system' : 'stopped'}`}
            title={isSystemRunning ? `Already running (PID ${systemPortInfo.pid}, ${systemPortInfo.command})` : undefined}
          />
        </span>
      </div>

      {project.description && (
        <div className="project-card-desc">{project.description}</div>
      )}

      <div className="project-card-meta">
        {project.techStack.map((tech) => (
          <span key={tech} className="tech-badge">{tech}</span>
        ))}
        {project.tags.map((tag) => (
          <span key={tag} className="tag-badge">{tag}</span>
        ))}
      </div>

      <div className="project-card-footer">
        <span className={`port-label ${isRunning ? 'active' : isSystemRunning ? 'system' : ''}`}>
          {isRunning ? `:${status?.port}` : project.port ? `:${project.port}` : 'No port'}
        </span>
        <span className="last-opened">{timeAgo(project.lastOpened)}</span>
      </div>

      {isSystemRunning && (
        <div className="system-running-info">
          Running externally ({systemPortInfo.command}, PID {systemPortInfo.pid})
        </div>
      )}

      <div className="project-actions" onClick={(e) => e.stopPropagation()}>
        {isRunning ? (
          <>
            <button className="btn btn-danger btn-sm" onClick={onStop}>Stop</button>
            <button className="btn btn-accent btn-sm" onClick={onOpenBrowser}>Open</button>
          </>
        ) : isSystemRunning ? (
          <>
            <button className="btn btn-danger btn-sm" onClick={() => onKillSystemProcess(systemPortInfo.pid)}>
              Kill :{systemPortInfo.port}
            </button>
            <button className="btn btn-accent btn-sm" onClick={onOpenBrowser}>Open</button>
          </>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={onStart}>
            {project.runCommand ? 'Run' : 'No command'}
          </button>
        )}
        <button className="btn btn-sm" onClick={onEdit}>Edit</button>
      </div>
    </div>
  )
}
