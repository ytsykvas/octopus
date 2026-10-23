import { useEffect, useRef, type RefObject } from 'react'

/**
 * A ref holding `value` as of the last commit.
 *
 * For what a listener, a callback or a late answer reads after the render that
 * made it: a closure keeps the value it was made with, and this the newest —
 * without the listener resubscribing, or the effect re-running, each time it
 * changes. Written in an effect, never during render, so a render React threw
 * away never reaches it.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const latest = useRef(value)

  useEffect(() => {
    latest.current = value
  }, [value])

  return latest
}
