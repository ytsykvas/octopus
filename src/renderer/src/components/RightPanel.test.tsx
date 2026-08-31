import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps, useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { stubDialogElement } from '../test/dialog.js'
import { octopus } from '../test/octopus.js'
import { openedDirectories, sessionId, sessionsOpened, stubTerminalHost } from '../test/terminal.js'
import { commentController, quoteController, revertController } from '../test/comments.js'
import { workspaceView } from '../test/workspaces.js'
import { RightPanel } from './RightPanel.js'

type Props = ComponentProps<typeof RightPanel>

const anna = workspaceView('anna')
const bob = workspaceView('bob', { port: 3222 })

const SCRIPTS = { setup: '/tmp/scripts/planner/setup.sh', run: '/tmp/scripts/planner/run.sh' }

/** Every listener hears every exit; a terminal keeps only its own. */
const exits: ((exit: { id: string; exitCode: number | null }) => void)[] = []

/** Ends the n-th session opened in this test, the way the main process would. */
function processExits(n: number, exitCode = 0): void {
  act(() => {
    for (const notify of exits) notify({ id: sessionId(n), exitCode })
  })
}

/**
 * The pane's ceiling is derived from the window, so a test that narrows the
 * window has to put it back — the next one reads its own ceiling on mount and
 * would otherwise inherit a window nobody in it asked for.
 */
const WINDOW_WIDTH = window.innerWidth

/**
 * A window wide enough that the ceiling is not what these tests measure.
 *
 * jsdom's own 1024 leaves the pane eight pixels of headroom once the left
 * column and the centre have their share, so a drag test there would be
 * asserting the clamp rather than the drag.
 */
const ROOMY = 1400

/** The project strip plus a workspace list at its default width. */
const LEFT_WIDTH = 296

/**
 * The pane, with something above it holding the tab.
 *
 * `App` owns that value now, so a test clicking a tab and expecting the pane
 * to follow has to play the parent — otherwise the click reports a choice
 * nobody acts on, and every such test would assert that nothing happened.
 */
function Tabbed(props: Props): React.JSX.Element {
  const [tab, setTab] = useState(props.tab)

  return (
    <RightPanel
      {...props}
      tab={tab}
      onTab={(next) => {
        props.onTab(next)
        setTab(next)
      }}
    />
  )
}

function renderPanel(overrides: Partial<Props> = {}): {
  props: Props
  rerender: (next: Partial<Props>) => void
} {
  const props: Props = {
    workspaces: [],
    activeWorkspaceId: null,
    color: null,
    projectId: 'planner',
    rootPath: '/Users/test/planner',
    scriptPaths: { setup: null, run: null },
    onEditScripts: vi.fn(),
    onEditFiles: vi.fn(),
    onEditEnv: vi.fn(),
    onEditInstructions: vi.fn(),
    chatId: null,
    width: 360,
    onWidthChange: vi.fn(),
    leftWidth: LEFT_WIDTH,
    diffView: 'unified',
    onDiffView: vi.fn(),
    tab: 'diff',
    onTab: vi.fn(),
    comments: commentController(),
    revert: revertController(),
    quotes: quoteController(),
    envFile: '.env',
    onRequestChanged: vi.fn(),
    onError: vi.fn(),
    ...overrides
  }

  const { rerender } = render(<Tabbed {...props} />)
  return {
    props,
    rerender: (next) => {
      rerender(<Tabbed {...props} {...next} />)
    }
  }
}

/**
 * The tab body on screen.
 *
 * The other three stay mounted — that is the whole point of them — so a query
 * for text rather than for a role finds all four. `aria-hidden` is what tells
 * them apart here, exactly as it does for a screen reader; the class that hides
 * them says nothing without a stylesheet, and jsdom has none.
 */
function shownTab(): HTMLElement {
  // A direct child: the build half now marks its own folded body the same way,
  // and a search through the whole pane would find that instead.
  const body = pane().querySelector<HTMLElement>(':scope > [aria-hidden="false"]')
  if (!body) throw new Error('No tab body is showing')

  return body
}

/** The pane itself: a `<section>`, which carries no role to reach it by. */
/** The one tab both scripts now live behind. */
const scriptsTab = (): HTMLElement => screen.getByRole('button', { name: 'Scripts' })

/**
 * One of the two halves of that tab.
 *
 * Both are on screen together, so every query about a run has to say which one
 * it means — `Run` alone matches twice, which is the point of the change.
 */
const buildSection = (): HTMLElement => screen.getByRole('region', { name: 'Build' })

/** The tab's own control, which is where all the pressing lives now. */
const runButton = (): HTMLElement => screen.getByRole('button', { name: 'Run' })

/** The build half's own heading, which is the control that folds it. */
const buildHeading = (): HTMLElement =>
  within(buildSection()).getByRole('button', { name: /the build/ })

/** What that control folds: everything under the heading. */
function buildBody(): HTMLElement {
  const body = buildSection().querySelector<HTMLElement>(':scope > [aria-hidden]')
  if (!body) throw new Error('the build half has no body')
  return body
}
const serverSection = (): HTMLElement => screen.getByRole('region', { name: 'Server' })

function pane(): HTMLElement {
  const section = screen.getByRole('button', { name: 'Changes' }).closest('section')
  if (!section) throw new Error('The pane is not in the document')

  return section
}

beforeAll(stubDialogElement)

