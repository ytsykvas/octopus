import { type RefObject, useCallback, useRef, useState } from 'react'

import { useCloseOnMove } from './useCloseOnMove.js'
import { useDismiss } from './useDismiss.js'

/** Gap between trigger and panel, and the smallest margin to a window edge. */
const GAP = 6

/** How much room the panel needs, so it can be placed before it is drawn. */
export interface PanelSize {
  readonly width: number
  readonly height: number
}

/**
 * Where to draw a panel, in window coordinates, ready to spread into `style`.
 *
 * Pinned by its top edge when it opens below the trigger and by its **bottom**
 * edge when it opens above. A panel above the trigger that was pinned by its
 * top sat wherever the estimated height put it: a little shorter than the
 * estimate and it floated free of the control, and anything it grew by — a
 * group unfolded — ran down over the trigger. Pinned by the bottom it hugs the
 * trigger whatever its height, and grows away from it.
 */
export type PanelPosition =
  | { readonly top: number; readonly left: number }
  | { readonly bottom: number; readonly left: number }

export interface AnchoredPanel {
  readonly open: boolean
  /** Where to draw it; null until it is opened. */
  readonly position: PanelPosition | null
  /** Goes on the element wrapping trigger and panel — a click inside is theirs. */
  readonly container: RefObject<HTMLDivElement | null>
  /** Opens against the trigger, or closes if this one is already open. */
  readonly toggle: (trigger: HTMLElement, size: PanelSize) => void
  readonly close: () => void
}

/**
 * A panel placed against the control that opens it, and against the window.
 *
 * Positioned `fixed` rather than `absolute`, for the reason `DropdownMenu` sets
 * out at length: an absolutely placed panel is clipped by any scrolling
 * ancestor, and the composer sits inside several.
 *
 * Shared because the model picker and the effort scale need every line of it —
 * flip when it would run off the bottom, clamp when it would run off the right,
 * close on Escape, on a click outside, on a resize, and on a scroll of
 * something the trigger sits inside. Copied instead, the two would drift apart
 * the first time either was touched, and the second copy is exactly what
 * `CLAUDE.md` says to treat as a cue.
 *
 * The size is given per opening rather than per hook: a panel whose height
 * depends on how many rows it will hold only knows it at that moment.
 */
export function useAnchoredPanel(): AnchoredPanel {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<PanelPosition | null>(null)
  const container = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  useDismiss(open, container, close)

  useCloseOnMove(open, container, close)

  const toggle = useCallback(
    (trigger: HTMLElement, size: PanelSize): void => {
      if (open) {
        setOpen(false)
        return
      }

      const rect = trigger.getBoundingClientRect()

      // Lined up with the trigger's left edge, and clamped so a narrow window
      // cannot push the panel off the right.
      const left = Math.min(Math.max(GAP, rect.left), window.innerWidth - size.width - GAP)

      // Erring high is the safe way to be wrong about the height: it flips the
      // panel above the trigger sooner than it must, where — pinned by its
      // bottom — a panel shorter than the guess still meets the trigger. Erring
      // low runs it off the bottom of the window.
      const fitsBelow = rect.bottom + GAP + size.height <= window.innerHeight
      const fitsAbove = rect.top - GAP - size.height >= GAP

      setPosition(
        fitsBelow
          ? { top: rect.bottom + GAP, left }
          : fitsAbove
            ? { bottom: window.innerHeight - rect.top + GAP, left }
            : // No room either way: from the top of the window, so what is cut
              // off is the end of a list rather than its beginning.
              { top: GAP, left }
      )
      setOpen(true)
    },
    [open]
  )

  return { open, position, container, toggle, close }
}
