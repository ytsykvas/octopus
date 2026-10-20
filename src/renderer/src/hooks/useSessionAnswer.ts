import { useCallback, useEffect, useState } from 'react'

import type { AgentEvent } from '@core/events.js'
import type { Result } from '../../../preload/index.js'
import { onChatEvent } from './chatEvents.js'
import { useSessionStarted } from './useSessionStarted.js'

/**
 * A list only this chat's agent session can answer — its commands, its
 * subagents — kept in step with what the session says.
 *
 * Per chat rather than per account: a project's own commands and agents live
 * in its `.claude/`, so the answer belongs to the worktree and changes when the
 * workspace does.
 *
 * Read when the chat opens, read again when a session starts, and replaced
 * outright when the session announces a new list — `take` picks that list out
 * of an event, or answers null for every other event. Nothing is polled.
 *
 * The previous list survives a failed read: an empty one would claim "this
 * workspace has none", which is a different and wrong statement from "could
 * not ask just now".
 */
export function useSessionAnswer<T>(
  chatId: string | null,
  read: (chatId: string) => Promise<Result<readonly T[]>>,
  take: (event: AgentEvent) => readonly T[] | null
): readonly T[] {
  const [list, setList] = useState<readonly T[]>([])
  const [shownChatId, setShownChatId] = useState(chatId)

  // Cleared during render rather than in an effect: an effect runs after the
  // paint, so switching workspace would offer the previous chat's list for a
  // frame — and an entry from another worktree may not exist in this one.
  if (chatId !== shownChatId) {
    setShownChatId(chatId)
    setList([])
  }

  const refresh = useCallback(
    async (id: string) => {
      const known = await read(id)
      if (known.ok) setList(known.value)
    },
    [read]
  )

  useEffect(() => {
    const controller = new AbortController()

    if (chatId === null) return

    void (async () => {
      const known = await read(chatId)
      if (!controller.signal.aborted && known.ok) setList(known.value)
    })()

    return () => {
      controller.abort()
    }
  }, [chatId, read])

  useEffect(() => {
    if (chatId === null) return

    // Taken straight from the event rather than asked for again: the session
    // pushes the whole list, and a round trip would only be a chance for the
    // two to disagree. Replaced wholesale — an entry withdrawn upstream has to
    // leave the list. Subscribed for this chat alone, the second argument, so
    // another conversation's list is never taken for this one's.
    return onChatEvent((announced) => {
      const next = take(announced.event)
      if (next !== null) setList(next)
    }, chatId)
  }, [chatId, take])

  // A session has started, which is the one moment a list that was empty can
  // stop being empty.
  useSessionStarted(chatId, (id) => {
    void refresh(id)
  })

  return list
}