describe('RightPanel', () => {
  beforeEach(() => {
    stubTerminalHost()
    window.innerWidth = ROOMY
    exits.length = 0
    vi.mocked(octopus().terminal.onExit).mockImplementation((handler) => {
      exits.push(handler)
      return vi.fn()
    })
  })

  afterEach(() => {
    window.innerWidth = WINDOW_WIDTH
  })

  // The pane identifies its project the way the tab strip, the sidebar and the
  // sent bubble do; the stylesheet turns the variable into the tab's fill.
  it('carries the colour of the project that is open', () => {
    renderPanel({ color: 'teal' })

    expect(pane()).toHaveStyle({ '--project-color': 'var(--project-teal)' })
  })

  it('follows the colour when another project is opened', () => {
    const { rerender } = renderPanel({ color: 'teal' })

    rerender({ color: 'amber' })

    expect(pane()).toHaveStyle({ '--project-color': 'var(--project-amber)' })
  })

  // Setting the variable to nothing would leave the tab with an invalid
  // colour-mix and no fill at all, so it has to stay unset instead.
  it('sets no colour before a project is chosen', () => {
    renderPanel()

    expect(pane().style.getPropertyValue('--project-color')).toBe('')
  })

  it('paints the chosen tab and no other', async () => {
    renderPanel()

    expect(screen.getByRole('button', { name: 'Changes' })).toHaveClass('tab-selected')

    await userEvent.click(screen.getByRole('button', { name: 'Terminal' }))

    expect(screen.getByRole('button', { name: 'Changes' })).not.toHaveClass('tab-selected')
    expect(screen.getByRole('button', { name: 'Terminal' })).toHaveClass('tab-selected')
  })

  /*
   * The pane's floor is measured from this row, and a button that can squash
   * reports the width it was squashed to — so the floor comes out under what
   * the labels need and the pane squashes them again. `Pull request` is where
   * it showed: the label broke across two lines inside a row 32px tall.
   *
   * jsdom does no layout, so the class is the only handle there is; it is also
   * the whole mechanism.
   */
  it('gives its tabs no room to wrap or squash', () => {
    renderPanel()

    for (const label of ['Changes', 'Terminal', 'Scripts', 'Pull request']) {
      expect(screen.getByRole('button', { name: label })).toHaveClass(
        'shrink-0',
        'whitespace-nowrap'
      )
    }
  })

  it('opens on the tab it was given rather than on the first one', () => {
    renderPanel({ tab: 'terminal' })

    expect(screen.getByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-current', 'page')
  })

  it('reports a chosen tab rather than keeping it', async () => {
    const { props } = renderPanel()

    await userEvent.click(scriptsTab())

    // Where it goes is what makes it outlive the pane being folded away, and
    // the restart after that.
    expect(props.onTab).toHaveBeenCalledWith('scripts')
  })

  it('offers all four tabs', () => {
    renderPanel()

    for (const label of ['Changes', 'Terminal', 'Scripts', 'Pull request']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('shows the pull request pane on its own tab', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id })

    await userEvent.click(screen.getByRole('button', { name: 'Pull request' }))

    expect(within(shownTab()).getByText(anna.branch)).toBeInTheDocument()
  })

  it('opens on the changes tab', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id })

    expect(screen.getByRole('button', { name: 'Changes' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByText(/Nothing has changed/)).toBeInTheDocument()
  })

  it('shows the terminal when its tab is chosen', async () => {
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'Terminal' }))

    expect(screen.getByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Changes' })).not.toHaveAttribute('aria-current')
    expect(screen.getByText(/Select a workspace to open a terminal/)).toBeInTheDocument()
  })

  // A review is built up over several turns, and unmounting the pane would
  // drop which files were collapsed and where it had been scrolled to.
  it('keeps the changes view mounted behind another tab', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id })
    expect(await screen.findByText(/Nothing has changed/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Terminal' }))

    expect(screen.getByText(/Nothing has changed/)).toBeInTheDocument()
  })

  it('opens a terminal in the active workspace on the terminal tab', async () => {
    renderPanel({ workspaces: [anna, bob], activeWorkspaceId: bob.id })

    await userEvent.click(screen.getByRole('button', { name: 'Terminal' }))

    await waitFor(() => {
      expect(openedDirectories()).toEqual(['/tmp/planner/bob'])
    })
  })

  it('shows the project build script on the build tab', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())

    expect(screen.getByText(SCRIPTS.setup)).toBeInTheDocument()
    // The half names the file it runs; the control that runs it is on the tab.
    expect(within(buildSection()).queryByRole('button', { name: 'Run' })).not.toBeInTheDocument()
  })

  it("shows the active workspace's port on the server tab", async () => {
    renderPanel({ workspaces: [anna, bob], activeWorkspaceId: bob.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())

    expect(screen.getByText('OCTOPUS_PORT=3222')).toBeInTheDocument()
  })

  /*
   * Reached without unfolding anything. The build starts folded, so if that
   * half were the only one offering the editor, a project with no scripts would
   * open on a tab that says nothing and leads nowhere — the server half is open
   * and offers the same way in.
   */
  it('sends the user to the script editor when the project has no script', async () => {
    const onEditScripts = vi.fn()
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, onEditScripts })

    await userEvent.click(scriptsTab())
    await userEvent.click(screen.getByRole('button', { name: 'Write the script' }))

    expect(onEditScripts).toHaveBeenCalled()
  })

  /*
   * The case the test above cannot reach, and the reason the header carries its
   * own way in: **Write the script** is the empty state, so it disappears at the
   * moment the file it offers to write starts existing. The tab then showed the
   * path to `setup.sh`, ran it, printed what it said — and led nowhere.
   */
  it('sends the user to the script editor when the project already has one', async () => {
    const onEditScripts = vi.fn()
    renderPanel({
      workspaces: [anna],
      activeWorkspaceId: anna.id,
      // Both halves, because the offer belongs to each: with only `setup.sh`
      // written, the server half still shows its own **Write the script**.
      scriptPaths: SCRIPTS,
      onEditScripts
    })

    await userEvent.click(scriptsTab())
    expect(screen.queryByRole('button', { name: 'Write the script' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: "Edit this project's scripts" }))

    expect(onEditScripts).toHaveBeenCalled()
  })

  /*
   * The state where the header is the only route there is. With no workspace
   * both halves say so and draw nothing else — no path, no **Write the
   * script** — while the scripts themselves belong to the project and are
   * perfectly editable.
   */
  it('reaches the editor from a project that has no workspace yet', async () => {
    const onEditScripts = vi.fn()
    renderPanel({ workspaces: [], activeWorkspaceId: null, onEditScripts })

    await userEvent.click(scriptsTab())
    expect(screen.queryByRole('button', { name: 'Write the script' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: "Edit this project's scripts" }))

    expect(onEditScripts).toHaveBeenCalled()
  })

  /*
   * A state the application reaches on its own: `openProjectId` is
   * `selectedProject?.id ?? null` (`App.tsx:430`) and the pane is open by
   * default, so a first launch with nothing selected renders exactly this.
   *
   * The callback resolves that same project, so with none there is nothing for
   * it to open. A control that answers a press with silence is worse than one
   * that says it cannot.
   */
  it('offers no way to the editor when no project is open', async () => {
    renderPanel({ projectId: null, workspaces: [anna], activeWorkspaceId: anna.id })

    await userEvent.click(scriptsTab())

    expect(screen.getByRole('button', { name: "Edit this project's scripts" })).toBeDisabled()
  })

  /*
   * Everything else in that row swaps as a server comes up — Run gives way to
   * Open localhost, Restart and Stop. This one must not move with them: a
   * button that lands somewhere else because something unrelated happened is
   * one people stop aiming at.
   *
   * So the run is actually driven here rather than asserted about at rest. A
   * version of this test that only looked at the idle row proved the editor was
   * first once, which is not the claim — the claim is that it stays first.
   */
  it('keeps the editor first among the controls as the run replaces them', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })
    await userEvent.click(scriptsTab())

    const row = screen.getByRole('button', { name: "Edit this project's scripts" }).parentElement
    if (!row) throw new Error('the header drew no row')

    const first = (): HTMLElement => {
      const [control] = within(row).getAllByRole('button')
      if (!control) throw new Error('the header drew no controls')
      return control
    }

    expect(first()).toHaveAccessibleName("Edit this project's scripts")
    expect(within(row).getByRole('button', { name: 'Run' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Run' }))
    await sessionsOpened(1)
    processExits(1)
    await sessionsOpened(2)

    // The row has genuinely turned over — Run is gone and Stop is in its place.
    expect(within(row).queryByRole('button', { name: 'Run' })).not.toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Stop' })).toBeInTheDocument()
    expect(first()).toHaveAccessibleName("Edit this project's scripts")
  })

  /*
   * The whole point of the tab in one control.
   *
   * The first thing anybody does with a new workspace is these two steps in
   * this order, and the second only makes sense after the first — so the test
   * follows the same order: build, exit zero, then a server.
   */
  it('builds and then serves on one press of Run', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))

    await sessionsOpened(1)
    expect(openedDirectories()).toEqual([anna.path])

    processExits(1)

    await sessionsOpened(2)
    expect(octopus().terminal.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ command: [SCRIPTS.run] })
    )
  })

  // A server that ends has been stopped, or has crashed in a way its own output
  // describes far better than the row above it could. Either way the sequence
  // is over and the button goes back to offering the whole of it again.
  it('settles once the server ends', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))
    await sessionsOpened(1)
    processExits(1)
    await sessionsOpened(2)

    expect(screen.getByText('Serving.')).toBeInTheDocument()

    processExits(2)

    expect(await screen.findByText(/Builds this workspace/)).toBeInTheDocument()
  })

  // A server started on top of a broken build fails in a way that points at the
  // server rather than at the build that actually broke.
  it('does not serve when the build fails, and says why', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))
    await sessionsOpened(1)

    processExits(1, 1)

    expect(await screen.findByText(/The build failed/)).toBeInTheDocument()
    expect(octopus().terminal.create).toHaveBeenCalledTimes(1)
  })

  // §4: no step is mandatory. Waiting for a build nobody wrote would hang on a
  // half showing an invitation to write one rather than a runner that answers.
  it('goes straight to the server when the project has no build script', async () => {
    renderPanel({
      workspaces: [anna],
      activeWorkspaceId: anna.id,
      scriptPaths: { setup: null, run: SCRIPTS.run }
    })

    await userEvent.click(scriptsTab())
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))

    await sessionsOpened(1)
    expect(octopus().terminal.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ command: [SCRIPTS.run] })
    )
  })

  // Nothing to run: the server half already carries the invitation to write it,
  // and a Run that did half the job would be worse than one that waits.
  it('offers no Run while the server script is missing', async () => {
    renderPanel({
      workspaces: [anna],
      activeWorkspaceId: anna.id,
      scriptPaths: { setup: SCRIPTS.setup, run: null }
    })

    await userEvent.click(scriptsTab())

    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  })

  it('offers no Run before a workspace is chosen', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: null, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())

    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  })

  // A sequence belongs to the workspace it was started in, exactly as the run
  // does — the two halves keep a runner each per workspace for the same reason.
  it('reports the build as running only in the workspace it was started in', async () => {
    const { rerender } = renderPanel({
      workspaces: [anna, bob],
      activeWorkspaceId: anna.id,
      scriptPaths: SCRIPTS
    })

    await userEvent.click(scriptsTab())
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))
    await sessionsOpened(1)

    expect(screen.getByRole('button', { name: 'Building…' })).toBeInTheDocument()

    rerender({ activeWorkspaceId: bob.id })

    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled()
  })

  // Neither half carries a control any more: four buttons in two places, two of
  // them called the same thing, is what this replaced.
  it('leaves the halves with nothing to press', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())

    // The fold and the env editor stay; what left is everything that starts,
    // restarts or stops a script.
    for (const name of ['Build', 'Rebuild', 'Start', 'Restart', 'Stop']) {
      expect(within(buildSection()).queryByRole('button', { name })).not.toBeInTheDocument()
      expect(within(serverSection()).queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  // What Run offers has already happened. Rebuilding from here is Stop and then
  // Run — which is also the order that frees the port before anything binds it.
  it('drops Run once the server is up', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(runButton())
    await sessionsOpened(1)
    processExits(1)
    await sessionsOpened(2)

    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })

  it('offers Run again once the server has been stopped', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(runButton())
    await sessionsOpened(1)
    processExits(1)
    await sessionsOpened(2)

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(runButton()).toBeEnabled()
  })

  /*
   * The port is the promise the pane has been making all along.
   *
   * A link rather than a button: `setWindowOpenHandler` in main already gives a
   * `_blank` target to the system browser, so this needs no channel — and a
   * link is what a reader expects to be able to copy.
   */
  it('offers the running server in the browser, on its own port', async () => {
    // Nothing had taken it, so the run stays where the workspace was recorded.
    vi.mocked(octopus().workspaces.port).mockResolvedValue({ ok: true, value: bob.port })
    renderPanel({ workspaces: [bob], activeWorkspaceId: bob.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(runButton())
    await sessionsOpened(1)
    processExits(1)
    await sessionsOpened(2)

    const link = screen.getByRole('link', { name: 'Open localhost:3222' })
    expect(link).toHaveAttribute('href', 'http://localhost:3222')
    expect(link).toHaveAttribute('target', '_blank')
  })

  /*
   * The workspaces list carries the port as it was last written to disk, and
   * nothing refreshes it after a run settles on another block — so the link
   * pointed at the port the run had just moved away from.
   */
  it('follows the port a run had to move to', async () => {
    vi.mocked(octopus().workspaces.port).mockResolvedValue({ ok: true, value: 3190 })
    renderPanel({ workspaces: [bob], activeWorkspaceId: bob.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(runButton())
    await sessionsOpened(1)
    processExits(1)
    await sessionsOpened(2)

    expect(screen.getByRole('link', { name: 'Open localhost:3190' })).toHaveAttribute(
      'href',
      'http://localhost:3190'
    )
  })

  it('offers no link while nothing is serving', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  /*
   * A workspace whose directory has gone takes its run with it: `WorkspaceScripts`
   * drops it, the runner unmounts, and the session is disposed. Leaving the
   * controls up would offer a link to a refused port and a Restart that bumps a
   * token no runner is mounted to hear.
   */
  it('takes the controls away when the workspace goes missing', async () => {
    const { rerender } = renderPanel({
      workspaces: [anna],
      activeWorkspaceId: anna.id,
      scriptPaths: SCRIPTS
    })

    await userEvent.click(scriptsTab())
    await userEvent.click(runButton())
    await sessionsOpened(1)
    processExits(1)
    await sessionsOpened(2)

    rerender({ workspaces: [{ ...anna, missing: true }] })

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  })

  it('refuses to run a workspace whose directory has gone', async () => {
    renderPanel({
      workspaces: [{ ...anna, missing: true }],
      activeWorkspaceId: anna.id,
      scriptPaths: SCRIPTS
    })

    await userEvent.click(scriptsTab())

    expect(runButton()).toBeDisabled()
  })

  // The build is the step that takes the time; a second press while it runs
  // would start it over rather than do anything anyone meant.
  it('refuses a second Run while the build is going', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(runButton())
    await sessionsOpened(1)

    const button = screen.getByRole('button', { name: 'Building…' })
    expect(button).toBeDisabled()

    await userEvent.click(button)
    expect(octopus().terminal.create).toHaveBeenCalledTimes(1)
  })

  /*
   * The build's log is what a reader is looking at when the sequence has
   * finished. Stopping the server must not take it away — `started` exists to
   * keep output on screen past the process that produced it.
   */
  it('leaves the finished build on screen when the server is stopped', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(runButton())
    await sessionsOpened(1)
    processExits(1)
    await sessionsOpened(2)

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))

    // The build's idle hint would be back if its terminal had been unmounted.
    expect(
      within(buildSection()).queryByText(/Runs setup.sh in this workspace/)
    ).not.toBeInTheDocument()
    // Only the server's session was ended.
    expect(octopus().terminal.dispose).toHaveBeenCalledWith(sessionId(2))
    expect(octopus().terminal.dispose).not.toHaveBeenCalledWith(sessionId(1))
  })

  /*
   * octopus assigns the port, hands it over as `$OCTOPUS_PORT` and links to it —
   * and a script is free to ignore all of that. `rails s` binds 3000 whatever it
   * was told, so the link opens on nothing and the pane is what looks broken.
   */
  it('says when nothing is listening on the port it handed out', async () => {
    vi.mocked(octopus().workspaces.serving).mockResolvedValue({ ok: true, value: false })
    vi.mocked(octopus().workspaces.port).mockResolvedValue({ ok: true, value: bob.port })

    /* Five attempts a second apart, so the pane never calls a slow boot a
       mistake. Driven rather than waited for — and installed before the run
       starts, since a timer scheduled on the real clock is not one these can
       advance. `shouldAdvanceTime` keeps `userEvent` working meanwhile. */
    vi.useFakeTimers({ shouldAdvanceTime: true })

    try {
      renderPanel({ workspaces: [bob], activeWorkspaceId: bob.id, scriptPaths: SCRIPTS })

      await userEvent.click(scriptsTab())
      await userEvent.click(runButton())
      await sessionsOpened(1)
      processExits(1)
      await sessionsOpened(2)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000)
      })
    } finally {
      vi.useRealTimers()
    }

    expect(screen.getByText(/nothing is listening on 3222/)).toBeInTheDocument()
    // Said rather than enforced: the link and the controls stay.
    expect(screen.getByRole('link', { name: 'Open localhost:3222' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })

  it('says nothing while the port answers', async () => {
    renderPanel({ workspaces: [bob], activeWorkspaceId: bob.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(runButton())
    await sessionsOpened(1)
    processExits(1)
    await sessionsOpened(2)

    expect(await screen.findByText('Serving.')).toBeInTheDocument()
    expect(screen.queryByText(/nothing is listening/)).not.toBeInTheDocument()
  })

  // A port nothing was told to bind is not a port anybody is waiting on.
  it('does not ask about a port while nothing is serving', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())

    expect(octopus().workspaces.serving).not.toHaveBeenCalled()
  })

  // Nothing to restart and nothing to stop until something is serving. A
  // control for a server that is not up is a control that cannot mean anything.
  it('offers only Run while nothing is running', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())

    expect(runButton()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  })

  // A build is not a server: it ends on its own, and until it does there is
  // nothing to restart either.
  it('offers neither while only the build is going', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(runButton())
    await sessionsOpened(1)

    expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  })

  // The server ended on its own — crashed, or was killed from outside. The
  // controls have to go with it, or they promise something that is not there.
  it('takes them away again when the server ends by itself', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(runButton())
    await sessionsOpened(1)
    processExits(1)
    await sessionsOpened(2)

    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()

    processExits(2)

    expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  })

  // Stopping ends whatever is going, and the sequence settles back to offering
  // the whole of itself again.
  it('stops a running server from the header', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(runButton())
    await sessionsOpened(1)
    processExits(1)
    await sessionsOpened(2)

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))

    await waitFor(() => {
      expect(octopus().terminal.dispose).toHaveBeenCalledWith(sessionId(2))
    })
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  })

  // The code changed under a running server and needs picking up, while the
  // checkout did not — no reason to build again for that.
  it('restarts the server without building again', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(runButton())
    await sessionsOpened(1)
    processExits(1)
    await sessionsOpened(2)

    await userEvent.click(screen.getByRole('button', { name: 'Restart' }))

    await sessionsOpened(3)
    // The third session is the server again, not another build.
    expect(octopus().terminal.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ command: [SCRIPTS.run] })
    )
  })

  // Always on the header, not only in the empty state: the moment an env turns
  // out to be missing is a build that could not find it, and by then the empty
  // state that used to carry this button is long gone.
  it('offers the carried files from the build header once a script exists', async () => {
    const onEditFiles = vi.fn()
    renderPanel({
      workspaces: [anna],
      activeWorkspaceId: anna.id,
      scriptPaths: SCRIPTS,
      onEditFiles
    })

    await userEvent.click(scriptsTab())
    await userEvent.click(within(buildSection()).getByRole('button', { name: 'Env' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Files carried in…' }))

    expect(onEditFiles).toHaveBeenCalled()
  })

  /*
   * Three answers, genuinely different: the variables are typed, the files are
   * copied, and the third is not an edit at all. One button could only ever
   * reach one of them — for a project cloned from GitHub, reliably the wrong
   * one, since nothing gitignored was ever on GitHub to copy.
   */
  it('offers the variables from the same menu', async () => {
    const onEditEnv = vi.fn()
    renderPanel({
      workspaces: [anna],
      activeWorkspaceId: anna.id,
      scriptPaths: SCRIPTS,
      onEditEnv
    })

    await userEvent.click(scriptsTab())
    await userEvent.click(within(buildSection()).getByRole('button', { name: 'Env' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Variables…' }))

    expect(onEditEnv).toHaveBeenCalled()
  })

  // The file the scripts will actually read, carried lines and hand edits
  // included — which no preview assembled from the block would show.
  it('shows the workspace\u2019s own env file', async () => {
    vi.mocked(octopus().workspaces.env).mockResolvedValue({
      ok: true,
      value: 'MYSQL_HOST=dev.example\n'
    })
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(within(buildSection()).getByRole('button', { name: 'Env' }))
    await userEvent.click(screen.getByRole('menuitem', { name: "This workspace's env" }))

    expect(await screen.findByText(/MYSQL_HOST=dev.example/)).toBeInTheDocument()
    expect(octopus().workspaces.env).toHaveBeenCalledWith(anna.id)
  })

  it('puts the env away again', async () => {
    vi.mocked(octopus().workspaces.env).mockResolvedValue({ ok: true, value: 'A=1\n' })
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(within(buildSection()).getByRole('button', { name: 'Env' }))
    await userEvent.click(screen.getByRole('menuitem', { name: "This workspace's env" }))
    await screen.findByText(/A=1/)

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByText(/A=1/)).toBeNull()
  })

  // The dialog belongs to the workspace it was opened from; carrying it to the
  // next one would show that one's file under this one's name.
  it('closes the env when the workspace changes', async () => {
    vi.mocked(octopus().workspaces.env).mockResolvedValue({ ok: true, value: 'A=1\n' })
    const { rerender } = renderPanel({
      workspaces: [anna, bob],
      activeWorkspaceId: anna.id,
      scriptPaths: SCRIPTS
    })

    await userEvent.click(scriptsTab())
    await userEvent.click(within(buildSection()).getByRole('button', { name: 'Env' }))
    await userEvent.click(screen.getByRole('menuitem', { name: "This workspace's env" }))
    await screen.findByText(/A=1/)

    rerender({ activeWorkspaceId: bob.id })

    expect(screen.queryByText(/A=1/)).toBeNull()
  })

  // Nothing to show, so the item cannot be chosen — setting the flag anyway
  // armed a dialog that sprang open by itself on the next workspace picked.
  it('offers no env to show with no workspace selected', async () => {
    renderPanel({ workspaces: [], activeWorkspaceId: null, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(within(buildSection()).getByRole('button', { name: 'Env' }))

    expect(screen.getByRole('menuitem', { name: "This workspace's env" })).toBeDisabled()
  })

  it('says so where the workspace has no env file at all', async () => {
    vi.mocked(octopus().workspaces.env).mockResolvedValue({ ok: true, value: null })
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(within(buildSection()).getByRole('button', { name: 'Env' }))
    await userEvent.click(screen.getByRole('menuitem', { name: "This workspace's env" }))

    expect(await screen.findByText(/no env file yet/)).toBeInTheDocument()
  })

  // A file that could not be read is not an empty one, and an empty box would
  // say it was.
  it('says the same when the file could not be read', async () => {
    vi.mocked(octopus().workspaces.env).mockResolvedValue({ ok: false, error: 'EACCES' })
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(within(buildSection()).getByRole('button', { name: 'Env' }))
    await userEvent.click(screen.getByRole('menuitem', { name: "This workspace's env" }))

    expect(await screen.findByText(/no env file yet/)).toBeInTheDocument()
  })

  // A sibling of the fold toggle rather than a child of it: reaching for the
  // env must not put the build away.
  /*
   * The env button is a sibling of the toggle rather than a child of it, so
   * reaching for it cannot fold the build — or unfold it — by accident.
   */
  it('leaves the build as it was when the env button is used', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())
    await userEvent.click(within(buildSection()).getByRole('button', { name: 'Show the build' }))
    await userEvent.click(within(buildSection()).getByRole('button', { name: 'Env' }))

    expect(
      within(buildSection()).getByRole('button', { name: 'Fold the build away' })
    ).toHaveAttribute('aria-expanded', 'true')
  })

  /*
   * A run belongs to the workspace it was started in: carrying its output to
   * the next one would describe work that never happened there.
   *
   * That used to be kept by ending the run — which is how one click on the list
   * killed a dev server. The promise is the same; only the price has gone.
   */
  it('shows the next workspace its own run rather than the last one’s', async () => {
    const { rerender } = renderPanel({
      workspaces: [anna, bob],
      activeWorkspaceId: anna.id,
      scriptPaths: SCRIPTS
    })

    await userEvent.click(scriptsTab())
    await userEvent.click(runButton())
    await waitFor(() => {
      expect(octopus().terminal.create).toHaveBeenCalledTimes(1)
    })

    rerender({ activeWorkspaceId: bob.id })

    // Nothing has been started here, so the header offers the whole run —
    // while the one left behind is still going.
    expect(runButton()).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
    expect(octopus().terminal.dispose).not.toHaveBeenCalled()
  })

  // The control moved to the window header: the button that folds the pane
  // away is the one that brings it back, and the second could not live inside
  // a pane that is no longer on screen.
  it('carries no control of its own for folding away', () => {
    renderPanel()

    expect(screen.queryByRole('button', { name: 'Collapse panel' })).not.toBeInTheDocument()
  })

  // The pane does not shrink, so a tab row wider than it pushed the whole
  // window out and put a horizontal scrollbar under the application. The floor
  // is measured because the labels change width with the language — a number
  // picked against English left the Ukrainian ones overflowing.
  it('will not narrow past the width its tabs need', async () => {
    // jsdom lays nothing out, so the buttons are given a width to be measured.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 90,
      height: 28,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })

    renderPanel({ width: 280 })

    await waitFor(() => {
      // Four buttons of 90, and jsdom reports padding and gaps as zero — so the
      // floor is exactly 360. Asserting the number rather than "more than
      // before" is what would catch the measurement itself going wrong.
      expect(screen.getByRole('separator')).toHaveAttribute('aria-valuemin', '360')
    })
  })

  // The pane follows the cursor throughout, but the width worth keeping is
  // reported once — on release. Persisting each intermediate pixel would be a
  // disk write per mouse move.
  it('reports the width when the drag ends, not while it lasts', () => {
    const { props } = renderPanel({ width: 360 })
    const edge = screen.getByRole('separator')

    fireEvent.pointerDown(edge, { clientX: 500 })
    fireEvent.pointerMove(window, { clientX: 480 })

    // Dragging the right pane's edge leftwards makes it wider.
    expect(edge).toHaveAttribute('aria-valuenow', '380')
    expect(props.onWidthChange).not.toHaveBeenCalled()

    fireEvent.pointerUp(window)

    expect(props.onWidthChange).toHaveBeenCalledExactlyOnceWith(380)
  })

  // The same edge from the keyboard, for anyone not holding a mouse.
  it('reports a new width once the edge has been nudged', async () => {
    const { props } = renderPanel({ width: 360 })

    screen.getByRole('separator').focus()
    await userEvent.keyboard('{ArrowLeft}')

    expect(props.onWidthChange).toHaveBeenCalledExactlyOnceWith(376)
  })

  // A window narrowed after the pane was sized must not leave the pane covering
  // the centre: the ceiling follows the window rather than being read once.
  it('lowers the ceiling as the window narrows, never below the floor', () => {
    renderPanel({ width: 360 })
    const edge = screen.getByRole('separator')

    window.innerWidth = 700
    fireEvent.resize(window)

    // 700 has no room for the left column, a usable centre and this pane, so
    // the floor is what is left — the ceiling stops there rather than below it.
    expect(edge).toHaveAttribute('aria-valuemax', '280')
  })

  /*
   * The room reserved for the rest of the window used to be the constant 256,
   * and the 360 of centre it claimed to keep was fiction: the left column is a
   * project strip plus a list that is resizable between 180 and 560 and folds
   * away entirely. Dragged wide, it left the centre nothing at all.
   */
  it('reserves the room the left column actually takes', () => {
    renderPanel({ leftWidth: 616 })

    // 1400 less a list dragged to its widest, less the centre's own 360.
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuemax', '424')
  })

  // Folded away, the list takes none of the window — and the pane may have the
  // room it was holding.
  it('offers the folded list’s room to the pane', () => {
    renderPanel({ leftWidth: 56 })

    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuemax', '984')
  })

  /*
   * The window's edge moves this pane's edge, not the centre's.
   *
   * The centre is the pane with no width of its own, so it used to absorb every
   * pixel the window gained or lost — and the conversation stops widening at
   * 72rem, so what it absorbed was margin, while the diff and the terminal
   * stayed as narrow as they started.
   */
  it('takes the room a widened window adds, so the centre keeps the width it had', () => {
    renderPanel({ width: 360 })

    window.innerWidth = 1600
    fireEvent.resize(window)

    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '560')
  })

  it('gives up its own width before the centre when the window narrows', () => {
    renderPanel({ width: 360 })

    window.innerWidth = 1340
    fireEvent.resize(window)

    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '300')
  })

  /*
   * Where the centre finally starts to lose room. The pane cannot go below what
   * its tabs need or they overflow it and push the whole window wider.
   *
   * jsdom lays nothing out, so the centre's share is not observable from here.
   * What is, is that the pane refuses to shrink any further — and `main` is the
   * only flexible child of the layout row in `App`, so every pixel this pane
   * keeps is a pixel the centre gives up. Nothing in jsdom would notice if
   * somebody broke that invariant; the aria value would keep reporting a width
   * the layout no longer used.
   */
  it('stops at the width its tabs need and leaves the rest to the centre', () => {
    renderPanel({ width: 360 })
    const edge = screen.getByRole('separator')

    window.innerWidth = 1200
    fireEvent.resize(window)

    expect(edge).toHaveAttribute('aria-valuenow', '280')
    expect(edge).toHaveAttribute('aria-valuemin', '280')
  })

  // Measured from the window rather than accumulated, so the two subtractions
  // cancel and nothing has to remember the journey — including the stretch
  // spent pinned against the floor.
  it('comes back to the width it had when the window comes back to its own', () => {
    renderPanel({ width: 360 })
    const edge = screen.getByRole('separator')

    window.innerWidth = 1000
    fireEvent.resize(window)
    window.innerWidth = 1400
    fireEvent.resize(window)

    expect(edge).toHaveAttribute('aria-valuenow', '360')
  })

  // The config answers over IPC a frame or two after the release. Falling back
  // to the pre-drag width in the meantime makes the edge visibly bounce, and
  // would count the window's pixels against the dragged width a second time.
  it('stays on the width a drag ended at while the config is still answering', async () => {
    const { rerender } = renderPanel({ width: 360 })
    const edge = screen.getByRole('separator')

    edge.focus()
    await userEvent.keyboard('{ArrowLeft}')

    expect(edge).toHaveAttribute('aria-valuenow', '376')

    rerender({ width: 376 })
    expect(edge).toHaveAttribute('aria-valuenow', '376')
  })

  /*
   * A save that fails never sends a new width down, so the pane stays where it
   * was dragged while the config keeps the old one. Deliberate: `App` puts a
   * banner up saying the setting could not be saved, and an edge that also
   * sprang back under the cursor would be saying it twice and less clearly.
   */
  it('stays where it was dragged when the width could not be saved', async () => {
    const { rerender } = renderPanel({ width: 360 })
    const edge = screen.getByRole('separator')

    edge.focus()
    await userEvent.keyboard('{ArrowLeft}')

    // The config answers with the width it still holds — which is to say, it
    // sends nothing new at all.
    rerender({ width: 360 })

    expect(edge).toHaveAttribute('aria-valuenow', '376')
  })

  // The pane opens on the schema's fallback and settles on the stored width the
  // moment the file has been read.
  it('settles on the stored width once the config has been read', () => {
    const { rerender } = renderPanel({ width: 360 })

    rerender({ width: 520 })

    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '520')
  })

  // Clamped on the way out, so a width saved on a wide display survives a move
  // to a small one rather than being written down smaller.
  it('shows only what the window has room for when the stored width is wider', () => {
    renderPanel({ width: 900 })

    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '744')
  })

  it('has nothing to run on the build tab while no workspace is active', async () => {
    renderPanel({ workspaces: [anna], activeWorkspaceId: null, scriptPaths: SCRIPTS })

    await userEvent.click(scriptsTab())

    // Said in both halves, since neither has a workspace to run in.
    expect(
      within(buildSection()).getByText('Select a workspace to run this in.')
    ).toBeInTheDocument()
    expect(
      within(serverSection()).getByText('Select a workspace to run this in.')
    ).toBeInTheDocument()
    expect(within(buildSection()).queryByRole('button', { name: 'Build' })).not.toBeInTheDocument()
  })

  // A session belongs to its workspace, not to whether its tab is on screen.
  // Looking at the diff used to kill every terminal in the project.
  it('leaves the workspace terminals running while another tab is shown', async () => {
    const user = userEvent.setup()
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id })

    await user.click(screen.getByRole('button', { name: 'Terminal' }))
    await waitFor(() => {
      expect(window.octopus.terminal.create).toHaveBeenCalledTimes(1)
    })

    await user.click(screen.getByRole('button', { name: 'Changes' }))
    expect(window.octopus.terminal.dispose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Terminal' }))
    expect(window.octopus.terminal.create).toHaveBeenCalledTimes(1)
  })

  /*
   * A dev server exists to be running while you look at something else, and
   * the diff is the likeliest reason to look away. Unmounting is how the Stop
   * button ends a run, so leaving the tab pressed Stop without saying so — and
   * a `setup.sh` caught half way through leaves a half-populated
   * `node_modules` behind it.
   */
  it('leaves a running script alive while another tab is shown', async () => {
    const user = userEvent.setup()
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await user.click(scriptsTab())
    await user.click(runButton())
    await waitFor(() => {
      expect(window.octopus.terminal.create).toHaveBeenCalledTimes(1)
    })

    await user.click(screen.getByRole('button', { name: 'Changes' }))
    expect(window.octopus.terminal.dispose).not.toHaveBeenCalled()

    await user.click(scriptsTab())
    expect(window.octopus.terminal.create).toHaveBeenCalledTimes(1)
  })

  /*
   * The reason `run.sh` is handed a port at all.
   *
   * A workspace serves while you work in another one, or the port is unique
   * for nothing. Unmounting is how a run ends, so a key that changed with the
   * selection ended it — the same bug as the tab switch, reached by a click on
   * the list instead.
   */
  it('leaves a running script alive when another workspace is opened', async () => {
    const user = userEvent.setup()
    const { rerender } = renderPanel({
      workspaces: [anna, bob],
      activeWorkspaceId: anna.id,
      scriptPaths: SCRIPTS
    })

    await user.click(scriptsTab())
    await user.click(runButton())
    await waitFor(() => {
      expect(openedDirectories()).toEqual(['/tmp/planner/anna'])
    })

    rerender({ activeWorkspaceId: bob.id })

    expect(window.octopus.terminal.dispose).not.toHaveBeenCalled()
  })

  it('lets two workspaces serve at once', async () => {
    const user = userEvent.setup()
    const { rerender } = renderPanel({
      workspaces: [anna, bob],
      activeWorkspaceId: anna.id,
      scriptPaths: SCRIPTS
    })

    await user.click(scriptsTab())
    await user.click(runButton())
    await waitFor(() => {
      expect(openedDirectories()).toHaveLength(1)
    })

    rerender({ activeWorkspaceId: bob.id })
    await user.click(runButton())

    await waitFor(() => {
      expect(openedDirectories()).toEqual(['/tmp/planner/anna', '/tmp/planner/bob'])
    })
    expect(window.octopus.terminal.dispose).not.toHaveBeenCalled()
  })

  // The reason each workspace gets a port of its own, and the reason a runner
  // per workspace is worth keeping mounted: two servers at once are two ports.
  it('runs each workspace’s server on its own port', async () => {
    const user = userEvent.setup()
    const { rerender } = renderPanel({
      workspaces: [anna, bob],
      activeWorkspaceId: anna.id,
      scriptPaths: SCRIPTS
    })

    await user.click(scriptsTab())
    expect(screen.getByText(`OCTOPUS_PORT=${String(anna.port)}`)).toBeInTheDocument()

    rerender({ activeWorkspaceId: bob.id })

    expect(screen.getByText(`OCTOPUS_PORT=${String(bob.port)}`)).toBeInTheDocument()
    expect(anna.port).not.toBe(bob.port)
  })

  // Its directory is gone, so the script has nowhere left to be — the rule the
  // terminals already follow.
  it('ends the run of a workspace that has been removed', async () => {
    const user = userEvent.setup()
    const { rerender } = renderPanel({
      workspaces: [anna, bob],
      activeWorkspaceId: anna.id,
      scriptPaths: SCRIPTS
    })

    await user.click(scriptsTab())
    await user.click(runButton())
    await waitFor(() => {
      expect(openedDirectories()).toHaveLength(1)
    })

    rerender({ workspaces: [bob], activeWorkspaceId: bob.id })

    expect(window.octopus.terminal.dispose).toHaveBeenCalledWith(sessionId(1))
  })

  // The two script tabs are separate runs, so the one being watched must be
  // the one whose output is on screen.
  /*
   * Folded to start with, every time. What a build prints is the same hundred
   * lines on every run and is worth reading on the one that fails — which the
   * header says in a colour without the log being open — so unfolded by default
   * it took half the tab from the server log nobody folds away.
   */
  it('starts with the build folded away', async () => {
    const user = userEvent.setup()
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await user.click(scriptsTab())

    expect(buildHeading()).toHaveAttribute('aria-expanded', 'false')
    // Hidden rather than gone — the class says nothing without a stylesheet,
    // and jsdom has none, so this is what "folded" looks like from here.
    expect(buildBody()).toHaveAttribute('aria-hidden', 'true')
  })

  it('brings the build back and folds it away again', async () => {
    const user = userEvent.setup()
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await user.click(scriptsTab())
    // Named for what pressing it does, which is the opposite in each state —
    // a label that stayed put would leave the control describing the wrong one.
    expect(buildHeading()).toHaveAccessibleName('Show the build')

    await user.click(buildHeading())

    expect(buildHeading()).toHaveAttribute('aria-expanded', 'true')
    expect(buildHeading()).toHaveAccessibleName('Fold the build away')
    expect(buildBody()).toHaveAttribute('aria-hidden', 'false')

    await user.click(buildHeading())

    expect(buildHeading()).toHaveAttribute('aria-expanded', 'false')
    expect(buildBody()).toHaveAttribute('aria-hidden', 'true')
  })

  /*
   * The whole reason the fold is a class and not a conditional render.
   * Unmounting the terminal is how Stop ends a run, so a fold that removed it
   * would kill a `setup.sh` half way through and say nothing — the same
   * mistake leaving the tab used to make.
   */
  it('leaves a running build alive while it is folded away', async () => {
    const user = userEvent.setup()
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await user.click(scriptsTab())
    await user.click(runButton())
    await waitFor(() => {
      expect(octopus().terminal.create).toHaveBeenCalledTimes(1)
    })

    await user.click(buildHeading())
    expect(octopus().terminal.dispose).not.toHaveBeenCalled()

    // Unfolded, the run is still the one that was started — a fold that had
    // ended it would have opened a second session on the way back.
    await user.click(buildHeading())
    expect(octopus().terminal.create).toHaveBeenCalledTimes(1)
    expect(octopus().terminal.dispose).not.toHaveBeenCalled()
  })

  // A server runs for as long as the work does, so there is nothing to fold it
  // out of the way for — and a control that folds away the thing being watched
  // is one nobody asked for.
  it('gives the server half nothing to fold', async () => {
    const user = userEvent.setup()
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await user.click(scriptsTab())

    expect(
      within(serverSection()).queryByRole('button', { name: 'Server' })
    ).not.toBeInTheDocument()
  })

  /*
   * They were two tabs and are now two halves of one, which is exactly the
   * arrangement that could quietly merge them: one `WorkspaceScripts` drawn
   * twice, or one run showing in both places.
   */
  // Two halves, two runs: the build's output stays the build's, and the server
  // starting does not take the pane the build was read in.
  it('keeps the two scripts apart inside the one tab', async () => {
    const user = userEvent.setup()
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, scriptPaths: SCRIPTS })

    await user.click(scriptsTab())
    await user.click(runButton())
    await sessionsOpened(1)
    processExits(1)
    await sessionsOpened(2)

    // One session each, in the order the sequence asked for them.
    expect(openedDirectories()).toEqual([anna.path, anna.path])
    expect(vi.mocked(octopus().terminal.create).mock.calls.map(([spec]) => spec.command)).toEqual([
      [SCRIPTS.setup],
      [SCRIPTS.run]
    ])
  })
})
