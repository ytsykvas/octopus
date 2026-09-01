import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Project } from '@core/store.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { Sidebar } from './Sidebar.js'

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'planner',
    name: 'planner',
    repoPath: '/Users/someone/code/planner',
    baseBranch: 'origin/main',
    branchPrefix: 'ytsykvas',
    envFile: '.env',
    approvedSettings: [],
    approvedScripts: [],
    envProfile: 'default',
    trustRepoScripts: false,
    color: 'blue',
    ...overrides
  }
}

function workspace(overrides: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    id: 'planner/anna',
    projectId: 'planner',
    name: 'anna',
    branch: 'ytsykvas/anna',
    path: '/tmp/planner/anna',
    status: 'idle',
    port: 3100,
    createdAt: '2026-08-08T00:00:00.000Z',
    ownerId: null,
    envProfile: null,
    chats: [],
    changedFiles: 0,
    ahead: 0,
    missing: false,
    ...overrides
  }
}

type SidebarProps = React.ComponentProps<typeof Sidebar>

function renderSidebar(overrides: Partial<SidebarProps> = {}): SidebarProps {
  const props: SidebarProps = {
    project: project(),
    workspaces: [],
    requests: new Map(),
    selectedWorkspaceId: null,
    onSelectWorkspace: vi.fn(),
    onCreateWorkspace: vi.fn(),
    creating: false,
    width: 240,
    onWidthChange: vi.fn(),
    onRenameWorkspace: vi.fn(),
    onRemoveWorkspace: vi.fn(),
    editingWorkspaceId: null,
    onEditingWorkspaceChange: vi.fn(),
    ...overrides
  }

  render(<Sidebar {...props} />)
  return props
}

