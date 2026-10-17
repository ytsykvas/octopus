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
 * The tools current CLIs keep the list with instead of `TodoWrite`.
 *
 * Not a choice octopus makes: the CLI offers these, and `TodoWrite` only when
 * `CLAUDE_CODE_ENABLE_TASKS=0` is set — measured on 2.1.299, whose session had
 * no `TodoWrite` at all. Read alongside it, so the agent keeps its own tools.
 */
const TASK_CREATE = 'TaskCreate'
const TASK_UPDATE = 'TaskUpdate'

const TaskCreateSchema = z.object({ subject: z.string(), activeForm: z.string().default('') })

const TaskUpdateSchema = z.object({
  taskId: z.string(),
  subject: z.string().optional(),
  activeForm: z.string().optional(),
  status: z.union([TodoStatusSchema, z.literal('deleted')]).optional()
})

/**
 * The agent's list as it stands now.
 *
 * Replayed from the start, because the two ways of keeping it differ:
 * `TodoWrite` sends the **whole** list each time and replaces what was there,
 * while `TaskCreate` and `TaskUpdate` change one line each. A call that does not
 * parse changes nothing — the list before it is still the best account there is.
 *
 * A created task joins only once its result names its id: that id is what every
 * later update refers to it by, and it exists nowhere in the call itself. An
 * update to an id never seen is dropped; there is no line for it to change.
 *
 * Null when the agent never kept a list.
 */
export function latestTodos(entries: readonly ChatEntry[]): Todo[] | null {
  let list: Map<string, Todo> | null = null
  // Created tasks waiting for the result that names their id, by call.
  const creating = new Map<string, Todo>()

  for (const entry of entries) {
    if (entry.role !== 'agent') continue
    const { event } = entry
    if (event.type !== 'tool_use' && event.type !== 'tool_result') continue

    // A subagent keeps a list of its own for its own task. It is not the
    // conversation's, and its calls would otherwise rewrite it.
    if (event.parentToolUseId !== undefined) continue

    if (event.type === 'tool_result') {
      const created = creating.get(event.toolUseId)
      if (created !== undefined && event.taskId !== undefined) {
        list ??= new Map()
        list.set(event.taskId, created)
      }
      continue
    }

    // Keyed apart from task ids, which are "1", "2"… as well.
    const whole = readTodos(event.name, event.input)
    if (whole !== null) list = new Map(whole.map((todo, index) => [`todo-${String(index)}`, todo]))

    const created = readCreated(event.name, event.input)
    if (created !== null) creating.set(event.toolUseId, created)

    if (list !== null) applyUpdate(list, event.name, event.input)
  }

  return list === null ? null : [...list.values()]
}

/** The line a `TaskCreate` call adds, once its id is known. */
function readCreated(toolName: string, input: unknown): Todo | null {
  if (toolName !== TASK_CREATE) return null

  const parsed = TaskCreateSchema.safeParse(input)
  if (!parsed.success) return null

  return { content: parsed.data.subject, status: 'pending', activeForm: parsed.data.activeForm }
}

/** What a `TaskUpdate` call changes: the fields it names, or the whole line. */
function applyUpdate(list: Map<string, Todo>, toolName: string, input: unknown): void {
  if (toolName !== TASK_UPDATE) return

  const parsed = TaskUpdateSchema.safeParse(input)
  if (!parsed.success) return

  const { taskId, subject, activeForm, status } = parsed.data
  const current = list.get(taskId)
  if (current === undefined) return

  if (status === 'deleted') {
    list.delete(taskId)
    return
  }

  list.set(taskId, {
    content: subject ?? current.content,
    status: status ?? current.status,
    activeForm: activeForm ?? current.activeForm
  })
}
