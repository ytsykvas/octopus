import { useEffect, useState } from 'react'

import type { SubscriptionUsage } from '@core/agent.js'

import { onChatEvent } from './chatEvents.js'

/**
 * How much of the account's windows is gone.
 *
 * The twin of `useRateLimit`, and separate from `useSessionUsage` for the
 * reason that one keeps a chat id: the context share belongs to a conversation
 * and these figures do not. Every workspace reports the same pair, and the
 * sidebar that draws them has no conversation to ask about at all.
 *
 * Read once when the window opens — from the last reading, which the service
 * keeps in the state file, so there is something to draw before the first
 * message rather than after it. Then kept current from the same event stream as
 * everything else: a turn ending is when the figures can have moved, and
 * `useSessionUsage` re-reads at that moment anyway, so this follows it rather
 * than asking on a timer.
 */
export function useSubscriptionUsage(): SubscriptionUsage | null {
  const [usage, setUsage] = useState<SubscriptionUsage | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    const read = async (): Promise<void> => {
      const known = await window.octopus.chats.subscription()
      if (controller.signal.aborted) return
      // A failed read leaves whatever was on screen: "could not ask" and
      // "nothing to report" are different statements, and blanking the block
      // would make the first look like the second.
      if (known.ok && known.value !== null) setUsage(known.value)
    }

    void read()

    const stop = onChatEvent(({ event }) => {
      // A turn ending is the one moment the service can have learned something
      // newer; the reading itself is pulled, not announced.
      if (event.type === 'result') void read()
    })

    return () => {
      controller.abort()
      stop()
    }
  }, [])

  return usage
}
