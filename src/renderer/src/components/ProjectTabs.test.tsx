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
    trustRepository: false,
    preferLocal: [],
    disabledSkillDefaults: [],
    color: 'blue',
    ...overrides
  }
}

type ProjectTabsProps = React.ComponentProps<typeof ProjectTabs>

function renderTabs(overrides: Partial<ProjectTabsProps> = {}): ProjectTabsProps {
  const props: ProjectTabsProps = {
    projects: [project()],
    activeProjectId: 'planner',
    marks: new Map(),
    onSelect: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    onReorder: vi.fn(),
    onAddFromDisk: vi.fn(),
    onAddFromGitHub: vi.fn(),
    busy: false,
    pluginsOpen: false,
    pluginTrouble: false,
    onOpenPlugins: vi.fn(),
    ...overrides
  }

  render(<ProjectTabs {...props} />)
  return props
}

describe('ProjectTabs', () => {
  // The news a project's agents have for the user, on the tab that holds them.
  // Its own element, so the tab is still called by its letters.
  it.each([
    { mark: 'waiting' as const, label: 'Waiting for your answer', tone: 'bg-warning' },
    { mark: 'error' as const, label: 'The last turn ended in an error', tone: 'bg-danger' },
    {
      mark: 'done' as const,
      label: 'An agent finished here while you were away',
      tone: 'bg-success'
    }
  ])('marks a project whose agent is $mark', ({ mark, label, tone }) => {
    renderTabs({ marks: new Map([['planner', mark]]) })

    expect(screen.getByRole('img', { name: label })).toHaveClass(tone)
    expect(screen.getByRole('button', { name: 'PL' })).toBeInTheDocument()
  })

  it('marks only the project the news is about', () => {
    renderTabs({
      projects: [project(), project({ id: 'tracker', name: 'tracker' })],
      marks: new Map([['tracker', 'done']])
    })

    expect(screen.getAllByRole('img')).toHaveLength(1)
    const tile = screen.getByRole('img').parentElement
    expect(tile).toContainElement(screen.getByRole('button', { name: 'TR' }))
    expect(tile).not.toContainElement(screen.getByRole('button', { name: 'PL' }))
  })

  // The letters are mixed towards the ink in every state. Measured over the
  // fifteen colours in both themes: the colour alone, or with `--ink-faint`, was
  // 3.3:1 on the idle tile in the light theme.
  it.each([
    { state: 'idle', activeProjectId: null },
    { state: 'chosen', activeProjectId: 'planner' }
  ])(
    'draws the letters of a $state tab a quarter of the way towards the ink',
    ({ activeProjectId }) => {
      renderTabs({ activeProjectId })

      expect(screen.getByRole('button', { name: 'PL' })).toHaveStyle({
        color: 'color-mix(in srgb, var(--project-color) 75%, var(--ink))'
      })
    }
  )

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

  // The fold moved to the footer, beside Settings. A copy left in the strip
  // would be two controls for one thing, one of them scrolling with the tabs.
  it('does not carry the fold, which lives in the footer now', () => {
    renderTabs()

    expect(screen.queryByRole('button', { name: 'Hide workspaces' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show workspaces' })).toBeNull()
  })

  it('still offers to add a repository when there are no projects', () => {
    renderTabs({ projects: [], activeProjectId: null })

    expect(screen.getByTitle('Add repository')).toBeEnabled()
  })

  describe('the plugins tile', () => {
    it('opens the plugins window', async () => {
      const user = userEvent.setup()
      const props = renderTabs()

      await user.click(screen.getByRole('button', { name: 'Plugins' }))

      expect(props.onOpenPlugins).toHaveBeenCalledOnce()
    })

    // Below the scrolling list, not at its end: forty projects must not push
    // it out of sight, and none must not pull it up under the "+".
    it('sits in a foot of its own, outside the list that scrolls', () => {
      renderTabs({ projects: [project(), project({ id: 'ledger', name: 'ledger' })] })

      const tile = screen.getByRole('button', { name: 'Plugins' })
      const list = screen.getByTitle('Add repository').closest('.overflow-y-auto')

      expect(list).not.toBeNull()
      expect(list?.contains(tile)).toBe(false)
    })

    it('says whether the window is open', () => {
      renderTabs({ pluginsOpen: true })

      expect(screen.getByRole('button', { name: 'Plugins' })).toHaveAttribute(
        'aria-expanded',
        'true'
      )
    })

    it('draws no mark when every plugin loads', () => {
      renderTabs()
      expect(screen.queryByRole('img', { name: 'A plugin would not load' })).toBeNull()
    })

    it('marks a plugin that would not load', () => {
      renderTabs({ pluginTrouble: true })

      expect(screen.getByRole('img', { name: 'A plugin would not load' })).toHaveClass('bg-warning')
    })
  })

  describe('dragging a tab', () => {
    const three = [
      project({ id: 'planner', name: 'planner' }),
      project({ id: 'ledger', name: 'ledger' }),
      project({ id: 'esl', name: 'esl' })
    ]
    const tab = (name: string): HTMLElement => screen.getByRole('button', { name })

    it('moves a project down onto the tile it is dropped on', () => {
      const props = renderTabs({ projects: three })

      fireEvent.dragStart(tab('PL'))
      fireEvent.dragOver(tab('ES'))
      fireEvent.drop(tab('ES'))

      expect(props.onReorder).toHaveBeenCalledWith(['ledger', 'esl', 'planner'])
    })

    it('moves a project up onto the tile it is dropped on', () => {
      const props = renderTabs({ projects: three })

      fireEvent.dragStart(tab('ES'))
      fireEvent.drop(tab('PL'))

      expect(props.onReorder).toHaveBeenCalledWith(['esl', 'planner', 'ledger'])
    })

    it('does nothing when a tile is dropped on itself', () => {
      const props = renderTabs({ projects: three })

      fireEvent.dragStart(tab('LE'))
      fireEvent.drop(tab('LE'))

      expect(props.onReorder).not.toHaveBeenCalled()
    })

    it('does nothing for a drop with no drag behind it', () => {
      const props = renderTabs({ projects: three })

      fireEvent.drop(tab('LE'))

      expect(props.onReorder).not.toHaveBeenCalled()
    })

    it('draws the line on the edge the project would land against', () => {
      renderTabs({ projects: three })

      fireEvent.dragStart(tab('LE'))
      fireEvent.dragOver(tab('ES'))
      expect(screen.getByTestId('drop-line').className).toContain('-bottom-')

      fireEvent.dragOver(tab('PL'))
      expect(screen.getByTestId('drop-line').className).toContain('-top-')
    })

    it('draws no line over the tile being dragged, and none once it ends', () => {
      renderTabs({ projects: three })

      fireEvent.dragStart(tab('LE'))
      fireEvent.dragOver(tab('LE'))
      expect(screen.queryByTestId('drop-line')).toBeNull()

      fireEvent.dragOver(tab('ES'))
      expect(screen.getByTestId('drop-line')).toBeInTheDocument()

      fireEvent.dragEnd(tab('LE'))
      expect(screen.queryByTestId('drop-line')).toBeNull()
    })

    it('still selects on a click', async () => {
      const props = renderTabs({ projects: three })

      await userEvent.click(tab('ES'))

      expect(props.onSelect).toHaveBeenCalledWith('esl')
    })
  })
})
