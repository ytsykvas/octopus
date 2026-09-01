import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Project } from '@core/store.js'

import { ProjectTabs } from './ProjectTabs.js'

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

type ProjectTabsProps = React.ComponentProps<typeof ProjectTabs>

function renderTabs(overrides: Partial<ProjectTabsProps> = {}): ProjectTabsProps {
  const props: ProjectTabsProps = {
    projects: [project()],
    activeProjectId: 'planner',
    onSelect: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    onAddFromDisk: vi.fn(),
    onAddFromGitHub: vi.fn(),
    busy: false,
    sidebarOpen: true,
    onToggleSidebar: vi.fn(),
    ...overrides
  }

  render(<ProjectTabs {...props} />)
  return props
}

describe('ProjectTabs', () => {
  // A multi-word name gives the first letter of its first two words.
  it('labels a tab with two letters taken from the project name', () => {
    renderTabs({ projects: [project({ id: 'rails', name: 'tsykvas-rails-template' })] })

    expect(screen.getByRole('button', { name: 'TR' })).toBeInTheDocument()
  })

  it('takes both letters from a single-word name', () => {
    renderTabs({ projects: [project({ id: 'truthnode', name: 'truthnode' })] })

    expect(screen.getByRole('button', { name: 'TR' })).toBeInTheDocument()
  })

  // Two letters collide readily; an icon is the way out of that, and 36px hold
  // one or the other rather than both.
  it('shows the chosen icon in place of the initials', () => {
    renderTabs({ projects: [project({ name: 'planner', icon: 'rocket' })] })

    const tab = screen.getByTitle('planner — origin/main')
    expect(tab).not.toHaveTextContent('PL')
    expect(tab.querySelector('svg')).toBeInTheDocument()
  })

  it('falls back to the initials for a project with no icon', () => {
    renderTabs({ projects: [project({ name: 'planner', icon: null })] })

    expect(screen.getByRole('button', { name: 'PL' })).toBeInTheDocument()
  })

  // Two letters collide readily, so the full name and its base branch have to
  // be a hover away.
  it('spells out the project and its base branch on hover', () => {
    renderTabs({ projects: [project({ name: 'planner', baseBranch: 'origin/main' })] })

    expect(screen.getByTitle('planner — origin/main')).toBeInTheDocument()
  })

  it('marks the active project as the current tab', () => {
    renderTabs({
      projects: [
        project({ id: 'planner', name: 'planner' }),
        project({ id: 'ledger', name: 'ledger' })
      ],
      activeProjectId: 'ledger'
    })

    expect(screen.getByRole('button', { current: true })).toHaveTextContent('LE')
  })

  it('marks nothing as current when no project is selected', () => {
    renderTabs({ activeProjectId: null })

    expect(screen.getByRole('button', { name: 'PL' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { current: true })).not.toBeInTheDocument()
  })

  it('selects the project whose tab was clicked', async () => {
    const user = userEvent.setup()
    const props = renderTabs({
      projects: [
        project({ id: 'planner', name: 'planner' }),
        project({ id: 'ledger', name: 'ledger' })
      ],
      activeProjectId: 'planner'
    })

    await user.click(screen.getByRole('button', { name: 'LE' }))

    expect(props.onSelect).toHaveBeenCalledWith('ledger')
  })

  it('offers both ways of adding a repository', async () => {
    const user = userEvent.setup()
    renderTabs()

    await user.click(screen.getByTitle('Add repository'))

    expect(screen.getByRole('menuitem', { name: /From disk/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /From GitHub/ })).toBeInTheDocument()
  })

  it('adds from disk when that source is chosen', async () => {
    const user = userEvent.setup()
    const props = renderTabs()

    await user.click(screen.getByTitle('Add repository'))
    await user.click(screen.getByRole('menuitem', { name: /From disk/ }))

    expect(props.onAddFromDisk).toHaveBeenCalledTimes(1)
    expect(props.onAddFromGitHub).not.toHaveBeenCalled()
  })

  it('clones from GitHub when that source is chosen', async () => {
    const user = userEvent.setup()
    const props = renderTabs()

    await user.click(screen.getByTitle('Add repository'))
    await user.click(screen.getByRole('menuitem', { name: /From GitHub/ }))

    expect(props.onAddFromGitHub).toHaveBeenCalledTimes(1)
  })

  // Adding is a long operation; a second click while one runs would start two.
  it('refuses to add another repository while one is being added', () => {
    renderTabs({ busy: true })

    expect(screen.getByTitle('Add repository')).toBeDisabled()
  })

  it('offers editing and removal on a right-click', () => {
    renderTabs({ projects: [project({ name: 'planner' })] })

    fireEvent.contextMenu(screen.getByRole('button', { name: 'PL' }))

    expect(screen.getByRole('menuitem', { name: 'Edit…' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Remove project' })).toBeInTheDocument()
  })

  // A right-click must open the menu instead of the platform's own, and must
  // not double as a click that switches project.
  it('replaces the platform menu without selecting the project', () => {
    const props = renderTabs()

    // `false` means a handler cancelled the event, which is what stops the
    // browser's own context menu from appearing over ours.
    const reachedThePlatform = fireEvent.contextMenu(screen.getByRole('button', { name: 'PL' }))

    expect(reachedThePlatform).toBe(false)
    expect(screen.getByRole('menuitem', { name: 'Edit…' })).toBeInTheDocument()
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('edits the project the menu was opened on', async () => {
    const user = userEvent.setup()
    const props = renderTabs({
      projects: [
        project({ id: 'planner', name: 'planner' }),
        project({ id: 'ledger', name: 'ledger' })
      ]
    })

    fireEvent.contextMenu(screen.getByRole('button', { name: 'LE' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit…' }))

    expect(props.onEdit).toHaveBeenCalledWith('ledger')
  })

  it('removes the project the menu was opened on', async () => {
    const user = userEvent.setup()
    const props = renderTabs({
      projects: [
        project({ id: 'planner', name: 'planner' }),
        project({ id: 'ledger', name: 'ledger' })
      ]
    })

    fireEvent.contextMenu(screen.getByRole('button', { name: 'LE' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove project' }))

    expect(props.onRemove).toHaveBeenCalledWith('ledger')
  })

  // The strip is what survives the fold, so the way back has to live here
  // rather than in the column it hides.
  it('folds the workspace list away', async () => {
    const user = userEvent.setup()
    const props = renderTabs({ sidebarOpen: true })

    await user.click(screen.getByRole('button', { name: 'Hide workspaces' }))

    expect(props.onToggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('offers to bring the workspace list back once it is folded away', async () => {
    const user = userEvent.setup()
    const props = renderTabs({ sidebarOpen: false })

    expect(screen.queryByRole('button', { name: 'Hide workspaces' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show workspaces' }))

    expect(props.onToggleSidebar).toHaveBeenCalledTimes(1)
  })

  // The list of projects scrolls once there are more than fit; a control inside
  // that box would scroll out of reach along with them.
  it('keeps the fold out of the scrolling list of projects', () => {
    renderTabs()

    const fold = screen.getByRole('button', { name: 'Hide workspaces' })
    const strip = fold.closest('nav')

    expect(fold.parentElement).toBe(strip)
    expect(screen.getByRole('button', { name: 'PL' }).parentElement).not.toBe(strip)
  })

  it('still offers to add a repository when there are no projects', () => {
    renderTabs({ projects: [], activeProjectId: null })

    expect(screen.getByTitle('Add repository')).toBeEnabled()
  })
})
