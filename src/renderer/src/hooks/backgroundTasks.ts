/**
 * What every conversation has running beside it, as the core last said.
 *
 * One store for the window rather than a hook's state per pane: the composer's
 * count, the agent map, the rows in the log and the workspace list all read the
 * same tasks, and the workspace list reads them for conversations no pane has
 * open. Module state, as `chatEvents.ts` is, for the same reason — there is one
 * bridge, and nothing here belongs to a React tree.
 *
 * The bridge is taken when the first reader arrives and given back with the
 * last, and the list is read once on the way in: a push says everything about
 * one conversation, so it always wins over a list that was asked for earlier.
 */

import { useMemo, useSyncExternalStore } from 'react'

import {
  liveAgents,
  sameTasks,
  type TaskView,
  tasksFrom,
  withHistory
} from '@core/backgroundTasks.js'
import type { TasksEvent } from '@core/service.js'
import type { ChatEntry } from '@core/transcript.js'

import { useSameValue } from './useSameValue.js'

const NONE: readonly TaskView[] = []

let byChat: ReadonlyMap<string, TasksEvent> = new Map()
const readers = new Set<() => void>()
let release: (() => void) | null = null
/**
 * Which taking of the bridge a list answers for. A list that lands after the
 * last reader has gone — or after StrictMode's second subscribe asked again —
 * would put back what belongs to nobody.
 */
let generation = 0

function store(event: TasksEvent): void {
  const next = new Map(byChat)
  if (event.tasks.length === 0) next.delete(event.chatId)
  else next.set(event.chatId, event)
  byChat = next
  // Copied for the reason `chatEvents.ts` gives: a reader may leave mid-call.
  for (const reader of [...readers]) reader()
}

function subscribe(reader: () => void): () => void {
  readers.add(reader)

  if (release === null) {
    const taken = ++generation
    const pushed = new Set<string>()
    release = window.octopus.tasks.onChanged((event) => {
      pushed.add(event.chatId)
      store(event)
    })

    void window.octopus.tasks.list().then((result) => {
      if (taken !== generation || !result.ok) return
      for (const event of result.value) if (!pushed.has(event.chatId)) store(event)
    })
  }

  return () => {
    readers.delete(reader)
    if (readers.size > 0) return

    release?.()
    release = null
    generation++
    byChat = new Map()
  }
}

/**
 * A conversation's tasks: the live ones, then those only its transcript
 * remembers — a run from before a restart, or one older than the core keeps.
 *
 * The same list for as long as nothing in it moves. The log grows with every
 * event, and a list rebuilt each time would redraw every row reading it.
 */
export function useChatTasks(chatId: string, entries: readonly ChatEntry[]): readonly TaskView[] {
  const live = useSyncExternalStore(subscribe, () => byChat.get(chatId)?.tasks ?? NONE)
  const merged = useMemo(
    () =>
      withHistory(
        live,
        tasksFrom(
          entries.flatMap((entry) =>
            entry.role === 'agent' ? [{ at: entry.at, event: entry.event }] : []
          )
        )
      ),
    [live, entries]
  )

  return useSameValue(merged, sameTasks)
}

/**
 * Whether a conversation's main agent is mid-turn, as the core says while
 * there are tasks — and undefined when there are none, where its status says.
 */
export function useMainWorking(chatId: string | null): boolean | undefined {
  return useSyncExternalStore(subscribe, () =>
    chatId === null ? undefined : byChat.get(chatId)?.mainWorking
  )
}

/** How many agents — not commands — are still working anywhere in a workspace. */
export function useWorkspaceAgents(workspaceId: string): number {
  return useSyncExternalStore(subscribe, () => {
    let count = 0
    for (const event of byChat.values()) {
      if (event.workspaceId === workspaceId) count += liveAgents(event.tasks)
    }
    return count
  })
}

/** Stops one task. What becomes of it arrives as a push, like everything else. */
export function stopTask(chatId: string, taskId: string): void {
  void window.octopus.tasks.stop(chatId, taskId)
}
