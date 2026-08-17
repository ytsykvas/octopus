import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

import { useDismiss } from './useDismiss.js'

/** Gap between trigger and panel, and the smallest margin to a window edge. */
const GAP = 6

/** How much room the panel needs, so it can be placed before it is drawn. */
export interface PanelSize {
  readonly width: number
  readonly height: number
}

export interface AnchoredPanel {
  readonly open: boolean
  /** Where to draw it, in window coordinates; null until it is opened. */
  readonly position: { readonly top: number; readonly left: number } | null
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
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const container = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  useDismiss(open, container, close)

  // Fixed coordinates are a snapshot: anything that moves the trigger leaves
  // the panel floating where the trigger used to be, so it closes instead. Only
  // a scroll inside something the trigger sits in can move it — the chat log
  // scrolls itself on every streamed fragment, and closing on that shut the
  // panel a few times a second for as long as the agent was answering.
  useEffect(() => {
    if (!open) return

    const closeOnScroll = (event: Event): void => {
      const scrolled = event.target
      if (scrolled instanceof Node && !scrolled.contains(container.current)) return

      close()
    }

    window.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('resize', close)

    return () => {
      window.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close])

  const toggle = useCallback(
    (trigger: HTMLElement, size: PanelSize): void => {
      if (open) {
        setOpen(false)
        return
      }

      const rect = trigger.getBoundingClientRect()

      setPosition({
        // Erring high is the safe way to be wrong about the height: it flips the
        // panel above the trigger sooner than it must, where erring low would
        // run it off the bottom of the window.
        top:
          rect.bottom + GAP + size.height > window.innerHeight
            ? Math.max(GAP, rect.top - size.height - GAP)
            : rect.bottom + GAP,
        // Lined up with the trigger's left edge, and clamped so a narrow window
        // cannot push the panel off the right.
        left: Math.min(Math.max(GAP, rect.left), window.innerWidth - size.width - GAP)
      })

      setOpen(true)
    },
    [open]
  )

  return { open, position, container, toggle, close }
}
