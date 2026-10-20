import type { AgentEntry } from '@core/chats.js'
import type { AgentEvent } from '@core/events.js'

import { useSessionAnswer } from './useSessionAnswer.js'

// Module-level, so the hook's effects see the same functions on every render;
// `window.octopus` is still read at call time.
const read = (chatId: string): ReturnType<typeof window.octopus.chats.agents> =>
  window.octopus.chats.agents(chatId)

const take = (event: AgentEvent): readonly AgentEntry[] | null =>
  event.type === 'agents_changed' ? event.agents : null

/** The subagents this chat may mention with `@` — see `useSessionAnswer`. */
export function useAgents(chatId: string | null): readonly AgentEntry[] {
  return useSessionAnswer(chatId, read, take)
}
