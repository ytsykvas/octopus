import { readProposal, type TaskProposal } from '@core/taskProposal.js'
import type { ChatEntry } from '@core/transcript.js'

/** The proposal drawn under the log, by the call that made it: edits belong to one call. */
export interface ShownProposal {
  readonly callId: string
  readonly proposal: TaskProposal
}

/** The newest proposal the agent made; a refused call reads as none (`readProposal`). */
export function latestProposal(entries: readonly ChatEntry[]): ShownProposal | null {
  for (const entry of entries.toReversed()) {
    if (entry.role !== 'agent' || entry.event.type !== 'tool_use') continue
    const proposal = readProposal(entry.event.name, entry.event.input)
    if (proposal !== null) return { callId: entry.event.toolUseId, proposal }
  }
  return null
}

/** The questions asked and neither answered nor taken back. */
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

/** A message was sent and no turn has ended since: a result, or an error that ended it. */
export function isWorking(entries: readonly ChatEntry[]): boolean {
  const last = entries.findLast(
    (entry) =>
      entry.role === 'user' ||
      entry.event.type === 'result' ||
      (entry.event.type === 'error' && entry.event.code !== 'background')
  )
  return last?.role === 'user'
}
