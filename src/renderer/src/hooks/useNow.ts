import { useEffect, useState } from 'react'

/**
 * The time, read again every second while `ticking` — and not at all while it
 * is not, so a map of finished agents costs nothing to leave open.
 */
export function useNow(ticking: boolean): number {
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
