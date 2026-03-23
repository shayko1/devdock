import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FoldersView } from './FoldersView'
import type { WorkspaceFolder } from '../../shared/types'

const testFolders: WorkspaceFolder[] = [
  {
    name: 'zebra',
    path: '/w/zebra',
    modifiedAt: '2020-01-01T00:00:00.000Z',
    gitBranch: null,
    gitRemote: null,
  },
  {
    name: 'alpha',
    path: '/w/alpha',
    modifiedAt: '2024-06-01T00:00:00.000Z',
    gitBranch: null,
    gitRemote: null,
  },
  {
    name: 'mike',
    path: '/w/mike',
    modifiedAt: '2022-01-01T00:00:00.000Z',
    gitBranch: null,
    gitRemote: null,
  },
]

function folderNamesInOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.folders-list .folder-name')).map(
    (el) => el.textContent ?? ''
  )
}

describe('FoldersView', () => {
  beforeEach(() => {
    globalThis.IntersectionObserver = class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
      takeRecords = vi.fn(() => [])
    } as unknown as typeof IntersectionObserver
    vi.mocked(window.api.listWorkspaceFolders).mockResolvedValue(testFolders)
    vi.mocked(window.api.getGitInfo).mockResolvedValue({ gitBranch: null, gitRemote: null })
  })

  it('sorts by name A–Z by default', async () => {
    const { container } = render(<FoldersView scanPath="/workspace" />)
    await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())
    expect(folderNamesInOrder(container)).toEqual(['alpha', 'mike', 'zebra'])
  })

  it('toggles name sort to Z–A when Name is clicked while already sorting by name', async () => {
    const { container } = render(<FoldersView scanPath="/workspace" />)
    await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())
    const nameBtn = screen.getByRole('button', { name: /Name/ })
    fireEvent.click(nameBtn)
    expect(folderNamesInOrder(container)).toEqual(['zebra', 'mike', 'alpha'])
  })

  it('sorts by last changed newest first when Last changed is selected', async () => {
    const { container } = render(<FoldersView scanPath="/workspace" />)
    await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Last changed/ }))
    expect(folderNamesInOrder(container)).toEqual(['alpha', 'mike', 'zebra'])
  })

  it('toggles last changed to oldest first when Last changed is clicked again', async () => {
    const { container } = render(<FoldersView scanPath="/workspace" />)
    await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())
    const recentBtn = screen.getByRole('button', { name: /Last changed/ })
    fireEvent.click(recentBtn)
    fireEvent.click(recentBtn)
    expect(folderNamesInOrder(container)).toEqual(['zebra', 'mike', 'alpha'])
  })

  it('selecting Name after Last changed resets to A–Z', async () => {
    const { container } = render(<FoldersView scanPath="/workspace" />)
    await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Last changed/ }))
    fireEvent.click(screen.getByRole('button', { name: /Last changed/ }))
    expect(folderNamesInOrder(container)).toEqual(['zebra', 'mike', 'alpha'])
    fireEvent.click(screen.getByRole('button', { name: /Name/ }))
    expect(folderNamesInOrder(container)).toEqual(['alpha', 'mike', 'zebra'])
  })

  it('opens bulk git pull modal from toolbar', async () => {
    render(<FoldersView scanPath="/workspace" />)
    await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Bulk git pull/ }))
    expect(screen.getByRole('heading', { name: 'Bulk git pull' })).toBeInTheDocument()
  })
})
