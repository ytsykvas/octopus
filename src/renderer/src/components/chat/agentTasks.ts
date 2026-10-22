import { createContext, useContext, useSyncExternalStore } from 'react'

import { byToolUse, type TaskView } from '@core/backgroundTasks.js'
import type { ChatEntry } from '@core/transcript.js'

import { shortModel } from './agentFormat.js'

/**
 * The tasks as one reading: the list, and the two ways a row looks one up.
 *
 * Built once per change rather than by every reader, so the rows that look a
 * call up share one map.
 */
export interface AgentsSnapshot {
  readonly tasks: readonly TaskView[]
  readonly byToolUse: ReadonlyMap<string, TaskView>
  readonly byId: ReadonlyMap<string, TaskView>
}

/**
 * The tasks, held where each reader can take just the part it draws.
 *
 * A value in the context itself redrew every reader whenever any task moved:
 * progress arrives for every working agent up to five times a second, and
 * each arrival redrew every tool row in the log — hundreds of them, each
 * summarising its output again — to move one line. A store the rows subscribe
 * to through `useSyncExternalStore` hands each row its own task, and React
 * redraws the row only when that object changes, which the core sees to by
 * keeping a task that did not move as the same object.
 */
export interface AgentsStore {
  readonly subscribe: (listener: () => void) => () => void
  readonly read: () => AgentsSnapshot
}

/**
 * What the conversation has running beside it, for every part of the pane
 * that draws it: the rows in the log, the question cards, the count in the
 * composer and the map it opens.
 *
 * A context rather than props, because those parts sit far apart — the rows
 * are drawn through a library's message primitives, the count three
 * components down the composer — and none of the layers between has a use for
 * it. The value itself holds still: the tasks move inside the store, and the
 * three callbacks are the pane's own, which it keeps steady. So nothing reading
 * this context is redrawn by a task moving unless it asked for that task.
 */
export interface Agents {
  readonly store: AgentsStore
  /** A model id as the picker names it, or as a person would where it does not. */
  readonly modelName: (model: string) => string
  readonly onStop: (taskId: string) => void
  /** Brings the row that started an agent into view in the log. */
  readonly onShow: (toolUseId: string) => void
}

export const NOTHING_RUNNING: AgentsSnapshot = {
  tasks: [],
  byToolUse: new Map(),
  byId: new Map()
}

/** One reading of a list, as the store holds it. */
export function snapshotOf(tasks: readonly TaskView[]): AgentsSnapshot {
  return {
    tasks,
    byToolUse: byToolUse(tasks),
    byId: new Map(tasks.map((task) => [task.taskId, task]))
  }
}

/**
 * A store the pane publishes each reading into.
 *
 * Nothing is published for a list that is the same object as the last: the
 * pane publishes from an effect on every render, and the list keeps its
 * identity while nothing in it moved (`useChatTasks`).
 */
export function createAgentsStore(
  initial: AgentsSnapshot = NOTHING_RUNNING
): AgentsStore & { readonly publish: (tasks: readonly TaskView[]) => void } {
  let snapshot = initial
  const listeners = new Set<() => void>()

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    read: () => snapshot,
    publish: (tasks) => {
      if (tasks === snapshot.tasks) return
      snapshot = snapshotOf(tasks)
      // Copied, for the reason `chatEvents.ts` gives: a reader may leave mid-call.
      for (const listener of [...listeners]) listener()
    }
  }
}

// Never called: with no tasks there is no row to stop or bring into view.
/* v8 ignore next */
const ignore = (): void => undefined

export const NO_AGENTS: Agents = {
  store: createAgentsStore(),
  modelName: shortModel,
  onStop: ignore,
  onShow: ignore
}

export const AgentsContext = createContext<Agents>(NO_AGENTS)

/** Every task of the conversation, for the parts that draw them all. */
export function useAgentTasks(): readonly TaskView[] {
  const { store } = useContext(AgentsContext)
  return useSyncExternalStore(store.subscribe, () => store.read().tasks)
}

/** The task a call started, if it started one — redrawn only when that task moves. */
export function useTaskFor(toolUseId: string): TaskView | null {
  const { store } = useContext(AgentsContext)
  return useSyncExternalStore(store.subscribe, () => store.read().byToolUse.get(toolUseId) ?? null)
}

/** One task by its id, for the parts that name one. */
export function useTaskById(taskId: string | null): TaskView | undefined {
  const { store } = useContext(AgentsContext)
  return useSyncExternalStore(store.subscribe, () =>
    taskId === null ? undefined : store.read().byId.get(taskId)
  )
}

/**
 * The log, for the map's detail — what an agent was asked and its last steps.
 *
 * Apart from `AgentsContext` because it moves with every event, and only the
 * map, when it is open, reads it: in the same value it would redraw every row.
 */
export const AgentLogContext = createContext<readonly ChatEntry[]>([])
