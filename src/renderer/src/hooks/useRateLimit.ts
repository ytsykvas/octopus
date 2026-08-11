import { useEffect, useState } from 'react'

import type { RateLimit } from '@core/service.js'

/**
 * How much of the subscription's window is gone.
 *
 * Separate from `useChat` because the figure belongs to the account, not to a
 * conversation: every workspace reports the same one, and switching between
 * them must not blank it out.
 *
 * Read once when the window opens, then kept current from the same event
 * stream as everything else the agent says. Nothing is polled — the reading
 * only changes when a turn runs, and a turn always announces it.
 */
export function useRateLimit(): RateLimit | null {
  const [limit, setLimit] = useState<RateLimit | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const known = await window.octopus.chats.rateLimit()
      if (controller.signal.aborted) return
      // A live event that arrived while this was in flight is the newer of the
      // two, so it wins rather than being overwritten by what was on the way.
      if (known.ok && known.value !== null) setLimit((current) => current ?? known.value)
    })()

    return () => {
      controller.abort()
    }
  }, [])

  useEffect(
    () =>
      window.octopus.chats.onEvent(({ event }) => {
        if (event.type === 'rate_limit') setLimit(event)
      }),
    []
  )

  return limit
}
