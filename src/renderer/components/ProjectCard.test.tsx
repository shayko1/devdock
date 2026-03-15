import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProjectCard } from './ProjectCard'
import type { Project, ProcessStatus, SystemPortInfo } from '../../shared/types'

const mockProject: Project = {
  id: 'test-1',
  name: 'Test Project',
  path: '/Users/test/projects/test-project',
  tags: ['frontend', 'react'],
  description: 'A test project',
  techStack: ['React', 'TypeScript'],
  runCommand: 'npm run dev',
  port: 3000,
  lastOpened: null,
  hidden: false,
}

const mockHandlers = {
  onStart: vi.fn(),
  onStop: vi.fn(),
  onEdit: vi.fn(),
  onRemove: vi.fn(),
  onSelect: vi.fn(),
  onOpenBrowser: vi.fn(),
  onKillSystemProcess: vi.fn(),
  onCheckoutBranch: vi.fn(),
  currentBranch: 'main' as string | null,
  branches: ['main', 'develop'],
}

describe('ProjectCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders project name', () => {
    render(
      <ProjectCard
        project={mockProject}
        status={undefined}
        systemPortInfo={undefined}
        selected={false}
        {...mockHandlers}
      />
    )
    expect(screen.getByText('Test Project')).toBeInTheDocument()
  })

  it('renders project tags', () => {
    render(
      <ProjectCard
        project={mockProject}
        status={undefined}
        systemPortInfo={undefined}
        selected={false}
        {...mockHandlers}
      />
    )
    expect(screen.getByText('frontend')).toBeInTheDocument()
    expect(screen.getByText('react')).toBeInTheDocument()
  })

  it('renders tech stack badges', () => {
    render(
      <ProjectCard
        project={mockProject}
        status={undefined}
        systemPortInfo={undefined}
        selected={false}
        {...mockHandlers}
      />
    )
    expect(screen.getByText('React')).toBeInTheDocument()
    expect(screen.getByText('TypeScript')).toBeInTheDocument()
  })

  it('shows run button when project has runCommand', () => {
    render(
      <ProjectCard
        project={mockProject}
        status={undefined}
        systemPortInfo={undefined}
        selected={false}
        {...mockHandlers}
      />
    )
    expect(screen.getByText('Run')).toBeInTheDocument()
  })

  it('shows No command when project has no runCommand', () => {
    const projectNoCommand = { ...mockProject, runCommand: '' }
    render(
      <ProjectCard
        project={projectNoCommand}
        status={undefined}
        systemPortInfo={undefined}
        selected={false}
        {...mockHandlers}
      />
    )
    expect(screen.getByText('No command')).toBeInTheDocument()
  })

  it('start button calls onStart', () => {
    render(
      <ProjectCard
        project={mockProject}
        status={undefined}
        systemPortInfo={undefined}
        selected={false}
        {...mockHandlers}
      />
    )
    fireEvent.click(screen.getByText('Run'))
    expect(mockHandlers.onStart).toHaveBeenCalledTimes(1)
  })

  it('stop button appears when status is running', () => {
    const status: ProcessStatus = {
      projectId: 'test-1',
      running: true,
      pid: 1234,
      port: 3000,
      logs: [],
    }
    render(
      <ProjectCard
        project={mockProject}
        status={status}
        systemPortInfo={undefined}
        selected={false}
        {...mockHandlers}
      />
    )
    expect(screen.getByText('Stop')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Stop'))
    expect(mockHandlers.onStop).toHaveBeenCalledTimes(1)
  })

  it('edit button calls onEdit', () => {
    render(
      <ProjectCard
        project={mockProject}
        status={undefined}
        systemPortInfo={undefined}
        selected={false}
        {...mockHandlers}
      />
    )
    const editButton = screen.getByText('Edit')
    fireEvent.click(editButton)
    expect(mockHandlers.onEdit).toHaveBeenCalledTimes(1)
  })
})
