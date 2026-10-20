import { createContext } from 'react'

import type { TaskView } from '@core/backgroundTasks.js'
import type { ChatEntry } from '@core/transcript.js'

import { shortModel } from './agentFormat.js'

/**
 * What the conversation has running beside it, for every part of the pane
 * that draws it: the rows in the log, the question cards, the count in the
 * composer and the map it opens.
 *
 * A context rather than props, because those parts sit far apart — the rows
 * are drawn through a library's message primitives, the count three
 * components down the composer — and none of the layers between has a use for
 * it. The value moves only when a task does: the list keeps its identity while
 * the log grows (`useChatTasks`), so a new line in the log redraws no row.
 * Progress does redraw the rows, at most five times a second and only while
 * agents work.
 */
export interface Agents {
  readonly tasks: readonly TaskView[]
  readonly byToolUse: ReadonlyMap<string, TaskView>
  readonly byId: ReadonlyMap<string, TaskView>
  /**
   * Whether the main agent is mid-turn, while there are tasks to make it a
   * question — `running` may then be the agents alone.
   */
  readonly mainWorking: boolean | undefined
  /** A model id as the picker names it, or as a person would where it does not. */
  readonly modelName: (model: string) => string
  readonly onStop: (taskId: string) => void
  /** Brings the row that started an agent into view in the log. */
  readonly onShow: (toolUseId: string) => void
}

// Never called: with no tasks there is no row to stop or bring into view.
/* v8 ignore next */
const ignore = (): void => undefined

export const NO_AGENTS: Agents = {
  tasks: [],
  byToolUse: new Map(),
  byId: new Map(),
  mainWorking: undefined,
  modelName: shortModel,
  onStop: ignore,
  onShow: ignore
}

export const AgentsContext = createContext<Agents>(NO_AGENTS)

/**
 * The log, for the map's detail — what an agent was asked and its last steps.
 *
 * Apart from `AgentsContext` because it moves with every event, and only the
 * map, when it is open, reads it: in the same value it would redraw every row.
 */
export const AgentLogContext = createContext<readonly ChatEntry[]>([])
