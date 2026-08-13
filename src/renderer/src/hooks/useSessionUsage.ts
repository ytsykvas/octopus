import { useCallback, useEffect, useState } from 'react'

import type { SessionUsage } from '@core/service.js'

const NOTHING: SessionUsage = { context: null, subscription: null }

/**
 * What the running agent says about its context window and the account's.
 *
 * Both figures are pulled rather than pushed — the agent answers a control
 * request, it does not announce these — so they are read at the three moments
 * they can have changed: when the pane opens on a conversation that may already
 * have a session, when one starts, and when a turn ends.
 *
 * Deliberately no timer. If the numbers ever look stale the answer is another
 * event, not an interval: each read is a round trip to the agent, and one of
 * the two goes on to the network.
 */
export function useSessionUsage(chatId: string | null): SessionUsage {
  const [usage, setUsage] = useState<SessionUsage>(NOTHING)
  const [shownFor, setShownFor] = useState<string | null>(chatId)

  // Cleared while rendering rather than in an effect. The context share belongs
  // to one conversation, and the previous one left on screen for a frame is not
  // a stale number — it is a wrong one, about a chat the reader has left.
  if (chatId !== shownFor) {
    setShownFor(chatId)
    setUsage(NOTHING)
  }

  const refresh = useCallback(async (id: string) => {
    const read = await window.octopus.chats.usage(id)
    // A failed read leaves the last good figures standing: "could not ask" and
    // "nothing to report" are different statements, and blanking the strip
    // would make the first look like the second.
    if (read.ok) setUsage(read.value)
  }, [])

  useEffect(() => {
    if (chatId === null) return

    const controller = new AbortController()

    void (async () => {
      const read = await window.octopus.chats.usage(chatId)
      if (!controller.signal.aborted && read.ok) setUsage(read.value)
    })()

    return () => {
      controller.abort()
    }
  }, [chatId])

  useEffect(() => {
    if (chatId === null) return

    return window.octopus.chats.onEvent((message) => {
      if (message.chatId !== chatId) return
      if (message.event.type === 'session_started' || message.event.type === 'result') {
        void refresh(chatId)
      }
    })
  }, [chatId, refresh])

  return usage
}
