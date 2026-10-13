import { z } from 'zod'

import type { ChatEntry } from './transcript.js'

/**
 * The tool the agent keeps its task list with.
 *
 * Written out here rather than matched against a literal in the window, for the
 * reason `EXIT_PLAN_MODE` is a constant: it belongs to the SDK, and a copy
 * would go on matching the old name after a rename.
 */
export const TODO_WRITE = 'TodoWrite'

export const TodoStatusSchema = z.enum(['pending', 'in_progress', 'completed'])
export type TodoStatus = z.infer<typeof TodoStatusSchema>

/** One line of the agent's list, as `TodoWrite` carries it. */
export const TodoSchema = z.object({
  content: z.string(),
  status: TodoStatusSchema,
  /** What it is called while it is being done — "Running the tests". */
  activeForm: z.string().default('')
})
export type Todo = z.infer<typeof TodoSchema>

const TodoWriteSchema = z.object({ todos: z.array(TodoSchema) })

/**
 * The list a `TodoWrite` call carries, or null when the call is something else
 * or does not parse.
 *
 * Validated because it is the model's own JSON (§11.3): a malformed list falls
 * back to being an ordinary tool row rather than taking the conversation down.
 */
export function readTodos(toolName: string, input: unknown): Todo[] | null {
  if (toolName !== TODO_WRITE) return null

  const parsed = TodoWriteSchema.safeParse(input)
  return parsed.success ? parsed.data.todos : null
}

/**
 * The agent's list as it stands now: the last call that carried a readable one.
 *
 * `TodoWrite` always sends the **whole** list, so the newest call is the state
 * and nothing before it needs replaying. A newest call that does not parse is
 * skipped rather than blanking the list — the one before it is still the best
 * account there is.
 */
export function latestTodos(entries: readonly ChatEntry[]): Todo[] | null {
  for (const entry of entries.toReversed()) {
    if (entry.role !== 'agent' || entry.event.type !== 'tool_use') continue

    // A subagent keeps a list of its own for its own task. It is not the
    // conversation's, and the newest one written would otherwise replace it.
    if (entry.event.parentToolUseId !== undefined) continue

    const todos = readTodos(entry.event.name, entry.event.input)
    if (todos !== null) return todos
  }

  return null
}
