import { readProposal, type TaskProposal } from '@core/taskProposal.js'
import type { ChatEntry } from '@core/transcript.js'
import { closesTurn } from '@core/turns.js'

export interface ShownProposal {
  readonly callId: string
  readonly proposal: TaskProposal
}

/** A call the tool refused is passed over: the proposal before it still shows. */
export function latestProposal(entries: readonly ChatEntry[]): ShownProposal | null {
  for (const entry of entries.toReversed()) {
    if (entry.role !== 'agent' || entry.event.type !== 'tool_use') continue
    const proposal = readProposal(entry.event.name, entry.event.input)
    if (proposal !== null) return { callId: entry.event.toolUseId, proposal }
  }
  return null
}

export function openQuestions(entries: readonly ChatEntry[]): ReadonlySet<string> {
  const open = new Set<string>()
  for (const entry of entries) {
    if (entry.role !== 'agent') continue
    const { event } = entry
    if (event.type === 'permission_request') open.add(event.requestId)
    if (event.type === 'question_answered' || event.type === 'permission_withdrawn')
      open.delete(event.requestId)
  }
  return open
}

export function isWorking(entries: readonly ChatEntry[]): boolean {
  const last = entries.findLast((entry) => entry.role === 'user' || closesTurn(entry.event))
  return last?.role === 'user'
}
