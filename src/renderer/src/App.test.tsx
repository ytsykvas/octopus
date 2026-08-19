import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { GitHubAccount } from '@core/accounts.js'
import type { Config } from '@core/config.js'
import type { RemoteRepository } from '@core/github.js'
import type { ScriptKind } from '@core/scripts.js'
import type { Project } from '@core/store.js'
import type { ThemeName } from '@core/types.js'
import type { WorkspaceView } from '@core/workspaces.js'

import type { Result } from '../../preload/index.js'
import { fileDiff, workspaceDiff } from './test/diff.js'
import { stubDialogElement } from './test/dialog.js'
import { chat } from './test/chat.js'
import { disconnectedAccounts } from './test/octopus.js'
import { workspaceView } from './test/workspaces.js'
import { App } from './App.js'
import i18n, { DEFAULT_LANGUAGE } from './i18n/index.js'

// A workspace terminal is xterm.js against a real canvas, which jsdom has not
// got. Standing it in as its working directory keeps the pane observable —
// which terminal is on screen is exactly what the shortcut tests are about.
vi.mock('./components/Terminal.js', () => ({
  Terminal: ({ cwd }: { readonly cwd: string }) => <div>{cwd}</div>
}))

// Every dialog in the app opens itself with `showModal()`, which jsdom leaves out.
beforeAll(stubDialogElement)

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'planner',
    name: 'planner',
    repoPath: '/Users/someone/code/planner',
    baseBranch: 'origin/main',
    branchPrefix: 'ytsykvas',
    color: 'blue',
    ...overrides
  }
}

function config(overrides: Partial<Config> = {}): Config {
  return {
    version: 1,
    branchPrefix: 'ytsykvas',
    cloneDirectory: '',
    settingSources: 'none',
    workingMode: 'default',
    effort: 'medium',
    model: null,
    planModel: null,
    alwaysAllowedTools: [],
    theme: 'system',
    language: 'en',
    rightPanelWidth: 360,
    rightPanelTab: 'diff',
    diffView: 'unified',
    sidebarWidth: 240,
    deviceId: '00000000-0000-4000-8000-000000000000',
    installedAt: '2026-08-08T00:00:00.000Z',
    ...overrides
  }
}

const PLANNER = project({ id: 'planner', name: 'planner' })
const LEDGER = project({
  id: 'ledger',
  name: 'ledger',
  repoPath: '/Users/someone/code/ledger',
  color: 'green'
})

const LEDGER_REPOSITORY: RemoteRepository = {
  name: 'ledger',
  nameWithOwner: 'someone/ledger',
  owner: { login: 'someone' },
  description: 'Double-entry bookkeeping',
  isPrivate: false,
  updatedAt: '2026-08-01T00:00:00.000Z'
}

/**
 * A read a test settles by hand, standing in for one the app is still waiting on.
 *
 * Settling hands the promise back so the caller can wait for it to have been
 * delivered rather than merely sent.
 */
function pending<T>(): {
  readonly promise: Promise<T>
  readonly settle: (value: T) => Promise<T>
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })

  return {
    promise,
    settle: (value) => {
      resolve(value)
      return promise
    }
  }
}

/** Both projects, each with two workspaces — enough for the digit shortcuts. */
function givenTwoProjects(): void {
  vi.mocked(window.octopus.projects.list).mockResolvedValue({
    ok: true,
    value: [PLANNER, LEDGER]
  })

  const workspacesOf: Record<string, WorkspaceView[]> = {
    planner: [workspaceView('anna'), workspaceView('bob')],
    ledger: [
      workspaceView('carol', {
        id: 'ledger/carol',
        projectId: 'ledger',
        path: '/tmp/ledger/carol'
      })
    ]
  }

  vi.mocked(window.octopus.workspaces.list).mockImplementation((projectId: string) =>
    Promise.resolve({ ok: true, value: workspacesOf[projectId] ?? [] })
  )
}

/**
 * Both projects listed, with their workspaces still on the way.
 *
 * The two lists are read separately, so a project the window already draws may
 * have no workspaces yet — which is a different state from having none.
 */
function givenWorkspacesStillLoading(): void {
  vi.mocked(window.octopus.projects.list).mockResolvedValue({
    ok: true,
    value: [PLANNER, LEDGER]
  })
  vi.mocked(window.octopus.workspaces.list).mockReturnValue(new Promise(() => undefined))
}

/** Where each project keeps its scripts, for the ones a test names. */
function givenScriptsOf(paths: Record<string, Record<ScriptKind, string | null>>): void {
  vi.mocked(window.octopus.projects.scriptPaths).mockImplementation((projectId: string) =>
    Promise.resolve({
      ok: true,
      value: paths[projectId] ?? { setup: null, run: null, archive: null }
    })
  )
}

/** Renders the window and waits for the first list of projects to arrive. */
async function openApp(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', { name: 'Add repository' })
  return user
}

/** The tab of a project, which carries two letters of its name. */
function tab(letters: string): HTMLElement {
  return screen.getByRole('button', { name: letters })
}

/** The right pane: a `<section>`, which carries no role to reach it by. */
function rightPane(): HTMLElement {
  const section = screen.getByRole('button', { name: 'Changes' }).closest('section')
  if (!section) throw new Error('the right pane is not in the window')
  return section
}

/** The draggable edges, in the order they sit in the window. */
function edges(): { readonly list: HTMLElement; readonly panel: HTMLElement } {
  const [list, panel] = screen.getAllByRole('separator', { name: 'Resize panel' })
  if (!list || !panel) throw new Error('the window is missing a draggable edge')
  return { list, panel }
}

/**
 * An account the picker can actually list from.
 *
 * The shared stub reports GitHub as disconnected, which is the right default
 * for a fresh machine but the wrong one for a test about the picker — without
 * this the window sends the user to Settings instead, and the picker that never
 * opens looks like a broken picker rather than a stated precondition.
 */
function givenGitHubConnected(): void {
  vi.mocked(window.octopus.accounts.github).mockResolvedValue({
    ok: true,
    value: { connected: true, login: 'ytsykvas', name: 'Yurii' }
  })
}

/** Opens the GitHub picker the way the tab strip offers it. */
async function openRepositoryPicker(
  user: ReturnType<typeof userEvent.setup>
): Promise<HTMLElement> {
  givenGitHubConnected()
  await user.click(screen.getByRole('button', { name: 'Add repository' }))
  await user.click(screen.getByRole('menuitem', { name: /From GitHub/ }))
  return screen.findByRole('dialog', { name: 'Add from GitHub' })
}

