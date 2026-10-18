import { useEffect, useEffectEvent } from 'react'

import { onChatEvent } from './chatEvents.js'

/**
 * Calls `onStart` whenever this conversation's agent session starts.
 *
 * That is the one moment a list only a running session can answer — the
 * commands it offers, the skills it holds — can change from what was read
 * before it existed. A session starts lazily, on the first message, so a list
 * read when the pane opened goes on describing a conversation with no agent
 * behind it until something reads it again.
 *
 * It also fires after every slash command, since each one brings a fresh
 * init. That is the price of being right, and callers re-read rather than
 * accumulate, so a repeat costs a round trip and nothing else.
 *
 * Subscribed for this chat alone: a pane woken by another conversation's
 * session would re-read its own list for nothing, or worse, take the other's.
 * No subscription at all while there is no chat — nothing can start for a
 * record that does not exist yet.
 *
 * `onStart` is handed the chat's id, so a caller need not narrow its own
 * `string | null` again for a callback that only ever runs with a chat. It is
 * an effect event, so a caller may pass a fresh function on every
 * render without the subscription being dropped and taken again.
 */
export function useSessionStarted(chatId: string | null, onStart: (chatId: string) => void): void {
  const started = useEffectEvent(onStart)

  useEffect(() => {
    if (chatId === null) return

    return onChatEvent(({ event }) => {
      if (event.type === 'session_started') started(chatId)
    }, chatId)
  }, [chatId])
}
