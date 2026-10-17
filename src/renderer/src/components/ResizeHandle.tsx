import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface ResizeHandleProps {
  readonly width: number
  readonly min: number
  readonly max: number
  /** Called continuously while dragging, so the pane follows the cursor. */
  readonly onResize: (width: number) => void
  /** Called once the drag ends — the moment worth persisting. */
  readonly onCommit: (width: number) => void
  /**
   * Which way dragging makes the pane wider.
   *
   * `right` for a pane on the left of the window, `left` for one on the right.
   */
  readonly grows?: 'left' | 'right'
  /**
   * Called as a drag crosses the line past which the pane folds away, and back.
   *
   * Without it the pane only ever stops at `min`, as the workspace list does.
   * With it, dragging well past the floor folds the pane, the way a sidebar
   * folds in most desktop applications, and dragging back within the same
   * gesture brings it out again.
   */
  readonly onFold?: (folded: boolean) => void
}

/** How far one arrow key moves the edge. */
const STEP = 16

/**
 * How far past the floor a drag has to go before the pane folds: below half of
 * `min`. Far enough that a drag which merely overshoots the floor still stops
 * there, near enough that folding by dragging does not need the whole window.
 */
const FOLD_AT = 0.5

/**
 * Draggable edge of the right pane.
 *
 * Width is reported continuously while dragging but committed only on release:
 * persisting every intermediate pixel would mean a disk write per mouse move.
 */
export function ResizeHandle({
  width,
  min,
  max,
  onResize,
  onCommit,
  grows = 'left',
  onFold
}: ResizeHandleProps): React.JSX.Element {
  const { t } = useTranslation()
  // The pointer handlers live on window for the length of a drag, so they read
  // the latest width without being torn down and rebuilt on every move.
  const latest = useRef(width)

  useEffect(() => {
    latest.current = width
  }, [width])

  const clamp = (value: number): number => Math.min(Math.max(Math.round(value), min), max)

  const startDrag = (event: React.PointerEvent): void => {
    event.preventDefault()

    // Measured as a delta from where the drag began rather than from a window
    // edge: the same handle then works on either side, and a pane that does not
    // start at the window edge — the workspace list sits past the tab strip —
    // needs no special case.
    const startX = event.clientX
    const startWidth = latest.current
    let folded = false

    const onMove = (move: PointerEvent): void => {
      const travelled = move.clientX - startX
      const wanted = startWidth + (grows === 'right' ? travelled : -travelled)

      if (onFold) {
        const fold = wanted < min * FOLD_AT
        if (fold !== folded) {
          folded = fold
          onFold(fold)
        }
        // Folded, the width goes back to where the drag began, so the release
        // commits that — and the pane comes back out at the width it had,
        // not at the floor it was dragged through on the way.
        if (fold) {
          latest.current = startWidth
          onResize(startWidth)
          return
        }
      }

      const next = clamp(wanted)
      latest.current = next
      onResize(next)
    }

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      // The cursor is forced for the whole drag, otherwise it flickers back to
      // an arrow whenever it outruns the edge.
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
      onCommit(latest.current)
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const nudge = (delta: number): void => {
    const next = clamp(latest.current + delta)
    latest.current = next
    onResize(next)
    onCommit(next)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('panel.resize')}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={startDrag}
      onKeyDown={(event) => {
        // The arrow that widens is the one pointing away from the pane.
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          nudge(grows === 'right' ? -STEP : STEP)
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          nudge(grows === 'right' ? STEP : -STEP)
        }
      }}
      // Wider than it looks: a 1px target is hard to hit, so the hit area is
      // padded while only the centre line is painted.
      className={`hover:bg-accent/40 focus-visible:bg-accent/60 absolute top-0 z-10 h-full w-2 cursor-col-resize transition-colors focus:outline-none ${
        grows === 'right' ? '-right-1' : '-left-1'
      }`}
    />
  )
}
