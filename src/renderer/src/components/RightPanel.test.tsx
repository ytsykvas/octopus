import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { octopus } from '../test/octopus.js'
import { openedDirectories, sessionId, stubTerminalHost } from '../test/terminal.js'
import { commentController } from '../test/comments.js'
import { workspaceView } from '../test/workspaces.js'
import { RightPanel } from './RightPanel.js'

type Props = ComponentProps<typeof RightPanel>

const anna = workspaceView('anna')
const bob = workspaceView('bob', { port: 3222 })

const SCRIPTS = { setup: '/tmp/scripts/planner/setup.sh', run: '/tmp/scripts/planner/run.sh' }

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

function renderPanel(overrides: Partial<Props> = {}): {
  props: Props
  rerender: (next: Partial<Props>) => void
} {
  const props: Props = {
    workspaces: [],
    activeWorkspaceId: null,
    color: null,
    scriptPaths: { setup: null, run: null },
    onEditScripts: vi.fn(),
    width: 360,
    onWidthChange: vi.fn(),
    leftWidth: LEFT_WIDTH,
    diffView: 'unified',
    onDiffView: vi.fn(),
    comments: commentController(),
    onError: vi.fn(),
    ...overrides
  }

  const { rerender } = render(<RightPanel {...props} />)
  return {
    props,
    rerender: (next) => {
      rerender(<RightPanel {...props} {...next} />)
    }
  }
}

/** The pane itself: a `<section>`, which carries no role to reach it by. */
function pane(): HTMLElement {
  const section = screen.getByRole('button', { name: 'Changes' }).closest('section')
  if (!section) throw new Error('The pane is not in the document')

  return section
}

describe('RightPanel', () => {
  beforeEach(() => {
    stubTerminalHost()
    window.innerWidth = ROOMY
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

  it('offers all four tabs', () => {
    renderPanel()

    for (const label of ['Changes', 'Terminal', 'Build', 'Server']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
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

    await userEvent.click(screen.getByRole('button', { name: 'Build' }))

    expect(screen.getByText(SCRIPTS.setup)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
  })

  it("shows the active workspace's port on the server tab", async () => {
    renderPanel({ workspaces: [anna, bob], activeWorkspaceId: bob.id, scriptPaths: SCRIPTS })

    await userEvent.click(screen.getByRole('button', { name: 'Server' }))

    expect(screen.getByText('OCTOPUS_PORT=3222')).toBeInTheDocument()
  })

  it('sends the user to the script editor when the project has no script', async () => {
    const onEditScripts = vi.fn()
    renderPanel({ workspaces: [anna], activeWorkspaceId: anna.id, onEditScripts })

    await userEvent.click(screen.getByRole('button', { name: 'Build' }))
    await userEvent.click(screen.getByRole('button', { name: 'Write the script' }))

    expect(onEditScripts).toHaveBeenCalled()
  })

  // A run belongs to the workspace it was started in: carrying its output to
  // the next one would describe work that never happened there.
  it('drops a running script when the workspace changes', async () => {
    const { rerender } = renderPanel({
      workspaces: [anna, bob],
      activeWorkspaceId: anna.id,
      scriptPaths: SCRIPTS
    })

    await userEvent.click(screen.getByRole('button', { name: 'Build' }))
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => {
      expect(octopus().terminal.create).toHaveBeenCalledTimes(1)
    })

    rerender({ activeWorkspaceId: bob.id })

    await waitFor(() => {
      expect(octopus().terminal.dispose).toHaveBeenCalledWith(sessionId(1))
    })
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
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

    await userEvent.click(screen.getByRole('button', { name: 'Build' }))

    expect(screen.getByText('Select a workspace to run this in.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument()
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
})
