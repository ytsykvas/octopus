/**
 * When the turn under way began.
 *
 * One rule with two readers. The working line under a conversation reads it
 * over the entries it holds; the status bar reads it for conversations whose
 * entries it never loads, from a value the service keeps by applying the same
 * rule one entry at a time. Two rules written separately would disagree after
 * the first permission prompt, and the bar and the line beneath it would show
 * two different times for one turn.
 *
 * Types only from `transcript.ts` and a value from `events.ts`, which is safe, so
 * the renderer may import values from here.
 */

import { isTaskBoundary } from './events.js'
import type { ChatEntry } from './transcript.js'

/**
 * The start after one more entry: the first of the main agent's own entries
 * since the last turn closed.
 *
 * A `result` closes the turn, so nothing is under way until something else is
 * said.
 */
export function nextTurnStart(start: string | null, entry: ChatEntry): string | null {
  if (entry.role === 'agent' && entry.event.type === 'result') return null
  return start ?? (isMainTurnEntry(entry) ? entry.at : null)
}

/**
 * The same, over a whole log. Null when nothing has been said since the last
 * turn closed — a reader then shows that work is under way without a time,
 * rather than counting from nowhere.
 */
export function turnStartedAt(entries: readonly ChatEntry[]): string | null {
  return entries.reduce<string | null>(nextTurnStart, null)
}

/**
 * Whether an entry is the main agent's own doing.
 *
 * The agents a turn sent off go on after its result — starting and ending,
 * taking steps, asking — while no turn is running, and a clock started by
 * one of those would count work the main agent is not doing.
 */
function isMainTurnEntry(entry: ChatEntry): boolean {
  if (entry.role !== 'agent') return true
  const { event } = entry
  if (isTaskBoundary(event)) return false
  if (event.type === 'permission_request') return event.taskId === undefined
  return !('parentToolUseId' in event) || event.parentToolUseId === undefined
}
