import { useEffect, useState } from 'react'

/**
 * The time, read again every second while `ticking` — and not at all while it
 * is not, so a map of finished agents costs nothing to leave open.
 *
 * Held by the component that shows a running count, so the tick redraws that
 * one line and never whatever is around it — the log above the working line,
 * the rest of the status bar beside its timer.
 */
export function useNow(ticking = true): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!ticking) return
    const tick = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      clearInterval(tick)
    }
  }, [ticking])

  return now
}
