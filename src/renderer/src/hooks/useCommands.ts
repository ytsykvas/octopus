import type { AgentCommand } from '@core/chats.js'
import type { AgentEvent } from '@core/events.js'

import { useSessionAnswer } from './useSessionAnswer.js'

// Module-level, so the hook's effects see the same functions on every render;
// `window.octopus` is still read at call time.
const read = (chatId: string): ReturnType<typeof window.octopus.chats.commands> =>
  window.octopus.chats.commands(chatId)

const take = (event: AgentEvent): readonly AgentCommand[] | null =>
  event.type === 'commands_changed' ? event.commands : null

/** The slash commands this chat may use — see `useSessionAnswer`. */
export function useCommands(chatId: string | null): readonly AgentCommand[] {
  return useSessionAnswer(chatId, read, take)
}
