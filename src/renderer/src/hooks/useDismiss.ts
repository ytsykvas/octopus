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
  onDismiss: () => void,
  /**
   * A second element that also counts as inside.
   *
   * For a panel rendered into a portal: React keeps it in the component tree
   * but the DOM puts it elsewhere, so `contains` on the trigger's own container
   * says a click on the panel happened outside — and the popup would close
   * under the pointer before the item it was on could fire.
   */
  portal?: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node

      // A click inside is the popup's own business.
      if (container.current?.contains(target) === true) return
      if (portal?.current?.contains(target) === true) return

      onDismiss()
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
  }, [open, container, portal, onDismiss])
}
