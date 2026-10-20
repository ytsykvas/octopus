import { useEffect, useEffectEvent } from 'react'

/**
 * Runs `tick` now and every `ms` after, but only while the window is looked at.
 *
 * Every reading the window keeps current is only ever read by somebody who can
 * see it, and some of them cost a process — the account's limits spawn the
 * CLI, the resource meter runs `ps`. So the clock stops when the window is
 * hidden or minimised, and a return asks at once rather than waiting out the
 * rest of an interval with a stale figure on screen.
 *
 * Both halves of "looked at" are listened to. `visibilitychange` covers the
 * window being hidden and shown; `focus` covers moving between this window and
 * another while both stay visible, which fires no visibility change at all.
 *
 * `active` false stops it outright — for a reading whose display is folded away.
 */
export function useVisibleInterval(tick: () => void, ms: number, active = true): void {
  const run = useEffectEvent(tick)

  useEffect(() => {
    if (!active) return

    let timer: ReturnType<typeof setInterval> | null = null

    const stop = (): void => {
      if (timer !== null) clearInterval(timer)
      timer = null
    }

    const watch = (): void => {
      stop()
      if (document.hidden) return

      run()
      timer = setInterval(() => {
        run()
      }, ms)
    }

    watch()
    window.addEventListener('focus', watch)
    document.addEventListener('visibilitychange', watch)

    return () => {
      stop()
      window.removeEventListener('focus', watch)
      document.removeEventListener('visibilitychange', watch)
    }
  }, [ms, active])
}
