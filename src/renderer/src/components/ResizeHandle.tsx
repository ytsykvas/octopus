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
}

/** How far one arrow key moves the edge. */
const STEP = 16

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
  onCommit
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

    const onMove = (move: PointerEvent): void => {
      // Measured from the right edge of the window: the pane is anchored there,
      // so this holds regardless of how wide the window is.
      const next = clamp(window.innerWidth - move.clientX)
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
        // Left widens: the pane is on the right, so its edge moves left.
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          nudge(STEP)
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          nudge(-STEP)
        }
      }}
      // Wider than it looks: a 1px target is hard to hit, so the hit area is
      // padded while only the centre line is painted.
      className="hover:bg-accent/40 focus-visible:bg-accent/60 group absolute top-0 -left-1 z-10 h-full w-2 cursor-col-resize transition-colors focus:outline-none"
    />
  )
}
