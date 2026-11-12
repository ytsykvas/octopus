import { useEffectEvent, useLayoutEffect } from 'react'

export interface WindowEventOptions {
  readonly active?: boolean
  readonly capture?: boolean
}

// Layout effect, not passive: between a commit and its passive effects the window
// still ran the previous render's listener, so a key pressed then acted on a screen
// that was no longer drawn.
export function useWindowEvent<K extends keyof WindowEventMap>(
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  { active = true, capture = false }: WindowEventOptions = {}
): void {
  const onEvent = useEffectEvent(listener)

  useLayoutEffect(() => {
    if (!active) return

    const handle = (event: WindowEventMap[K]): void => {
      onEvent(event)
    }
    window.addEventListener(type, handle, capture)
    return () => {
      window.removeEventListener(type, handle, capture)
    }
  }, [type, active, capture])
}
