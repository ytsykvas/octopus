import { useCallback, useEffect, useState } from 'react'

import type { UsageOutcome } from '@core/service.js'
import type { UsageWindows } from '@core/usage.js'

/**
 * How often the account is asked while the window is being looked at.
 *
 * Three minutes. A read costs no tokens and, measured, 720–850ms cold or about
 * 260ms against a session already running — so the figure is worth keeping
 * roughly current, and not worth asking about every minute. Nothing is asked
 * while the window is hidden: the reading is only ever read by somebody who can
 * see it.
 */
const REFRESH_INTERVAL_MS = 180_000

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

/**
 * How much of the account's windows is gone.
 *
 * Three things keep it current, and they are three because each covers a gap
 * the others leave.
 *
 * **The service announces it.** The figures move when a turn ends, and the
 * service is what knows that. This used to be a handler that watched for a
 * finished turn and then read the service's *cache* — which the chat pane was
 * still filling, on the same event, one round trip later. The sidebar won that
 * race never, and drew the previous turn's figure every time.
 *
 * **Coming back to the window asks.** Whatever happened while it was in the
 * background did not announce itself here, and the figure informs a decision
 * taken the moment somebody looks: whether to start something at all.
 *
 * **A slow timer while it is visible.** For the window left open and watched.
 * Stopped when the window is hidden, because nothing behind a hidden window is
 * worth spawning a process for.
 *
 * The design this replaces said "nothing is polled, and nothing starts a
 * session on its own", on the reasoning that answering costs an agent.
 * Measured, it costs under a second and no tokens.
 */
export function useSubscriptionUsage(): SubscriptionController {
  const [usage, setUsage] = useState<UsageWindows | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<SubscriptionOutcome>('unread')

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

  // The last reading the service kept, so there is something to draw in the
  // moment before the first live read answers.
  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const known = await window.octopus.chats.subscription()
      // A failed read leaves whatever was on screen: "could not ask" and
      // "nothing to report" are different statements, and blanking the block
      // would make the first look like the second.
      if (!controller.signal.aborted && known.ok && known.value !== null) setUsage(known.value)
    })()

    return () => {
      controller.abort()
    }
  }, [])

  useEffect(() => window.octopus.chats.onUsageWindows(setUsage), [])

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null

    const stop = (): void => {
      if (timer !== null) clearInterval(timer)
      timer = null
    }

    /*
     * Both halves of "the window is being looked at". `visibilitychange` covers
     * the tab or the app being hidden and shown; `focus` covers moving between
     * this window and another while both stay visible, which fires no
     * visibility change at all.
     */
    const watch = (): void => {
      stop()
      if (document.hidden) return

      void refresh()
      timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    }

    watch()
    window.addEventListener('focus', watch)
    document.addEventListener('visibilitychange', watch)

    return () => {
      stop()
      window.removeEventListener('focus', watch)
      document.removeEventListener('visibilitychange', watch)
    }
  }, [refresh])

  return { usage, busy, outcome, refresh }
}
