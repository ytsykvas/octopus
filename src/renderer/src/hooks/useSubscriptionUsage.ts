import { useCallback, useEffect, useState } from 'react'

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
export interface SubscriptionController {
  readonly usage: SubscriptionUsage | null
  /** A read is in flight, which may be spawning a session to do it. */
  readonly busy: boolean
  /** Nothing came back from a read somebody asked for. */
  readonly unavailable: boolean
  readonly refresh: () => Promise<void>
}

export function useSubscriptionUsage(): SubscriptionController {
  const [usage, setUsage] = useState<SubscriptionUsage | null>(null)
  const [busy, setBusy] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

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

  /*
   * Asked for, rather than happening. Nothing fills this block on its own —
   * the service will start a session to answer, and spawning one for a gauge
   * nobody requested is the thing its own rule forbids. A press is the request.
   */
  const refresh = useCallback(async () => {
    setBusy(true)
    const read = await window.octopus.chats.refreshSubscription()
    setBusy(false)

    if (!read.ok) return
    // `null` is "there was nowhere to ask" — an installation with no workspace
    // has no worktree to run a session in. Said rather than left as a button
    // that appears to do nothing.
    setUnavailable(read.value === null)
    if (read.value !== null) setUsage(read.value)
  }, [])

  return { usage, busy, unavailable, refresh }
}
