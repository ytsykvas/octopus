import type { RefObject } from 'react'

import { useWindowEvent } from './useWindowEvent.js'

/**
 * Closes a floating panel when whatever it is anchored to could have moved.
 *
 * Fixed coordinates are a snapshot: anything that moves the anchor leaves the
 * panel floating where the anchor used to be, so it closes instead. Only a
 * scroll inside something the anchor sits in can move it — the chat log scrolls
 * itself on every streamed fragment, and closing on that shut the panel a few
 * times a second for as long as the agent was answering. A resize moves
 * everything, so it always closes.
 *
 * Shared by every panel placed this way: `useAnchoredPanel`, `DropdownMenu` and
 * the prompt fan, whose pills sit on an arc rather than in a box. Copied, the
 * copies would drift the next time one was touched.
 */
export function useCloseOnMove(
  open: boolean,
  container: RefObject<HTMLElement | null>,
  close: () => void
): void {
  // In the capture phase: a scroll does not bubble, so only there does the window
  // see one inside the log, and `target` is the one thing saying where it happened.
  useWindowEvent(
    'scroll',
    (event) => {
      const scrolled = event.target
      if (scrolled instanceof Node && !scrolled.contains(container.current)) return

      close()
    },
    { active: open, capture: true }
  )
  useWindowEvent('resize', close, { active: open })
}
