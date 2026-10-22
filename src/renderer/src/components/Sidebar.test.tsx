import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Project } from '@core/store.js'

import { workspaceView } from '../test/workspaces.js'
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
    trustRepository: false,
    preferLocal: [],
    disabledSkillDefaults: [],
    color: 'blue',
    ...overrides
  }
}

type SidebarProps = React.ComponentProps<typeof Sidebar>

function renderSidebar(overrides: Partial<SidebarProps> = {}): SidebarProps {
  const props: SidebarProps = {
    project: project(),
    hasProjects: true,
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

  // The header's "+" alone was easy to miss on an empty list, so the first
  // row's place holds a button of its own, naming where the branch comes from.
  it('offers the first workspace in the place of the first row', () => {
    renderSidebar({ workspaces: [], project: project({ baseBranch: 'origin/main' }) })

    expect(screen.getByRole('button', { name: /Create the first workspace/ })).toHaveTextContent(
      'Its own branch from main'
    )
  })

  it('creates the first workspace from that button', async () => {
    const user = userEvent.setup()
    const props = renderSidebar({ workspaces: [] })

    await user.click(screen.getByRole('button', { name: /Create the first workspace/ }))

    expect(props.onCreateWorkspace).toHaveBeenCalledTimes(1)
  })

  // The same refusal as the header's: one press is one workspace.
  it('refuses a second first workspace while one is being made', async () => {
    const user = userEvent.setup()
    const props = renderSidebar({ workspaces: [], creating: true })
    const button = screen.getByRole('button', { name: /Create the first workspace/ })

    await user.click(button)

    expect(props.onCreateWorkspace).not.toHaveBeenCalled()
    expect(button).toBeDisabled()
  })

  it('drops the first-workspace button once a workspace exists', () => {
    renderSidebar({ workspaces: [workspaceView('anna')] })

    expect(screen.queryByRole('button', { name: /Create the first workspace/ })).toBeNull()
    expect(screen.getByText('anna')).toBeInTheDocument()
  })

  it('asks for a repository when there is none', () => {
    renderSidebar({ project: null, hasProjects: false })

    expect(
      screen.getByText('Nothing here yet. Add a repository with the "+" button.')
    ).toBeInTheDocument()
  })

  /*
   * Projects exist and none is chosen — on start, or after the open project's
   * tile is pressed again. Asking for a repository then contradicted the strip
   * beside it, which holds one.
   */
  it('points at the strip when projects exist but none is chosen', () => {
    renderSidebar({ project: null, hasProjects: true })

    expect(screen.getByText('Pick a project on the far left.')).toBeInTheDocument()
    expect(
      screen.queryByText('Nothing here yet. Add a repository with the "+" button.')
    ).not.toBeInTheDocument()
  })

  // The limits moved to the footer, which spans the tab strip as well. Left
  // here they would be drawn twice, once at the list's width.
  it('leaves the account limits to the footer', () => {
    renderSidebar()

    expect(screen.queryByRole('button', { name: 'Read the limits now' })).toBeNull()
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
      workspaces: [workspaceView('anna'), workspaceView('bob')]
    })

    expect(screen.getByText('anna')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
  })

  it('selects the workspace that was clicked', async () => {
    const user = userEvent.setup()
    const props = renderSidebar({
      workspaces: [workspaceView('anna'), workspaceView('bob')]
    })

    await user.click(screen.getByText('bob'))

    expect(props.onSelectWorkspace).toHaveBeenCalledWith('planner/bob')
  })

  it('renames the workspace whose row was being edited', async () => {
    const user = userEvent.setup()
    const props = renderSidebar({
      workspaces: [workspaceView('anna'), workspaceView('bob')],
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
      workspaces: [workspaceView('anna'), workspaceView('bob')]
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
      workspaces: [workspaceView('anna'), workspaceView('bob')]
    })

    const [, secondRowMenu] = screen.getAllByTitle('More')
    if (secondRowMenu === undefined) throw new Error('expected a menu on every row')
    await user.click(secondRowMenu)
    await user.click(screen.getByRole('menuitem', { name: 'Remove workspace' }))

    expect(props.onRemoveWorkspace).toHaveBeenCalledWith('planner/bob')
  })

  describe('the help button', () => {
    const inWorkspace = { workspaces: [workspaceView('anna')], selectedWorkspaceId: 'planner/anna' }

    it('wears the colour ring, drawn as one line inside it', () => {
      renderSidebar(inWorkspace)

      const button = screen.getByRole('button', { name: 'Help' })
      expect(button).toHaveClass('help-button')
      expect(button.querySelectorAll('.help-button-line')).toHaveLength(1)
    })

    // The column is resizable, so the button follows its width rather than
    // holding one of its own.
    it('spans the width of the list', () => {
      renderSidebar(inWorkspace)

      expect(screen.getByRole('button', { name: 'Help' })).toHaveClass('w-full')
    })

    it('is not offered while no workspace is selected', () => {
      renderSidebar({ workspaces: [workspaceView('anna')], selectedWorkspaceId: null })

      expect(screen.queryByRole('button', { name: 'Help' })).toBeNull()
    })

    it('is not offered when the selection belongs to another project', () => {
      renderSidebar({ workspaces: [workspaceView('anna')], selectedWorkspaceId: 'other/bob' })

      expect(screen.queryByRole('button', { name: 'Help' })).toBeNull()
    })

    it('is not offered before any project is picked', () => {
      renderSidebar({ ...inWorkspace, project: null })

      expect(screen.queryByRole('button', { name: 'Help' })).toBeNull()
    })

    // At the foot rather than the end of the list: forty workspaces must not
    // scroll it out of reach.
    it('sits outside the list that scrolls', () => {
      renderSidebar(inWorkspace)

      expect(screen.getByRole('button', { name: 'Help' }).closest('nav')).toBeNull()
    })

    it('does nothing yet when pressed', async () => {
      const user = userEvent.setup()
      const props = renderSidebar(inWorkspace)

      await user.click(screen.getByRole('button', { name: 'Help' }))

      expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument()
      for (const handler of [
        props.onSelectWorkspace,
        props.onCreateWorkspace,
        props.onWidthChange,
        props.onRenameWorkspace,
        props.onRemoveWorkspace,
        props.onEditingWorkspaceChange
      ]) {
        expect(handler).not.toHaveBeenCalled()
      }
    })
  })
})
