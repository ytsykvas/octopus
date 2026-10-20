/**
 * What the log says about one agent: the task it was given and what it did.
 *
 * Read from the conversation's entries rather than carried on the task, because
 * the log already holds both — the call's own arguments, and every step the
 * subagent took tagged with that call's id — and a second copy in the core
 * would be one more thing for a restart to lose.
 */

import { z } from 'zod'

import type { ChatEntry } from '@core/transcript.js'

const AgentCall = z.object({ prompt: z.string() })

/** The prompt the agent was started with, or null where the log has none. */
export function promptOf(entries: readonly ChatEntry[], toolUseId: string): string | null {
  for (const entry of entries) {
    if (entry.role !== 'agent') continue
    const { event } = entry
    if (event.type !== 'tool_use' || event.toolUseId !== toolUseId) continue
    const call = AgentCall.safeParse(event.input)
    return call.success ? call.data.prompt : null
  }
  return null
}

export interface AgentStep {
  readonly toolUseId: string
  readonly name: string
  readonly input: unknown
}

/** The last `limit` tool calls an agent made, oldest first. */
export function stepsOf(
  entries: readonly ChatEntry[],
  toolUseId: string,
  limit: number
): readonly AgentStep[] {
  const steps: AgentStep[] = []
  for (const entry of entries) {
    if (entry.role !== 'agent') continue
    const { event } = entry
    if (event.type === 'tool_use' && event.parentToolUseId === toolUseId) {
      steps.push({ toolUseId: event.toolUseId, name: event.name, input: event.input })
    }
  }
  return steps.slice(-limit)
}
