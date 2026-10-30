import { type RefObject, useEffect } from 'react'

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
 * Shared by every panel placed this way: `useAnchoredPanel` and the prompt fan,
 * whose pills sit on an arc rather than in a box. Copied, the second would drift
 * from the first the next time either was touched.
 */
export function useCloseOnMove(
  open: boolean,
  container: RefObject<HTMLElement | null>,
  close: () => void
): void {
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
  }, [open, container, close])
}
