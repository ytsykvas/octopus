import { useCallback, useEffect, useState } from 'react'

import type { UsageOutcome } from '@core/service.js'
import type { UsageWindows } from '@core/usage.js'

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
/** What the block has to say when it has no figures: four things, not one. */
export type SubscriptionOutcome = UsageOutcome['kind'] | 'unread'

export interface SubscriptionController {
  readonly usage: UsageWindows | null
  /** A read is in flight, which may be spawning a session to do it. */
  readonly busy: boolean
  /**
   * What came of the last read, or `unread` before there has been one.
   *
   * A boolean stood here and got two of the four wrong: a read that failed
   * cleared it and redrew stale figures as though they were fresh, and an
   * account with no plan windows was told to open a workspace first.
   */
  readonly outcome: SubscriptionOutcome
  readonly refresh: () => Promise<void>
}

export function useSubscriptionUsage(): SubscriptionController {
  const [usage, setUsage] = useState<UsageWindows | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<SubscriptionOutcome>('unread')

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

    // The call itself failing is the same story as the read failing, and there
    // is no fifth thing for the block to say about it.
    if (!read.ok) {
      setOutcome('failed')
      return
    }

    setOutcome(read.value.kind)
    if (read.value.kind === 'read') setUsage(read.value.windows)
  }, [])

  return { usage, busy, outcome, refresh }
}
