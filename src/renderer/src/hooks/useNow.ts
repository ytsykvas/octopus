import { useEffect, useState } from 'react'

/**
 * The time, redrawn every `ms`.
 *
 * Held by the component that shows a running count, so the tick redraws that
 * one line and never whatever is around it — the log above the working line,
 * the rest of the status bar beside its timer.
 */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now())
    }, ms)
    return () => {
      clearInterval(tick)
    }
  }, [ms])

  return now
}
