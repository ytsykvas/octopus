import { useCallback, useEffect, useState } from 'react'

import type { AgentCommand } from '@core/chats.js'
import { onChatEvent } from './chatEvents.js'

/**
 * The slash commands this chat may use.
 *
 * Per chat rather than per account, which is where it differs from
 * `useModels`: a project's own commands live in its `.claude/commands/`, so
 * the answer belongs to the worktree and changes when the workspace does.
 *
 * Read when the chat opens, refreshed when a session starts — the only moment
 * the agent can be asked — and replaced outright when the agent announces a
 * new list. Nothing is polled.
 *
 * The previous list survives a failed read, for the same reason as the models:
 * an empty list would claim "this workspace has no commands", which is a
 * different and wrong statement from "could not ask just now".
 */
export function useCommands(chatId: string | null): readonly AgentCommand[] {
  const [commands, setCommands] = useState<readonly AgentCommand[]>([])
  const [shownChatId, setShownChatId] = useState(chatId)

  // Cleared during render rather than in an effect: an effect runs after the
  // paint, so switching workspace would offer the previous chat's commands for
  // a frame — and a command from another worktree may not exist in this one.
  if (chatId !== shownChatId) {
    setShownChatId(chatId)
    setCommands([])
  }

  const refresh = useCallback(async (id: string) => {
    const known = await window.octopus.chats.commands(id)
    if (known.ok) setCommands(known.value)
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    if (chatId === null) return

    void (async () => {
      const known = await window.octopus.chats.commands(chatId)
      if (!controller.signal.aborted && known.ok) setCommands(known.value)
    })()

    return () => {
      controller.abort()
    }
  }, [chatId])

  useEffect(() => {
    if (chatId === null) return

    return onChatEvent((announced) => {
      // Taken straight from the event rather than asked for again: the SDK
      // pushes the whole list, and a round trip would only be a chance for
      // the two to disagree. Replaced wholesale — a command withdrawn
      // upstream has to leave the list.
      if (announced.event.type === 'commands_changed') setCommands(announced.event.commands)

      // A session has started, which is the one moment a list that was empty
      // can stop being empty.
      if (announced.event.type === 'session_started') void refresh(chatId)
    })
  }, [chatId, refresh])

  return commands
}