/** Opens one project's settings from its tab menu. */
async function openProjectSettings(
  user: ReturnType<typeof userEvent.setup>,
  letters: string
): Promise<HTMLElement> {
  fireEvent.contextMenu(tab(letters))
  await user.click(screen.getByRole('menuitem', { name: 'Edit…' }))
  return screen.findByRole('dialog', { name: 'Project settings' })
}

describe('App', () => {
  // The language and the root element outlive a single render: i18n is a
  // module-level singleton and the theme is a class on the document. Unmounting
  // first, because a window still on screen re-applies the language it was
  // configured with the moment the reset lands.
  afterEach(async () => {
    cleanup()
    await i18n.changeLanguage(DEFAULT_LANGUAGE)
    document.documentElement.classList.remove('dark')
  })

  it('points a first-time user at adding a repository', async () => {
    await openApp()

    expect(await screen.findByText('Start with a repository')).toBeInTheDocument()
  })

  // The screen a first run lands on had the instructions and none of the
  // buttons, which is a strange thing to do with a pane this empty.
  it('offers both ways in from the empty centre', async () => {
    await openApp()
    await screen.findByText('Start with a repository')

    expect(screen.getByRole('button', { name: 'Add from disk…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add from GitHub…' })).toBeInTheDocument()
  })

  it('opens the project added from the empty centre', async () => {
    vi.mocked(window.octopus.projects.add).mockResolvedValue({ ok: true, value: LEDGER })
    vi.mocked(window.octopus.projects.list)
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValue({ ok: true, value: [LEDGER] })
    const user = await openApp()
    await screen.findByText('Start with a repository')

    await user.click(screen.getByRole('button', { name: 'Add from disk…' }))

    expect(await screen.findByText('/Users/someone/code/ledger')).toBeInTheDocument()
  })

  // Projects exist but none is open: the tabs are the likelier answer, so the
  // buttons stay, quietly, rather than the pane going back to being a dead end.
  it('still offers both ways in once projects exist but none is open', async () => {
    givenTwoProjects()

    await openApp()
    await screen.findByText('Select a project')

    expect(screen.getByRole('button', { name: 'Add from disk…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add from GitHub…' })).toBeInTheDocument()
  })

  it('shows a tab for every project', async () => {
    givenTwoProjects()

    await openApp()

    expect(await screen.findByRole('button', { name: 'PL' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'LE' })).toBeInTheDocument()
  })

  // Opening the app restores no project, so the first thing asked for is which.
  it('asks which project to open while none is', async () => {
    givenTwoProjects()

    await openApp()

    expect(await screen.findByText('Select a project')).toBeInTheDocument()
    expect(
      screen.getByText('Nothing here yet. Add a repository with the "+" button.')
    ).toBeInTheDocument()
  })

  it('opens the project whose tab was clicked', async () => {
    givenTwoProjects()
    const user = await openApp()

    await user.click(await screen.findByRole('button', { name: 'LE' }))

    expect(screen.getByText('/Users/someone/code/ledger')).toBeInTheDocument()
    // A project is open and no workspace is chosen, which is its own screen —
    // it names what to do and offers the way out, rather than describing one.
    expect(await screen.findByText('Select a workspace')).toBeInTheDocument()
    expect(
      within(screen.getByRole('main')).getByRole('button', { name: 'New workspace' })
    ).toBeInTheDocument()
  })

  it('lists the workspaces of the project that is open', async () => {
    givenTwoProjects()
    const user = await openApp()

    await user.click(await screen.findByRole('button', { name: 'PL' }))

    expect(await screen.findByText('anna')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.queryByText('carol')).not.toBeInTheDocument()
  })

  // Each pane is tested on its own; what belongs here is that the window puts
  // all three up at once, since composing them is this component's whole job.
  it('shows the tab strip, the workspace list and the right pane together', async () => {
    givenTwoProjects()
    const user = await openApp()

    await user.click(await screen.findByRole('button', { name: 'PL' }))

    expect(tab('PL')).toBeInTheDocument()
    expect(await screen.findByText('anna')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Changes' })).toBeInTheDocument()
  })

  // The pane is composed here, and the colour it wears comes from the project
  // this component picked — a wiring the pane's own tests cannot see.
  it('gives the right pane the colour of the project that is open', async () => {
    givenTwoProjects()
    const user = await openApp()

    await user.click(await screen.findByRole('button', { name: 'LE' }))

    expect(rightPane()).toHaveStyle({ '--project-color': 'var(--project-green)' })
  })

  // Another wiring the pane's own tests cannot see: the composer's footer has
  // to name what the chat record will be created with, and that comes from the
  // settings, which live here.
  it('gives the chat the mode the settings say a new conversation starts in', async () => {
    givenTwoProjects()
    vi.mocked(window.octopus.config.get).mockResolvedValue({
      ok: true,
      value: config({ workingMode: 'acceptEdits' })
    })
    const user = await openApp()

    await user.click(await screen.findByRole('button', { name: 'PL' }))
    await user.click(await screen.findByText('anna'))

    expect(await screen.findByRole('button', { name: /^Permissions:/ })).toHaveTextContent(
      'Auto mode'
    )
  })

  it('leaves the right pane its default colour while no project is open', async () => {
    givenTwoProjects()
    await openApp()

    expect(await screen.findByRole('button', { name: 'Changes' })).toBeInTheDocument()
    expect(rightPane().style.getPropertyValue('--project-color')).toBe('')
  })

  it('hides the workspace list when it is folded away', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))
    expect(await screen.findByText('anna')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Hide workspaces' }))

    expect(screen.queryByText('anna')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show workspaces' })).toBeInTheDocument()
  })

  // Picking a project is asking to see it, and folded away there is nothing to
  // see — so the click must not appear to do nothing.
  it('brings the workspace list back when a project is picked', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))
    await user.click(await screen.findByRole('button', { name: 'Hide workspaces' }))

    await user.click(tab('LE'))

    expect(await screen.findByText('carol')).toBeInTheDocument()
  })

  it('keeps the tab strip reachable while the list is folded away', async () => {
    givenTwoProjects()
    const user = await openApp()

    await user.click(await screen.findByRole('button', { name: 'Hide workspaces' }))

    expect(tab('PL')).toBeInTheDocument()
    expect(tab('LE')).toBeInTheDocument()
  })

  /*
   * The right pane may grow into whatever the window has left once the left
   * column and a usable centre have theirs — and only this window knows what
   * that column comes to, being the one place that holds both the list's stored
   * width and whether it is folded. Asserted from here because the pane's own
   * tests are handed the number: told the wrong one, every last of them passes.
   *
   * 1024 less the strip (56), the list at its default (240) and the centre's
   * own 360 leaves 368; folding the list hands its 240 straight to the pane.
   */
  it('offers the pane the room the folded list gives up', async () => {
    givenTwoProjects()
    const user = await openApp()

    // Not `edges()`: that one wants both, and folding the list takes its edge
    // away with it. The pane's is the last, being the last thing in the row.
    const paneEdge = (): HTMLElement => {
      const edge = screen.getAllByRole('separator', { name: 'Resize panel' }).at(-1)
      if (!edge) throw new Error('the pane has no draggable edge')
      return edge
    }

    expect(paneEdge()).toHaveAttribute('aria-valuemax', '368')

    await user.click(await screen.findByRole('button', { name: 'Hide workspaces' }))

    expect(paneEdge()).toHaveAttribute('aria-valuemax', '608')
  })

  it('opens the settings dialog from the sidebar', async () => {
    const user = await openApp()

    await user.click(screen.getByRole('button', { name: 'Settings' }))

    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
  })

  // ⌘, belongs to the native menu on macOS; the renderer only reacts to it.
  it('opens the settings dialog when the native menu asks for it', async () => {
    await openApp()
    const openSettings = vi.mocked(window.octopus.settings.onOpen).mock.calls.at(-1)?.[0]
    if (!openSettings) throw new Error('the window never subscribed to the menu')

    act(() => {
      openSettings()
    })

    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
  })

  it('closes the settings dialog again', async () => {
    const user = await openApp()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('switches project with Cmd and a digit', async () => {
    givenTwoProjects()
    const user = await openApp()
    await screen.findByRole('button', { name: 'LE' })

    await user.keyboard('{Meta>}2{/Meta}')

    expect(await screen.findByText('carol')).toBeInTheDocument()
    expect(screen.getByText('/Users/someone/code/ledger')).toBeInTheDocument()
  })

  it('leaves the project alone when the digit points past the last tab', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))

    await user.keyboard('{Meta>}5{/Meta}')

    expect(screen.getByText('/Users/someone/code/planner')).toBeInTheDocument()
  })

  // A bare digit is something the user typed, not a command.
  it('ignores a digit pressed without a modifier', async () => {
    givenTwoProjects()
    const user = await openApp()
    await screen.findByRole('button', { name: 'LE' })

    await user.keyboard('2')

    expect(screen.getByText('Select a project')).toBeInTheDocument()
  })

  it('switches workspace with Ctrl and a digit', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))
    await user.click(screen.getByRole('button', { name: 'Terminal' }))
    expect(
      screen.getByText('Select a workspace to open a terminal in its directory.')
    ).toBeInTheDocument()

    await user.keyboard('{Control>}2{/Control}')

    expect(await screen.findByText('/tmp/planner/bob')).toBeInTheDocument()
  })

  it('leaves the workspace alone when the digit points past the last one', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))
    await user.click(screen.getByRole('button', { name: 'Terminal' }))

    await user.keyboard('{Control>}7{/Control}')

    expect(
      screen.getByText('Select a workspace to open a terminal in its directory.')
    ).toBeInTheDocument()
  })

  // The centre pane would look the same either way, so the terminal is what
  // says whether a workspace was opened behind the app's back.
  it('opens no workspace on Ctrl and a digit while no project is open', async () => {
    givenTwoProjects()
    const user = await openApp()
    await screen.findByRole('button', { name: 'LE' })
    await user.click(screen.getByRole('button', { name: 'Terminal' }))

    await user.keyboard('{Control>}1{/Control}')

    expect(
      screen.getByText('Select a workspace to open a terminal in its directory.')
    ).toBeInTheDocument()
  })

  // The terminal on screen belongs to a workspace of the project that was open;
  // carrying it into another project would be showing the wrong directory.
  it('forgets the open workspace when another project is picked', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))
    await user.click(screen.getByRole('button', { name: 'Terminal' }))
    await user.keyboard('{Control>}1{/Control}')
    expect(await screen.findByText('/tmp/planner/anna')).toBeInTheDocument()

    await user.click(tab('LE'))

    expect(
      await screen.findByText('Select a workspace to open a terminal in its directory.')
    ).toBeInTheDocument()
  })

  it('creates a workspace in the open project with Cmd+Shift+N', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'LE' }))

    await user.keyboard('{Meta>}{Shift>}N{/Shift}{/Meta}')

    expect(window.octopus.workspaces.create).toHaveBeenCalledWith('ledger')
  })

  it('creates nothing with Cmd+Shift+N while no project is open', async () => {
    givenTwoProjects()
    const user = await openApp()
    await screen.findByRole('button', { name: 'LE' })

    await user.keyboard('{Meta>}{Shift>}N{/Shift}{/Meta}')

    expect(window.octopus.workspaces.create).not.toHaveBeenCalled()
  })

  // One control in one place. The button that folds the pane away could not
  // live inside it: once folded, there would be nothing left to click.
  it('folds the right pane away and back from one button in the title bar', async () => {
    const user = await openApp()
    const bar = screen.getByRole('banner')

    await user.click(within(bar).getByRole('button', { name: 'Collapse panel' }))
    expect(screen.queryByRole('button', { name: 'Changes' })).not.toBeInTheDocument()

    await user.click(within(bar).getByRole('button', { name: 'Show panel' }))
    expect(screen.getByRole('button', { name: 'Changes' })).toBeInTheDocument()
  })

  it('reports a failure to read the list of projects', async () => {
    vi.mocked(window.octopus.projects.list).mockResolvedValue({
      ok: false,
      error: 'git is not installed'
    })

    await openApp()

    expect(
      await screen.findByText('Something went wrong: git is not installed')
    ).toBeInTheDocument()
  })

  // The theme is decided by the main process, which follows the system. Its
  // whole surface in the renderer is the class on the root element: that is
  // what the stylesheet reads, and nothing in the window shows it otherwise.
  it('wears the theme the main process reports', async () => {
    vi.mocked(window.octopus.theme.get).mockResolvedValue('dark')

    await openApp()

    await waitFor(() => {
      expect(document.documentElement).toHaveClass('dark')
    })
  })

  it('follows a theme the main process changes later', async () => {
    await openApp()
    const push = vi.mocked(window.octopus.theme.onChange).mock.calls.at(-1)?.[0]
    if (!push) throw new Error('the window never subscribed to theme changes')

    act(() => {
      push('dark')
    })

    expect(document.documentElement).toHaveClass('dark')
  })

  // Left subscribed, the handler would go on setting state on a window that is
  // no longer there.
  it('stops listening for theme changes when the window closes', async () => {
    const unsubscribe = vi.fn()
    vi.mocked(window.octopus.theme.onChange).mockReturnValue(unsubscribe)
    const { unmount } = render(<App />)
    await screen.findByRole('button', { name: 'Add repository' })

    unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  // The app mounts inside StrictMode, where every effect runs, is torn down and
  // runs again. Without the abort, the read the first pass gave up on would
  // still land — and being the slower of the two, it would land last and win.
  it('drops the theme from the read it gave up on', async () => {
    const abandoned = pending<ThemeName>()
    vi.mocked(window.octopus.theme.get)
      .mockReturnValueOnce(abandoned.promise)
      .mockResolvedValue('light')
    render(
      <StrictMode>
        <App />
      </StrictMode>
    )
    await screen.findByRole('button', { name: 'Add repository' })

    await act(async () => {
      await abandoned.settle('dark')
    })

    expect(document.documentElement).not.toHaveClass('dark')
  })

  // Settings edits the config, so without one there is nothing to put in the
  // form — better no dialog than a dialog with nothing behind it.
  it('keeps the settings dialog shut when the config could not be read', async () => {
    vi.mocked(window.octopus.config.get).mockResolvedValue({
      ok: false,
      error: 'the config file is corrupt'
    })
    const user = await openApp()

    await user.click(screen.getByRole('button', { name: 'Settings' }))

    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument()
  })

  // Same StrictMode double-run as the theme, and the same reason for the abort.
  it('drops the config from the read it gave up on', async () => {
    const abandoned = pending<Result<Config>>()
    vi.mocked(window.octopus.config.get)
      .mockReturnValueOnce(abandoned.promise)
      .mockResolvedValue({ ok: true, value: config({ language: 'en' }) })
    render(
      <StrictMode>
        <App />
      </StrictMode>
    )
    await screen.findByRole('button', { name: 'Add repository' })

    await act(async () => {
      await abandoned.settle({ ok: true, value: config({ language: 'uk' }) })
    })

    expect(screen.getByText('Start with a repository')).toBeInTheDocument()
  })

  // The language lives in the config so it survives a restart.
  it('shows the window in the language the config names', async () => {
    vi.mocked(window.octopus.config.get).mockResolvedValue({
      ok: true,
      value: config({ language: 'uk' })
    })

    await openApp()

    expect(await screen.findByText('Почніть з репозиторію')).toBeInTheDocument()
  })

  it('remembers the width the workspace list was resized to', async () => {
    const user = await openApp()
    edges().list.focus()

    await user.keyboard('{ArrowRight}')

    expect(window.octopus.config.update).toHaveBeenCalledWith({ sidebarWidth: 256 })
  })

  it('remembers the width the right pane was resized to', async () => {
    // Widened first: the pane's ceiling is what the window has left after the
    // project strip, the list and a usable centre, and jsdom's own 1024 leaves
    // it eight pixels of headroom — a nudge of sixteen would be measuring the
    // clamp rather than the nudge.
    const narrow = window.innerWidth
    window.innerWidth = 1400

    try {
      const user = await openApp()
      edges().panel.focus()

      await user.keyboard('{ArrowLeft}')

      expect(window.octopus.config.update).toHaveBeenCalledWith({ rightPanelWidth: 376 })
    } finally {
      window.innerWidth = narrow
    }
  })

  // How a diff is laid out is a preference about how code is read, so it
  // outlives the session that chose it.
  it('remembers how the reader asked diffs to be laid out', async () => {
    const narrow = window.innerWidth
    window.innerWidth = 1400

    try {
      givenTwoProjects()
      vi.mocked(window.octopus.workspaces.diff).mockResolvedValue({
        ok: true,
        value: workspaceDiff([fileDiff('src/a.ts')])
      })
      // The sample the pane measures its monospace cell from reports zero in
      // jsdom, so no width would ever be wide enough for two columns.
      vi.spyOn(HTMLSpanElement.prototype, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 32, 16)
      )

      const user = await openApp()
      await user.click(await screen.findByRole('button', { name: 'PL' }))
      await user.click(await screen.findByText('anna'))

      await user.click(await screen.findByRole('button', { name: 'Side by side' }))

      expect(window.octopus.config.update).toHaveBeenCalledWith({ diffView: 'split' })
    } finally {
      window.innerWidth = narrow
    }
  })

  it('reports a failure to save a setting', async () => {
    vi.mocked(window.octopus.config.update).mockResolvedValue({
      ok: false,
      error: 'the disk is full'
    })
    const user = await openApp()
    edges().list.focus()

    await user.keyboard('{ArrowRight}')

    expect(await screen.findByText('Something went wrong: the disk is full')).toBeInTheDocument()
  })

  it('opens the project added from disk', async () => {
    vi.mocked(window.octopus.projects.add).mockResolvedValue({ ok: true, value: LEDGER })
    vi.mocked(window.octopus.projects.list)
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValue({ ok: true, value: [LEDGER] })
    const user = await openApp()

    await user.click(screen.getByRole('button', { name: 'Add repository' }))
    await user.click(screen.getByRole('menuitem', { name: /From disk/ }))

    expect(await screen.findByText('/Users/someone/code/ledger')).toBeInTheDocument()
  })

  // Cancelling the directory picker is an answer, not a failure: nothing is
  // added, so nothing should open either.
  it('opens nothing when the directory picker is cancelled', async () => {
    givenTwoProjects()
    const user = await openApp()
    await screen.findByRole('button', { name: 'LE' })

    await user.click(screen.getByRole('button', { name: 'Add repository' }))
    await user.click(screen.getByRole('menuitem', { name: /From disk/ }))

    expect(await screen.findByText('Select a project')).toBeInTheDocument()
  })

  it('clears the selection when the project that is open is removed', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))
    expect(screen.getByText('/Users/someone/code/planner')).toBeInTheDocument()
    vi.mocked(window.octopus.projects.list).mockResolvedValue({ ok: true, value: [LEDGER] })

    fireEvent.contextMenu(tab('PL'))
    await user.click(screen.getByRole('menuitem', { name: 'Remove project' }))
    await user.click(await screen.findByRole('button', { name: 'Remove' }))

    expect(await screen.findByText('Select a project')).toBeInTheDocument()
    expect(window.octopus.projects.remove).toHaveBeenCalledWith('planner')
  })

  it('keeps the project that is open when another one is removed', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))
    vi.mocked(window.octopus.projects.list).mockResolvedValue({ ok: true, value: [PLANNER] })

    fireEvent.contextMenu(tab('LE'))
    await user.click(screen.getByRole('menuitem', { name: 'Remove project' }))
    await user.click(await screen.findByRole('button', { name: 'Remove' }))

    expect(await screen.findByText('/Users/someone/code/planner')).toBeInTheDocument()
  })

  it('leaves the project in place when the removal is declined', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))

    fireEvent.contextMenu(tab('PL'))
    await user.click(screen.getByRole('menuitem', { name: 'Remove project' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(window.octopus.projects.remove).not.toHaveBeenCalled()
    expect(screen.getByText('/Users/someone/code/planner')).toBeInTheDocument()
  })

  // The question names what is being deleted, and until the workspaces are
  // known the honest answer is that only the entry goes.
  it('asks the plain question while the workspaces are still loading', async () => {
    givenWorkspacesStillLoading()
    const user = await openApp()

    fireEvent.contextMenu(await screen.findByRole('button', { name: 'PL' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove project' }))

    expect(
      await screen.findByText('The repository stays on disk exactly where it is.')
    ).toBeInTheDocument()
  })

  it('shows an empty workspace list while it is still loading', async () => {
    givenWorkspacesStillLoading()
    const user = await openApp()

    await user.click(await screen.findByRole('button', { name: 'PL' }))

    expect(
      await screen.findByText('No workspaces yet. Add one with the + above.')
    ).toBeInTheDocument()
  })

  it('opens no workspace on Ctrl and a digit while the list is still loading', async () => {
    givenWorkspacesStillLoading()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))
    await user.click(screen.getByRole('button', { name: 'Terminal' }))

    await user.keyboard('{Control>}1{/Control}')

    expect(
      screen.getByText('Select a workspace to open a terminal in its directory.')
    ).toBeInTheDocument()
  })

  // ⌘ and a letter is a shortcut of something else — the window must not read
  // it as a tab number.
  it('ignores Cmd and a key that is not a digit', async () => {
    givenTwoProjects()
    const user = await openApp()
    await screen.findByRole('button', { name: 'LE' })

    await user.keyboard('{Meta>}a{/Meta}')

    expect(screen.getByText('Select a project')).toBeInTheDocument()
  })

  // Tabs are numbered from one, so there is nothing for ⌘0 to address.
  it('ignores Cmd and zero', async () => {
    givenTwoProjects()
    const user = await openApp()
    await screen.findByRole('button', { name: 'LE' })

    await user.keyboard('{Meta>}0{/Meta}')

    expect(screen.getByText('Select a project')).toBeInTheDocument()
  })

  it('creates a workspace from the list header', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'LE' }))

    // Named within the sidebar: the centre offers the same action while no
    // workspace is selected, and both are meant to be reachable.
    const sidebar = within(screen.getByRole('complementary'))
    await user.click(await sidebar.findByRole('button', { name: 'New workspace' }))

    expect(window.octopus.workspaces.create).toHaveBeenCalledWith('ledger')
  })

  /*
   * A project with no workspaces used to say "select a workspace" over an empty
   * list, and offered nothing to click: the button that makes one lives in the
   * sidebar's project header, which is not where someone who has just added a
   * repository is looking.
   */
  it('offers to create the first workspace from the centre', async () => {
    givenTwoProjects()
    // A project nobody has made a workspace in yet — the state a repository is
    // in the moment it is added.
    vi.mocked(window.octopus.workspaces.list).mockImplementation((projectId: string) =>
      Promise.resolve({ ok: true, value: projectId === 'ledger' ? [] : [workspaceView('anna')] })
    )
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'LE' }))

    expect(await screen.findByText('Create the first workspace')).toBeInTheDocument()

    const centre = within(screen.getByRole('main'))
    await user.click(centre.getByRole('button', { name: 'New workspace' }))

    expect(window.octopus.workspaces.create).toHaveBeenCalledWith('ledger')
  })

  it('renames a workspace from the list', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'LE' }))

    await user.dblClick(await screen.findByText('carol'))
    const field = screen.getByTitle('Enter to save, Escape to cancel')
    await user.clear(field)
    await user.type(field, 'invoices{Enter}')

    expect(window.octopus.workspaces.rename).toHaveBeenCalledWith('ledger/carol', 'invoices')
  })

  // Confirming without touching the dialog takes the branch with it: a
  // workspace is one task, and the branch behind a finished one is finished too.
  it('removes a workspace from its menu, branch and all', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'LE' }))
    await screen.findByText('carol')

    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove workspace' }))
    await user.click(await screen.findByRole('button', { name: 'Remove' }))

    expect(window.octopus.workspaces.remove).toHaveBeenCalledWith('ledger/carol', {
      force: false,
      deleteBranch: true
    })
  })

  // The default is in front of the user and one click undoes it — which is the
  // only thing that makes a destructive default acceptable.
  it('keeps the branch when that box is unticked', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'LE' }))
    await screen.findByText('carol')

    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove workspace' }))
    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(window.octopus.workspaces.remove).toHaveBeenCalledWith('ledger/carol', {
      force: false,
      deleteBranch: false
    })
  })

  it('opens the GitHub picker from the add menu', async () => {
    const user = await openApp()
    vi.mocked(window.octopus.projects.listRemote).mockResolvedValue({
      ok: true,
      value: [LEDGER_REPOSITORY]
    })

    const picker = await openRepositoryPicker(user)

    expect(within(picker).getByText('someone/ledger')).toBeInTheDocument()
  })

  it('opens the GitHub picker from the empty centre when the account is connected', async () => {
    givenGitHubConnected()
    vi.mocked(window.octopus.projects.listRemote).mockResolvedValue({
      ok: true,
      value: [LEDGER_REPOSITORY]
    })
    const user = await openApp()
    await screen.findByText('Start with a repository')

    await user.click(screen.getByRole('button', { name: 'Add from GitHub…' }))

    const picker = await screen.findByRole('dialog', { name: 'Add from GitHub' })
    expect(within(picker).getByText('someone/ledger')).toBeInTheDocument()
  })

  // A picker listing nothing is a worse answer than the dialog that can fix it.
  // Landing on Git rather than merely opening Settings is the point: the
  // account is there, and Appearance would be a dead end with extra steps.
  it('sends an unconnected user to the Git settings instead of an empty picker', async () => {
    const user = await openApp()
    await screen.findByText('Start with a repository')

    await user.click(screen.getByRole('button', { name: 'Add from GitHub…' }))

    const settings = await screen.findByRole('dialog', { name: 'Settings' })
    expect(within(settings).getByText('Branch prefix')).toBeInTheDocument()
    expect(within(settings).queryByText('Theme')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Add from GitHub' })).not.toBeInTheDocument()
  })

  // The centre and the tab strip share one handler, but not one wiring. Without
  // this, the menu could be reconnected straight to the picker — the way it used
  // to be — and every other test here would stay green.
  it('sends an unconnected user to the Git settings from the add menu too', async () => {
    const user = await openApp()

    await user.click(screen.getByRole('button', { name: 'Add repository' }))
    await user.click(screen.getByRole('menuitem', { name: /From GitHub/ }))

    const settings = await screen.findByRole('dialog', { name: 'Settings' })
    expect(within(settings).getByText('Branch prefix')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Add from GitHub' })).not.toBeInTheDocument()
  })

  // The centre button disables itself, but the menu is a second door into the
  // same check, and it has to close while one is running.
  it('closes the add menu to a second check while one is running', async () => {
    const check = pending<Result<GitHubAccount>>()
    vi.mocked(window.octopus.accounts.github).mockReturnValue(check.promise)
    const user = await openApp()
    await screen.findByText('Start with a repository')

    await user.click(screen.getByRole('button', { name: 'Add from GitHub…' }))

    expect(screen.getByRole('button', { name: 'Add repository' })).toBeDisabled()
    await act(async () => {
      await check.settle({ ok: true, value: disconnectedAccounts().github })
    })
  })

  // `gh` missing and `gh` signed out are the same problem wearing two faces,
  // and both are fixed in the same place.
  it('sends the user to the Git settings when the check itself fails', async () => {
    vi.mocked(window.octopus.accounts.github).mockResolvedValue({
      ok: false,
      error: 'gh: command not found'
    })
    const user = await openApp()
    await screen.findByText('Start with a repository')

    await user.click(screen.getByRole('button', { name: 'Add from GitHub…' }))

    const settings = await screen.findByRole('dialog', { name: 'Settings' })
    expect(within(settings).getByText('Branch prefix')).toBeInTheDocument()
  })

  // Every check spawns a `gh` process, so the button says what it is doing and
  // stops accepting clicks while it does — the label alone would not.
  it('checks the account once while the answer is still on its way', async () => {
    const check = pending<Result<GitHubAccount>>()
    vi.mocked(window.octopus.accounts.github).mockReturnValue(check.promise)
    const user = await openApp()
    await screen.findByText('Start with a repository')

    const button = screen.getByRole('button', { name: 'Add from GitHub…' })
    await user.click(button)
    await user.click(screen.getByRole('button', { name: 'Checking GitHub…' }))

    expect(window.octopus.accounts.github).toHaveBeenCalledTimes(1)
    // The click is about GitHub, so nothing starts a Claude CLI for it.
    expect(window.octopus.accounts.status).not.toHaveBeenCalled()
    await act(async () => {
      await check.settle({ ok: true, value: disconnectedAccounts().github })
    })
  })

  // The pre-flight check cannot catch a token that expires between the click
  // and the listing, so the picker keeps its own way out.
  it('reaches the Git settings from the picker, closing it on the way', async () => {
    vi.mocked(window.octopus.projects.listRemote).mockResolvedValue({
      ok: false,
      error: 'gh is not signed in',
      code: 'notConnected'
    })
    const user = await openApp()
    const picker = await openRepositoryPicker(user)

    await user.click(within(picker).getByRole('button', { name: 'Connect GitHub…' }))

    const settings = await screen.findByRole('dialog', { name: 'Settings' })
    expect(within(settings).getByText('Branch prefix')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Add from GitHub' })).not.toBeInTheDocument()
  })

  it('closes the GitHub picker again', async () => {
    const user = await openApp()
    const picker = await openRepositoryPicker(user)

    await user.click(within(picker).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog', { name: 'Add from GitHub' })).not.toBeInTheDocument()
  })

  it('closes the GitHub picker and lists the repository it cloned', async () => {
    vi.mocked(window.octopus.projects.listRemote).mockResolvedValue({
      ok: true,
      value: [LEDGER_REPOSITORY]
    })
    vi.mocked(window.octopus.projects.addFromGitHub).mockResolvedValue({
      ok: true,
      value: LEDGER
    })
    vi.mocked(window.octopus.projects.list)
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValue({ ok: true, value: [LEDGER] })
    const user = await openApp()
    const picker = await openRepositoryPicker(user)

    await user.click(within(picker).getByRole('button', { name: 'Add' }))

    expect(screen.queryByRole('dialog', { name: 'Add from GitHub' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'LE' })).toBeInTheDocument()
  })

  it('shows where clones will land', async () => {
    vi.mocked(window.octopus.config.get).mockResolvedValue({
      ok: true,
      value: config({ cloneDirectory: '/Users/someone/clones' })
    })
    const user = await openApp()

    const picker = await openRepositoryPicker(user)

    expect(within(picker).getByText('/Users/someone/clones')).toBeInTheDocument()
  })

  // Without a config there is no destination to show, and the picker says so
  // rather than claiming one.
  it('says the destination is still to be chosen when the config could not be read', async () => {
    vi.mocked(window.octopus.config.get).mockResolvedValue({
      ok: false,
      error: 'the config file is corrupt'
    })
    const user = await openApp()

    const picker = await openRepositoryPicker(user)

    expect(within(picker).getByText('You will be asked where to clone.')).toBeInTheDocument()
  })

  it('saves a new clone destination', async () => {
    vi.mocked(window.octopus.dialog.pickDirectory).mockResolvedValue({
      ok: true,
      value: '/Users/someone/clones'
    })
    const user = await openApp()
    const picker = await openRepositoryPicker(user)

    await user.click(within(picker).getByRole('button', { name: 'Change…' }))

    expect(window.octopus.config.update).toHaveBeenCalledWith({
      cloneDirectory: '/Users/someone/clones'
    })
    expect(await within(picker).findByText('/Users/someone/clones')).toBeInTheDocument()
  })

  it('opens the settings of the project the tab menu was opened on', async () => {
    givenTwoProjects()
    const user = await openApp()
    await screen.findByRole('button', { name: 'LE' })

    const dialog = await openProjectSettings(user, 'LE')

    expect(within(dialog).getByDisplayValue('ledger')).toBeInTheDocument()
  })

  it('closes the project settings again', async () => {
    givenTwoProjects()
    const user = await openApp()
    await screen.findByRole('button', { name: 'LE' })
    const dialog = await openProjectSettings(user, 'LE')

    await user.click(within(dialog).getByRole('button', { name: 'Done' }))

    expect(screen.queryByRole('dialog', { name: 'Project settings' })).not.toBeInTheDocument()
  })

  it('saves a change made in the project settings', async () => {
    givenTwoProjects()
    const user = await openApp()
    await screen.findByRole('button', { name: 'LE' })
    const dialog = await openProjectSettings(user, 'LE')

    await user.click(within(dialog).getByRole('button', { name: 'cyan' }))

    expect(window.octopus.projects.update).toHaveBeenCalledWith('ledger', { color: 'cyan' })
  })

  // The confirmation would otherwise appear behind the dialog that raised it.
  it('removes the project from its own settings', async () => {
    givenTwoProjects()
    const user = await openApp()
    await screen.findByRole('button', { name: 'PL' })
    const dialog = await openProjectSettings(user, 'PL')
    await user.click(within(dialog).getByRole('button', { name: 'Danger zone' }))
    vi.mocked(window.octopus.projects.list).mockResolvedValue({ ok: true, value: [LEDGER] })

    await user.click(within(dialog).getByRole('button', { name: 'Remove project' }))
    await user.click(await screen.findByRole('button', { name: 'Remove' }))

    expect(screen.queryByRole('dialog', { name: 'Project settings' })).not.toBeInTheDocument()
    expect(window.octopus.projects.remove).toHaveBeenCalledWith('planner')
  })

  it('shows the scripts of the project that is open, and re-reads them on a switch', async () => {
    givenTwoProjects()
    givenScriptsOf({ planner: { setup: '/tmp/planner/setup.sh', run: null, archive: null } })
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))
    await user.click(screen.getByRole('button', { name: 'Scripts' }))
    await user.click(await screen.findByText('anna'))
    expect(await screen.findByText('/tmp/planner/setup.sh')).toBeInTheDocument()

    await user.click(tab('LE'))
    await user.click(await screen.findByText('carol'))

    expect(await screen.findByText(/No build script yet/)).toBeInTheDocument()
    expect(window.octopus.projects.scriptPaths).toHaveBeenCalledWith('ledger')
  })

  // A script is written for the first time in the project settings, so the
  // paths are read again the moment that dialog closes.
  it('reads the scripts again after the project settings close', async () => {
    givenTwoProjects()
    let written = false
    vi.mocked(window.octopus.projects.scriptPaths).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        value: { setup: written ? '/tmp/planner/setup.sh' : null, run: null, archive: null }
      })
    )
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))
    await user.click(screen.getByRole('button', { name: 'Scripts' }))
    await user.click(await screen.findByText('anna'))
    const dialog = await openProjectSettings(user, 'PL')

    written = true
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))

    expect(await screen.findByText('/tmp/planner/setup.sh')).toBeInTheDocument()
  })

  it('opens the project settings from the missing-script hint', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))
    await user.click(screen.getByRole('button', { name: 'Scripts' }))
    await user.click(await screen.findByText('anna'))

    await user.click(
      await within(screen.getByRole('region', { name: 'Build' })).findByRole('button', {
        name: 'Write the script'
      })
    )

    expect(await screen.findByRole('dialog', { name: 'Project settings' })).toBeInTheDocument()
  })

  // A different section from the one beside it: the env is a file the scripts
  // read rather than another script, so the two buttons lead to two places.
  it('opens the env section from the build header', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))
    await user.click(screen.getByRole('button', { name: 'Scripts' }))
    await user.click(await screen.findByText('anna'))

    await user.click(
      await within(screen.getByRole('region', { name: 'Build' })).findByRole('button', {
        name: 'Edit files'
      })
    )

    const dialog = await screen.findByRole('dialog', { name: 'Project settings' })
    expect(within(dialog).getByRole('button', { name: 'Files' })).toHaveAttribute(
      'aria-current',
      'true'
    )
  })

  /*
   * A workspace can outlive its project on screen: the two lists are read
   * separately, so a refresh may drop the project while the workspace list the
   * pane is drawing from is still the previous one.
   *
   * The scripts belong to the open project, so a workspace of a project that is
   * no longer open is offered nothing at all — which is the stronger form of
   * the promise this used to make, that the hint must not open settings for a
   * project that has gone.
   */
  /*
   * A half-written prompt is not lost to going and looking at something. The
   * pane keeps one per workspace, which is the other half of the fix that stops
   * a sentence typed for one workspace being sent to another.
   */
  it('finds a draft where it was left when the workspace comes back', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))
    await user.click(await screen.findByText('anna'))

    await user.type(await screen.findByRole('textbox'), 'drop the old migration')
    await user.click(screen.getByText('bob'))
    expect(await screen.findByRole('textbox')).toHaveValue('')

    await user.click(screen.getByText('anna'))

    expect(await screen.findByRole('textbox')).toHaveValue('drop the old migration')
  })

  it('offers no script for a workspace whose project has gone', async () => {
    givenTwoProjects()
    vi.mocked(window.octopus.projects.listRemote).mockResolvedValue({
      ok: true,
      value: [LEDGER_REPOSITORY]
    })
    vi.mocked(window.octopus.projects.addFromGitHub).mockResolvedValue({ ok: true, value: LEDGER })
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))
    await user.click(screen.getByRole('button', { name: 'Scripts' }))
    await user.click(await screen.findByText('anna'))
    await within(screen.getByRole('region', { name: 'Build' })).findByRole('button', {
      name: 'Write the script'
    })

    // The next read of the projects has lost planner, while the workspace lists
    // stay out and the pane keeps the ones it already has.
    vi.mocked(window.octopus.projects.list).mockResolvedValue({ ok: true, value: [LEDGER] })
    vi.mocked(window.octopus.workspaces.list).mockReturnValue(new Promise(() => undefined))
    const picker = await openRepositoryPicker(user)
    await user.click(within(picker).getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(
        within(screen.getByRole('region', { name: 'Build' })).queryByRole('button', {
          name: 'Write the script'
        })
      ).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('dialog', { name: 'Project settings' })).not.toBeInTheDocument()
  })

  // Unreadable paths and absent scripts look the same from here: either way
  // there is nothing to run, and writing one is the way out.
  it('offers to write a script when the paths could not be read', async () => {
    givenTwoProjects()
    vi.mocked(window.octopus.projects.scriptPaths).mockResolvedValue({
      ok: false,
      error: 'git is not installed'
    })
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))
    await user.click(screen.getByRole('button', { name: 'Scripts' }))
    await user.click(await screen.findByText('anna'))

    expect(
      await within(screen.getByRole('region', { name: 'Build' })).findByRole('button', {
        name: 'Write the script'
      })
    ).toBeInTheDocument()
  })

  // Switching project starts a second read while the first is still out. The
  // slow one belongs to a project that is no longer open, so it must not land.
  it('ignores the scripts of a project left before they arrived', async () => {
    givenTwoProjects()
    const abandoned = pending<Result<Record<ScriptKind, string | null>>>()
    vi.mocked(window.octopus.projects.scriptPaths).mockImplementation((projectId: string) =>
      projectId === 'planner'
        ? abandoned.promise
        : Promise.resolve({ ok: true, value: { setup: null, run: null, archive: null } })
    )
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))
    await user.click(tab('LE'))
    await user.click(screen.getByRole('button', { name: 'Scripts' }))
    await user.click(await screen.findByText('carol'))

    await act(async () => {
      await abandoned.settle({
        ok: true,
        value: { setup: '/tmp/planner/setup.sh', run: null, archive: null }
      })
    })

    expect(screen.queryByText('/tmp/planner/setup.sh')).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Build' })).getByRole('button', {
        name: 'Write the script'
      })
    ).toBeInTheDocument()
  })

  it('opens another conversation with ⌘T', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(tab('PL'))
    await user.click(screen.getByRole('button', { name: /anna/ }))
    await screen.findByRole('navigation', { name: 'Conversations' })

    fireEvent.keyDown(window, { key: 't', metaKey: true })

    await waitFor(() => {
      expect(window.octopus.chats.create).toHaveBeenCalledWith('planner/anna')
    })
  })

  /*
   * Sent the way macOS actually sends it. Option rewrites the character —
   * Option-2 arrives as `™` — so a handler reading `event.key` cannot work, and
   * a test that sent a plain `2` would be green over one that does not.
   */
  it('switches conversation with ⌥2', async () => {
    vi.mocked(window.octopus.chats.list).mockResolvedValue({
      ok: true,
      value: [
        chat({ workspaceId: 'planner/anna' }),
        chat({ id: 'chat-2', workspaceId: 'planner/anna' })
      ]
    })
    givenTwoProjects()
    const user = await openApp()
    await user.click(tab('PL'))
    await user.click(screen.getByRole('button', { name: /anna/ }))
    await screen.findByRole('button', { name: /^Claude 2: / })

    fireEvent.keyDown(window, { key: '™', code: 'Digit2', altKey: true })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Claude 2: / })).toHaveAttribute(
        'aria-current',
        'page'
      )
    })
  })

  // The shortcut cannot do what the button no longer offers: three conversations
  // share a worktree, and past that the tabs stop being a way to work in
  // parallel and become a way to lose track of who changed what.
  it('does not open a fourth conversation with ⌘T', async () => {
    vi.mocked(window.octopus.chats.list).mockResolvedValue({
      ok: true,
      value: [
        chat({ workspaceId: 'planner/anna' }),
        chat({ id: 'chat-2', workspaceId: 'planner/anna' }),
        chat({ id: 'chat-3', workspaceId: 'planner/anna' })
      ]
    })
    givenTwoProjects()
    const user = await openApp()
    await user.click(tab('PL'))
    await user.click(screen.getByRole('button', { name: /anna/ }))
    await screen.findByRole('button', { name: /^Claude 3: / })

    fireEvent.keyDown(window, { key: 't', metaKey: true })

    expect(window.octopus.chats.create).not.toHaveBeenCalled()
  })

  // ⌥ with anything else on it: the window has no business claiming a
  // combination it does not answer.
  it('leaves other ⌥ combinations alone', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(tab('PL'))
    await user.click(screen.getByRole('button', { name: /anna/ }))
    await screen.findByRole('navigation', { name: 'Conversations' })

    fireEvent.keyDown(window, { key: 'å', code: 'KeyA', altKey: true })

    expect(window.octopus.chats.create).not.toHaveBeenCalled()
  })

  it('does nothing for a conversation that is not there', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(tab('PL'))
    await user.click(screen.getByRole('button', { name: /anna/ }))
    const strip = await screen.findByRole('navigation', { name: 'Conversations' })

    fireEvent.keyDown(window, { key: '£', code: 'Digit3', altKey: true })

    expect(strip).toBeInTheDocument()
  })

  it('opens the changes with ⌘⇧D', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(screen.getByRole('button', { name: 'Terminal' }))

    fireEvent.keyDown(window, { key: 'D', metaKey: true, shiftKey: true })

    expect(window.octopus.config.update).toHaveBeenLastCalledWith({ rightPanelTab: 'diff' })
  })

  // Listed in §10.8 since before there was a tab for it to name, which is the
  // shape of shortcut that teaches people to distrust the whole table.
  /*
   * The pull request tab edits the project's instruction by opening the place
   * it lives — one editor for one file, reached from the places it matters.
   */
  it('opens the project instructions from the pull request tab', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(await screen.findByRole('button', { name: 'PL' }))
    await user.click(screen.getByRole('button', { name: 'Pull request' }))
    await user.click(await screen.findByText('anna'))

    await user.click(await screen.findByRole('button', { name: 'Instructions for a new PR' }))

    expect(await screen.findByRole('dialog', { name: 'Project settings' })).toBeInTheDocument()
    expect(screen.getByDisplayValue(/Pull request descriptions/)).toBeInTheDocument()
  })

  it('opens the pull request with ⌘⇧P', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(screen.getByRole('button', { name: 'Terminal' }))

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true })

    expect(window.octopus.config.update).toHaveBeenLastCalledWith({
      rightPanelTab: 'pullRequest'
    })
  })

  /*
   * The pane is unmounted while it is folded away, so a tab kept inside it was
   * gone the moment it was hidden — which is half of why the value moved out.
   */
  it('keeps the chosen tab across folding the pane away', async () => {
    givenTwoProjects()
    // The pane reads the tab back from the config it is answered with, so a
    // stub that ignores the patch would fold a choice nobody ever made.
    vi.mocked(window.octopus.config.update).mockImplementation((patch) =>
      Promise.resolve({ ok: true, value: config(patch) })
    )
    const user = await openApp()
    await user.click(screen.getByRole('button', { name: 'Terminal' }))

    await user.click(screen.getByRole('button', { name: 'Collapse panel' }))
    await user.click(screen.getByRole('button', { name: 'Show panel' }))

    expect(await screen.findByRole('button', { name: 'Terminal' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  /*
   * The shortcut has to bring the pane back, or it does nothing in the one
   * place it would save the most — a folded pane is exactly when reaching the
   * changes by mouse costs two clicks rather than one.
   */
  it('unfolds the right pane to show the changes', async () => {
    givenTwoProjects()
    const user = await openApp()
    await user.click(screen.getByRole('button', { name: 'Collapse panel' }))
    expect(screen.queryByRole('button', { name: 'Changes' })).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'D', metaKey: true, shiftKey: true })

    expect(await screen.findByRole('button', { name: 'Changes' })).toBeInTheDocument()
  })

  // The sidebar renders its header only with a project, but the guard is what
  // keeps a shortcut from creating a workspace in nothing.
  it('creates no workspace while no project is selected', async () => {
    vi.mocked(window.octopus.projects.list).mockResolvedValue({ ok: true, value: [] })

    render(<App />)
    await screen.findByRole('button', { name: /settings|Налаштування/i })

    fireEvent.keyDown(window, { key: 'N', metaKey: true, shiftKey: true })

    expect(window.octopus.workspaces.create).not.toHaveBeenCalled()
  })
})
