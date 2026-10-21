import type { Terminal as XTerm } from '@xterm/xterm'

/*
 * xterm 6.0.0 keeps drawing a terminal it has paused, and this stops it.
 *
 * xterm pauses a terminal its IntersectionObserver says is off screen, but one
 * path ignores the pause: every line that scrolls the buffer asks the selection
 * to be drawn again — with nothing selected — and the DOM renderer answers by
 * redrawing every row. So a hidden dev server's log kept a fifth of a core busy
 * for as long as it ran (xtermjs/xterm.js#6208, open).
 *
 * While paused, the request is kept rather than drawn: xterm's own resume
 * already redraws everything and then the selection, from the state stored
 * here. What still draws while paused happens once, not per line — a focus
 * change, a resize.
 *
 * It reaches into xterm's internals, so xterm is pinned to the version these
 * were read from (`package.json`, `docs/PROJECT.md`). Where they are not there
 * it does nothing: the terminal is slower, never broken. Delete this module
 * once xterm gates the request itself — PR #5769, in the 6.1 betas, already
 * drops it when nothing is selected.
 */

type Cell = [number, number]

/** The parts of xterm's render service the guard reads and writes. */
interface PausableRenderService {
  _isPaused: boolean
  _needsFullRefresh: boolean
  _needsSelectionRefresh: boolean
  _selectionState: { start: Cell | undefined; end: Cell | undefined; columnSelectMode: boolean }
  handleSelectionChanged: (
    start: Cell | undefined,
    end: Cell | undefined,
    columnSelectMode: boolean
  ) => void
}

function isPausable(value: unknown): value is PausableRenderService {
  if (typeof value !== 'object' || value === null) return false

  return (
    '_isPaused' in value &&
    typeof value._isPaused === 'boolean' &&
    '_needsFullRefresh' in value &&
    typeof value._needsFullRefresh === 'boolean' &&
    '_needsSelectionRefresh' in value &&
    typeof value._needsSelectionRefresh === 'boolean' &&
    '_selectionState' in value &&
    typeof value._selectionState === 'object' &&
    value._selectionState !== null &&
    'handleSelectionChanged' in value &&
    typeof value.handleSelectionChanged === 'function'
  )
}

/** The render service behind a terminal, which exists once it is opened. */
function renderServiceOf(term: XTerm): PausableRenderService | null {
  if (!('_core' in term)) return null
  const core = term._core
  if (typeof core !== 'object' || core === null || !('_renderService' in core)) return null

  const service = core._renderService
  return isPausable(service) ? service : null
}

/**
 * Makes a paused terminal keep its selection redraws for when it is seen again.
 *
 * Called once, after `open`. Answers whether the guard is in place.
 */
export function holdSelectionWhilePaused(term: XTerm): boolean {
  const service = renderServiceOf(term)
  if (service === null) return false

  const draw = service.handleSelectionChanged.bind(service)
  service.handleSelectionChanged = (start, end, columnSelectMode) => {
    if (!service._isPaused) {
      draw(start, end, columnSelectMode)
      return
    }

    service._selectionState.start = start
    service._selectionState.end = end
    service._selectionState.columnSelectMode = columnSelectMode
    service._needsSelectionRefresh = true
    service._needsFullRefresh = true
  }
  return true
}
