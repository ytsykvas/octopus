import type { AgentEvent } from '@core/events.js'
import type { ChatHistory } from '@core/service.js'
import type { ChatEntry } from '@core/transcript.js'

export interface Heard {
  readonly seq: number
  readonly at: string
  readonly event: AgentEvent
}

export function withEvent(
  entries: readonly ChatEntry[],
  { at, event }: Heard
): readonly ChatEntry[] {
  if (event.type === 'conversation_reset' && event.cleared) return []
  return [...entries, { role: 'agent', at, event }]
}

export function mergeHistory(history: ChatHistory, heard: readonly Heard[]): readonly ChatEntry[] {
  return heard
    .filter(({ seq }) => seq > history.seq)
    .reduce<readonly ChatEntry[]>(withEvent, history.entries)
}
