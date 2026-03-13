import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import type { Project } from '../../shared/types'

const mockProjects: Project[] = [
  {
    id: '1',
    name: 'Project A',
    path: '/a',
    tags: ['frontend'],
    description: '',
    techStack: [],
    runCommand: 'npm run dev',
    port: 3000,
    lastOpened: null,
    hidden: false,
  },
  {
    id: '2',
    name: 'Project B',
    path: '/b',
    tags: [],
    description: '',
    techStack: [],
    runCommand: '',
    port: null,
    lastOpened: null,
    hidden: false,
  },
]

describe('Sidebar', () => {
  it('renders filter categories', () => {
    render(
      <Sidebar
        projects={mockProjects}
        tags={['frontend']}
        activeFilter="all"
        runningCount={0}
        systemRunningCount={0}
        noCommandCount={1}
        onFilterChange={vi.fn()}
        onScan={vi.fn()}
      />
    )
    expect(screen.getByText('All Projects')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('No Command')).toBeInTheDocument()
  })

  it('shows running count', () => {
    render(
      <Sidebar
        projects={mockProjects}
        tags={[]}
        activeFilter="all"
        runningCount={3}
        systemRunningCount={0}
        noCommandCount={0}
        onFilterChange={vi.fn()}
        onScan={vi.fn()}
      />
    )
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows system running count', () => {
    render(
      <Sidebar
        projects={mockProjects}
        tags={[]}
        activeFilter="all"
        runningCount={0}
        systemRunningCount={2}
        noCommandCount={0}
        onFilterChange={vi.fn()}
        onScan={vi.fn()}
      />
    )
    expect(screen.getByText('Running (System)')).toBeInTheDocument()
    const counts = screen.getAllByText('2')
    expect(counts.length).toBeGreaterThanOrEqual(1)
  })

  it('click on filter calls onFilterChange', () => {
    const onFilterChange = vi.fn()
    render(
      <Sidebar
        projects={mockProjects}
        tags={[]}
        activeFilter="all"
        runningCount={0}
        systemRunningCount={0}
        noCommandCount={0}
        onFilterChange={onFilterChange}
        onScan={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Running'))
    expect(onFilterChange).toHaveBeenCalledWith('running')
  })

  it('renders tags list', () => {
    render(
      <Sidebar
        projects={mockProjects}
        tags={['frontend', 'backend']}
        activeFilter="all"
        runningCount={0}
        systemRunningCount={0}
        noCommandCount={0}
        onFilterChange={vi.fn()}
        onScan={vi.fn()}
      />
    )
    expect(screen.getByText('backend')).toBeInTheDocument()
    expect(screen.getByText('frontend')).toBeInTheDocument()
  })

  it('scan button calls onScan', () => {
    const onScan = vi.fn()
    render(
      <Sidebar
        projects={mockProjects}
        tags={[]}
        activeFilter="all"
        runningCount={0}
        systemRunningCount={0}
        noCommandCount={0}
        onFilterChange={vi.fn()}
        onScan={onScan}
      />
    )
    fireEvent.click(screen.getByText('Rescan Workspace'))
    expect(onScan).toHaveBeenCalledTimes(1)
  })
})
