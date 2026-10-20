/**
 * The service's memory of what each conversation has running beside it, and
 * of whether its main agent is mid-turn — and the pushes that tell the windows.
 *
 * Kept in memory only. A task dies with the process that ran it, so there is
 * nothing here for `state.json` to hold, and nothing to give a default.
 */

import { reduceTasks, type TaskView, withWaiting } from './backgroundTasks.js'
import type { AgentEvent, TaskEnd } from './events.js'

/** What one conversation has running beside it — every task it knows of, ended ones included. */
export interface TasksEvent {
  readonly chatId: string
  readonly workspaceId: string
  readonly tasks: readonly TaskView[]
  /**
   * Whether the main agent is mid-turn.
   *
   * Said here because it is only ever in doubt while there are tasks: without
   * them the conversation's status already answers it, and with them a
   * `running` may be the agents alone — which is when the composer must offer
   * Send rather than a Stop with nothing to stop.
   */
  readonly mainWorking: boolean
}

/**
 * How long progress frames are gathered before the window is told.
 *
 * A frame arrives per tool call per agent, and a workflow runs dozens of
 * agents; a push for each redrew the map faster than anybody reads it. Short
 * enough that a row still moves with the work.
 */
export const TASK_PUSH_MS = 200

/**
 * How many ended tasks a conversation keeps in memory.
 *
 * Every push carries the whole list, and a long session of workflows would
 * make each one heavier than the last. An older one is not lost: its start and
 * end are in the transcript, which the window reads them from.
 */
export const ENDED_KEPT = 50

/** A task the event ended. */
export interface TaskEnding {
  readonly taskId: string
  readonly status: TaskEnd
}

interface Entry {
  readonly workspaceId: string
  readonly tasks: readonly TaskView[]
}

export interface TaskRegistry {
  /**
   * Folds one event in. Answers the tasks it ended, or null when it changed
   * nothing at all.
   */
  apply(
    chat: { readonly id: string; readonly workspaceId: string },
    event: AgentEvent,
    at: string
  ): readonly TaskEnding[] | null
  tasks(chatId: string): readonly TaskView[]
  /** Tells the windows soon, once the burst this is part of is over. */
  pushSoon(chatId: string): void
  turnOpen(chatId: string): boolean
  setTurnOpen(chatId: string, open: boolean): void
  /** Forgets a conversation, telling the windows so they drop its rows. */
  forget(chatId: string): void
  list(): readonly TasksEvent[]
  /** Drops every gathered push: a timer left for after a quit would hold the process open. */
  stop(): void
}

export function createTaskRegistry(options: {
  /** The background agents with a question open, by task. */
  readonly asking: (chatId: string) => ReadonlySet<string>
  readonly onSnapshot: (event: TasksEvent) => void
}): TaskRegistry {
  const entries = new Map<string, Entry>()
  const pushes = new Map<string, ReturnType<typeof setTimeout>>()
  const turns = new Set<string>()

  function snapshot(chatId: string, entry: Entry): TasksEvent {
    return {
      chatId,
      workspaceId: entry.workspaceId,
      tasks: withWaiting(entry.tasks, options.asking(chatId)),
      mainWorking: turns.has(chatId)
    }
  }

  function emit(chatId: string, entry: Entry): void {
    clearTimeout(pushes.get(chatId))
    pushes.delete(chatId)
    options.onSnapshot(snapshot(chatId, entry))
  }

  function pushSoon(chatId: string): void {
    if (!entries.has(chatId) || pushes.has(chatId)) return
    pushes.set(
      chatId,
      setTimeout(() => {
        pushes.delete(chatId)
        // Gone in the meantime: `forget` has already told the windows.
        const entry = entries.get(chatId)
        if (entry) options.onSnapshot(snapshot(chatId, entry))
      }, TASK_PUSH_MS)
    )
  }

  return {
    apply(chat, event, at) {
      const entry = entries.get(chat.id)
      const before = entry?.tasks ?? []
      const after = trimmed(reduceTasks(before, event, at))
      if (after === before) return null

      const next = { workspaceId: chat.workspaceId, tasks: after }
      entries.set(chat.id, next)
      // Progress is gathered; a task appearing or ending is said at once, and
      // before the event that records it, so the log never draws a start the
      // map has not heard of.
      if (event.type === 'task_progress') pushSoon(chat.id)
      else emit(chat.id, next)

      return endings(before, after)
    },

    tasks(chatId) {
      return entries.get(chatId)?.tasks ?? []
    },

    pushSoon,

    turnOpen(chatId) {
      return turns.has(chatId)
    },

    setTurnOpen(chatId, open) {
      if (turns.has(chatId) === open) return
      if (open) turns.add(chatId)
      else turns.delete(chatId)

      const entry = entries.get(chatId)
      if (entry) emit(chatId, entry)
    },

    forget(chatId) {
      turns.delete(chatId)
      const entry = entries.get(chatId)
      if (!entry) return

      entries.delete(chatId)
      options.onSnapshot({ chatId, workspaceId: entry.workspaceId, tasks: [], mainWorking: false })
    },

    list() {
      return [...entries].map(([chatId, entry]) => snapshot(chatId, entry))
    },

    stop() {
      for (const timer of pushes.values()) clearTimeout(timer)
      pushes.clear()
    }
  }
}

/** The tasks that were running before and are not after. */
function endings(before: readonly TaskView[], after: readonly TaskView[]): readonly TaskEnding[] {
  const wasRunning = new Set(
    before.filter((task) => task.status === 'running').map((task) => task.taskId)
  )
  return after.flatMap((task) =>
    wasRunning.has(task.taskId) && task.status !== 'running'
      ? [{ taskId: task.taskId, status: task.status }]
      : []
  )
}

/** The list without its oldest ended tasks past `ENDED_KEPT`; the same list when under it. */
function trimmed(tasks: readonly TaskView[]): readonly TaskView[] {
  const ended = tasks.filter((task) => task.status !== 'running')
  if (ended.length <= ENDED_KEPT) return tasks

  const dropped = new Set(ended.slice(0, ended.length - ENDED_KEPT))
  return tasks.filter((task) => !dropped.has(task))
}
