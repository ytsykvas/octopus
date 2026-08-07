import { useEffect, type RefObject } from 'react'

/**
 * Closes a popup on Escape or a click outside it.
 *
 * Shared because both halves are easy to get subtly wrong in different ways
 * each time — and a menu that ignores Escape, or one that closes when you
 * click inside it, reads as broken rather than as a small inconsistency.
 */
export function useDismiss(
  open: boolean,
  container: RefObject<HTMLElement | null>,
  onDismiss: () => void
): void {
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      // A click inside is the popup's own business.
      if (!container.current?.contains(event.target as Node)) onDismiss()
    }

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss()
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, container, onDismiss])
}