describe('Sidebar', () => {
  it('names the project the list belongs to', () => {
    renderSidebar({ project: project({ name: 'planner' }) })

    expect(screen.getByText('planner')).toBeInTheDocument()
  })

  // Every branch in the list carries the same origin/, so it says nothing while
  // pushing the part that differs out of a narrow pane.
  it('shows the base branch without the origin/ prefix', () => {
    renderSidebar({ project: project({ baseBranch: 'origin/main' }) })

    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.queryByText('origin/main')).not.toBeInTheDocument()
  })

  // The prefix is hidden, not lost: hovering is how you get the full ref back.
  it('keeps the full ref available on hover', () => {
    renderSidebar({ project: project({ baseBranch: 'origin/main' }) })

    expect(screen.getByTitle('origin/main')).toBeInTheDocument()
  })

  // Only origin/ goes: a repository with no remote falls back to local
  // branches, and feature/x must not be shown as x.
  it('leaves a local branch name alone', () => {
    renderSidebar({ project: project({ baseBranch: 'feature/checkout' }) })

    expect(screen.getByText('feature/checkout')).toBeInTheDocument()
  })

  it('offers the repository path on hover over the name', () => {
    renderSidebar({ project: project({ repoPath: '/Users/someone/code/planner' }) })

    expect(screen.getByTitle('/Users/someone/code/planner')).toBeInTheDocument()
  })

  it('invites the first workspace when the project has none', () => {
    renderSidebar({ workspaces: [] })

    expect(screen.getByText('No workspaces yet. Add one with the + above.')).toBeInTheDocument()
  })

  it('drops the invitation once a workspace exists', () => {
    renderSidebar({ workspaces: [workspace()] })

    expect(
      screen.queryByText('No workspaces yet. Add one with the + above.')
    ).not.toBeInTheDocument()
    expect(screen.getByText('anna')).toBeInTheDocument()
  })

  it('asks for a repository when no project is selected', () => {
    renderSidebar({ project: null })

    expect(
      screen.getByText('Nothing here yet. Add a repository with the "+" button.')
    ).toBeInTheDocument()
  })

  it('creates a workspace from the + button', async () => {
    const user = userEvent.setup()
    const props = renderSidebar()

    await user.click(screen.getByTitle('New workspace'))

    expect(props.onCreateWorkspace).toHaveBeenCalledTimes(1)
  })

  /*
   * Creation fetches before it branches, so the button is now live through a
   * wait rather than over before a second press was possible. Refusing the
   * press is the point; the turning mark is what stops the refusal reading as
   * the app having hung.
   */
  it('refuses a second press while a workspace is being made', async () => {
    const user = userEvent.setup()
    const props = renderSidebar({ creating: true })

    await user.click(screen.getByTitle('New workspace'))

    expect(props.onCreateWorkspace).not.toHaveBeenCalled()
    expect(screen.getByTitle('New workspace')).toBeDisabled()
  })

  it('lists every workspace of the project', () => {
    renderSidebar({
      workspaces: [
        workspace({ id: 'planner/anna', name: 'anna' }),
        workspace({ id: 'planner/bob', name: 'bob' })
      ]
    })

    expect(screen.getByText('anna')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
  })

  it('selects the workspace that was clicked', async () => {
    const user = userEvent.setup()
    const props = renderSidebar({
      workspaces: [
        workspace({ id: 'planner/anna', name: 'anna' }),
        workspace({ id: 'planner/bob', name: 'bob' })
      ]
    })

    await user.click(screen.getByText('bob'))

    expect(props.onSelectWorkspace).toHaveBeenCalledWith('planner/bob')
  })

  it('renames the workspace whose row was being edited', async () => {
    const user = userEvent.setup()
    const props = renderSidebar({
      workspaces: [
        workspace({ id: 'planner/anna', name: 'anna' }),
        workspace({ id: 'planner/bob', name: 'bob' })
      ],
      editingWorkspaceId: 'planner/bob'
    })

    const field = screen.getByTitle('Enter to save, Escape to cancel')
    await user.clear(field)
    await user.type(field, 'robert{Enter}')

    expect(props.onRenameWorkspace).toHaveBeenCalledWith('planner/bob', 'robert')
  })

  it('starts renaming the workspace whose menu was used', async () => {
    const user = userEvent.setup()
    const props = renderSidebar({
      workspaces: [
        workspace({ id: 'planner/anna', name: 'anna' }),
        workspace({ id: 'planner/bob', name: 'bob' })
      ]
    })

    const [, secondRowMenu] = screen.getAllByTitle('More')
    if (secondRowMenu === undefined) throw new Error('expected a menu on every row')
    await user.click(secondRowMenu)
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))

    expect(props.onEditingWorkspaceChange).toHaveBeenCalledExactlyOnceWith('planner/bob')
  })

  // The pane follows the cursor throughout, but the width worth keeping is
  // reported once — on release. Persisting each intermediate pixel would be a
  // disk write per mouse move.
  it('reports the width when the drag ends, not while it lasts', () => {
    const props = renderSidebar({ width: 240 })
    const edge = screen.getByRole('separator')

    fireEvent.pointerDown(edge, { clientX: 300 })
    fireEvent.pointerMove(window, { clientX: 340 })

    // This pane sits on the left, so dragging its edge rightwards widens it.
    expect(edge).toHaveAttribute('aria-valuenow', '280')
    expect(props.onWidthChange).not.toHaveBeenCalled()

    fireEvent.pointerUp(window)

    expect(props.onWidthChange).toHaveBeenCalledExactlyOnceWith(280)
  })

  it('removes the workspace whose menu was used', async () => {
    const user = userEvent.setup()
    const props = renderSidebar({
      workspaces: [
        workspace({ id: 'planner/anna', name: 'anna' }),
        workspace({ id: 'planner/bob', name: 'bob' })
      ]
    })

    const [, secondRowMenu] = screen.getAllByTitle('More')
    if (secondRowMenu === undefined) throw new Error('expected a menu on every row')
    await user.click(secondRowMenu)
    await user.click(screen.getByRole('menuitem', { name: 'Remove workspace' }))

    expect(props.onRemoveWorkspace).toHaveBeenCalledWith('planner/bob')
  })
})
