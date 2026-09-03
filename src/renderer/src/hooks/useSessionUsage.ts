import { useCallback, useEffect, useState } from 'react'

import type { SessionUsage } from '@core/service.js'
import { onChatEvent } from './chatEvents.js'

const NOTHING: SessionUsage = { context: null }

/**
 * What the running agent says about its context window and the account's.
 *
 * Both figures are pulled rather than pushed — the agent answers a control
 * request, it does not announce these — so they are read at the three moments
 * they can have changed: when the pane opens on a conversation that may already
 * have a session, when one starts, and when a turn ends.
 *
 * Deliberately no timer, and now with a figure behind the rule: the pair costs
 * about **700ms**, measured against a live session. Almost all of it is the
 * context reading — `get_usage` settles at under 40ms once the CLI has its
 * answer, while `getContextUsage` takes 600–700ms every single time. They are
 * asked for together, so the pane pays the slower one.
 *
 * That is fine three times a turn and would not be on an interval. If the
 * numbers ever look stale the answer is another event, not a shorter one.
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

    return onChatEvent((message) => {
      if (message.event.type === 'session_started' || message.event.type === 'result') {
        void refresh(chatId)
        return
      }

      /*
       * The one figure taken from an event rather than asked for.
       *
       * A compaction frees most of the window, and the reading went on showing
       * what it showed before — measured live at 74k before and 16k after. The
       * reading is the reason the command was run, so seeing it unmoved means
       * running it again for another minute and another dollar.
       *
       * Taken rather than re-read because `postTokens` is what the CLI itself
       * computed for the conversation it has just written: right whether or not
       * `getContextUsage` has caught up, where a re-read would put the stale
       * figure back if the CLI only updates on the next request. The next
       * `result` re-reads as it always did.
       */
      if (message.event.type === 'conversation_compacted') {
        const { postTokens } = message.event
        if (postTokens === null) return

        setUsage((current) =>
          current.context === null
            ? current
            : {
                ...current,
                context: {
                  ...current.context,
                  usedTokens: postTokens,
                  percentage: Math.round((postTokens / current.context.maxTokens) * 100)
                }
              }
        )
      }
    }, chatId)
  }, [chatId, refresh])

  return usage
}
