/**
 * What is running beside a conversation: its subagents, background commands
 * and workflows, folded out of the event stream.
 *
 * Pure, and free of Node, so the window reads the same function the service
 * does — the service over live events for the map, the window over a reopened
 * transcript for the rows a restart left behind.
 */

import type { AgentEvent, TaskEnd, TaskKind, WorkflowAgent, WorkflowProgress } from './events.js'

export type TaskStatus = 'running' | TaskEnd

export interface TaskView {
  readonly taskId: string
  /** The run under way; frames from another run of the same task are late. Null on an older CLI. */
  readonly runId: string | null
  /** The call that started it, which the log draws it under. */
  readonly toolUseId: string | null
  /** The subagent that started this one, for a nested spawn. */
  readonly parentTaskId: string | null
  readonly kind: TaskKind
  readonly description: string
  readonly subagentType: string | null
  readonly workflowName: string | null
  /** As the CLI resolved it — known from the call's result, a moment after the start. */
  readonly model: string | null
  readonly backgrounded: boolean
  readonly ambient: boolean
  readonly status: TaskStatus
  readonly startedAt: string
  readonly endedAt: string | null
  /** The step under way, in the CLI's words. */
  readonly activity: string | null
  /** The model's sentence about the whole, or the report's opening once it ends. */
  readonly summary: string | null
  readonly tokens: number
  readonly toolUses: number
  /** The CLI's own count, which pauses do not inflate. Null until it says. */
  readonly durationMs: number | null
  readonly workflow: WorkflowProgress | null
  /** A permission question from this task is open. Set by whoever holds the questions. */
  readonly waiting: boolean
}

function started(event: Extract<AgentEvent, { type: 'task_started' }>, at: string): TaskView {
  return {
    taskId: event.taskId,
    runId: event.runId ?? null,
    toolUseId: event.toolUseId ?? null,
    parentTaskId: event.parentTaskId ?? null,
    kind: event.kind,
    description: event.description,
    subagentType: event.subagentType ?? null,
    workflowName: event.workflowName ?? null,
    model: null,
    backgrounded: event.backgrounded,
    ambient: event.ambient,
    status: 'running',
    startedAt: at,
    endedAt: null,
    activity: null,
    summary: null,
    tokens: 0,
    toolUses: 0,
    durationMs: null,
    workflow: null,
    waiting: false
  }
}

/** The list with one task changed, or the same list when `change` left it alone. */
function patch(
  tasks: readonly TaskView[],
  taskId: string,
  change: (task: TaskView) => TaskView
): readonly TaskView[] {
  return unlessSame(
    tasks,
    tasks.map((task) => (task.taskId === taskId ? change(task) : task))
  )
}

/** `next`, unless it holds exactly the tasks already in `tasks`, in order. */
function unlessSame(tasks: readonly TaskView[], next: readonly TaskView[]): readonly TaskView[] {
  return next.length !== tasks.length || next.some((task, index) => task !== tasks[index])
    ? next
    : tasks
}

/** Whether a frame belongs to the task's current run. A frame that names none is taken. */
function ofThisRun(task: TaskView, runId: string | undefined): boolean {
  return runId === undefined || task.runId === null || task.runId === runId
}

/** `tasks` with every running one that `ends` picks out ended. */
function endWhere(
  tasks: readonly TaskView[],
  ends: (task: TaskView) => boolean,
  status: TaskEnd,
  at: string
): readonly TaskView[] {
  return unlessSame(
    tasks,
    tasks.map((task) => (task.status === 'running' && ends(task) ? ended(task, status, at) : task))
  )
}

function ended(task: TaskView, status: TaskEnd, at: string): TaskView {
  return { ...task, status, endedAt: at, activity: null, waiting: false }
}

/**
 * The tasks after one more event.
 *
 * Answers the very list it was given when the event changes nothing, which is
 * most of them — text, tool rows, the turn's own result — so a caller can tell
 * "nothing moved" by identity and skip announcing it.
 */
export function reduceTasks(
  tasks: readonly TaskView[],
  event: AgentEvent,
  at: string
): readonly TaskView[] {
  switch (event.type) {
    case 'task_started': {
      // A resumed task keeps its id and starts a new run: the row starts over
      // rather than gaining a second one.
      const fresh = started(event, at)
      return tasks.some((task) => task.taskId === event.taskId)
        ? patch(tasks, event.taskId, (task) => ({ ...fresh, model: task.model }))
        : [...tasks, fresh]
    }

    case 'task_progress':
      return patch(tasks, event.taskId, (task) =>
        task.status !== 'running' || !ofThisRun(task, event.runId)
          ? task
          : {
              ...task,
              tokens: event.tokens,
              toolUses: event.toolUses,
              durationMs: event.durationMs,
              activity: event.activity ?? task.activity,
              summary: event.summary ?? task.summary,
              workflow: event.workflow ?? task.workflow
            }
      )

    // The patch and the notification both end a background task, a moment
    // apart; whichever arrives second finds it ended and leaves it — except to
    // add the totals and the report, which only the notification carries.
    case 'task_ended':
      return patch(tasks, event.taskId, (task) => {
        if (!ofThisRun(task, event.runId)) return task
        const base = task.status === 'running' ? ended(task, event.status, at) : task
        const totals = {
          ...(event.tokens !== undefined && { tokens: event.tokens }),
          ...(event.toolUses !== undefined && { toolUses: event.toolUses }),
          ...(event.durationMs !== undefined && { durationMs: event.durationMs }),
          ...(event.summary !== undefined && { summary: event.summary })
        }
        return base === task && Object.keys(totals).length === 0 ? task : { ...base, ...totals }
      })

    /*
     * The CLI's own list of what is alive. A background task missing from it
     * has ended whether or not its end was announced, so it is settled here —
     * as completed, because nothing says otherwise. A foreground subagent was
     * never on the list, so its absence says nothing; one that turns up on it
     * has been moved to the background, and is counted as such from then on.
     */
    case 'background_tasks': {
      const alive = new Set(event.taskIds)
      const moved = unlessSame(
        tasks,
        tasks.map((task) =>
          alive.has(task.taskId) && !task.backgrounded ? { ...task, backgrounded: true } : task
        )
      )
      return endWhere(
        moved,
        (task) => task.backgrounded && !alive.has(task.taskId),
        'completed',
        at
      )
    }

    /*
     * A foreground subagent holds the call that started it, so the turn cannot
     * end with it still going — whatever was said about its end is said by
     * now. Only the main agent's own: one a background agent started belongs
     * to that agent's work, which the turn's end does not touch.
     */
    case 'result':
      return endWhere(
        tasks,
        (task) => !task.backgrounded && task.parentTaskId === null,
        event.ok ? 'completed' : 'stopped',
        at
      )

    // The call's result names the model the CLI picked for the subagent.
    case 'tool_result': {
      const model = event.stats?.model
      if (model === undefined) return tasks
      const owner = tasks.find((task) => task.toolUseId === event.toolUseId)
      return owner === undefined
        ? tasks
        : patch(tasks, owner.taskId, (task) => (task.model === model ? task : { ...task, model }))
    }

    // The session went down, and everything it was running went with it.
    case 'error':
      return endWhere(tasks, () => true, 'stopped', at)

    default:
      return tasks
  }
}

/** Every task one transcript describes, as far as a transcript can. */
export function tasksFrom(
  entries: readonly { readonly at: string; readonly event: AgentEvent }[]
): readonly TaskView[] {
  return entries.reduce<readonly TaskView[]>(
    (tasks, entry) => reduceTasks(tasks, entry.event, entry.at),
    []
  )
}

/**
 * The tasks a conversation shows: the live ones, then those its transcript
 * remembers and the live list does not — a run from before a restart.
 *
 * One of those still marked running was cut off when its process went, so it
 * reads as stopped rather than spinning for ever. Nothing races this: the
 * service tells the window about a start before it records it.
 */
export function withHistory(
  live: readonly TaskView[],
  history: readonly TaskView[]
): readonly TaskView[] {
  const known = new Set(live.map((task) => task.taskId))
  const past = history
    .filter((task) => !known.has(task.taskId))
    .map((task) => (task.status === 'running' ? { ...task, status: 'stopped' as const } : task))
  return past.length === 0 ? live : [...live, ...past]
}

/** The tasks by the call that started them, which is how a row in the log finds its own. */
export function byToolUse(tasks: readonly TaskView[]): ReadonlyMap<string, TaskView> {
  const found = new Map<string, TaskView>()
  for (const task of tasks) if (task.toolUseId !== null) found.set(task.toolUseId, task)
  return found
}

/**
 * Whether two lists say the same thing, field for field.
 *
 * A list folded again from the transcript is new objects throughout, so this
 * is what lets a caller keep the one it had — and spare everything drawn from
 * it a redraw — when nothing in it moved.
 */
export function sameTasks(a: readonly TaskView[], b: readonly TaskView[]): boolean {
  return (
    a.length === b.length &&
    a.every((task, index) => {
      const other = b[index]
      return (
        other !== undefined &&
        (task === other ||
          (Object.keys(task) as (keyof TaskView)[]).every((key) => task[key] === other[key]))
      )
    })
  )
}

/** The tasks a person is shown: all but the CLI's own housekeeping. */
export function visibleTasks(tasks: readonly TaskView[]): readonly TaskView[] {
  return tasks.filter((task) => !task.ambient)
}

/**
 * The calls that started the agents above one — its parent's, that one's
 * parent's, and so on up — which is what has to be open in the log for the
 * agent's own row to be drawn.
 */
export function callsAbove(tasks: readonly TaskView[], toolUseId: string): ReadonlySet<string> {
  const above = new Set<string>()
  const seen = new Set<string>()
  let parent = tasks.find((task) => task.toolUseId === toolUseId)?.parentTaskId ?? null

  while (parent !== null && !seen.has(parent)) {
    seen.add(parent)
    const task = tasks.find((each) => each.taskId === parent)
    if (task === undefined) break
    if (task.toolUseId !== null) above.add(task.toolUseId)
    parent = task.parentTaskId
  }
  return above
}

/** What counts as activity: running, and not the CLI's own housekeeping. */
export function isLive(task: TaskView): boolean {
  return task.status === 'running' && !task.ambient
}

export function liveCount(tasks: readonly TaskView[]): number {
  return tasks.filter(isLive).length
}

/**
 * How many agents are at work — what a count that says "agents" counts.
 *
 * A command left running is work too, and keeps a conversation busy, but
 * calling it an agent would be a small lie on every screen that shows it. A
 * workflow counts as the agents it has going, which is what an ultracode run
 * looks like from outside: one task, a dozen agents.
 */
export function liveAgents(tasks: readonly TaskView[]): number {
  return tasks
    .filter((task) => isLive(task) && task.kind !== 'shell')
    .reduce((count, task) => {
      const inside = task.workflow === null ? 0 : workflowRunning(task.workflow.agents)
      return count + Math.max(1, inside)
    }, 0)
}

/** Marks the tasks with an open question, leaving the list as it was when none changes. */
export function withWaiting(
  tasks: readonly TaskView[],
  asking: ReadonlySet<string>
): readonly TaskView[] {
  return unlessSame(
    tasks,
    tasks.map((task) => {
      const waiting = task.status === 'running' && asking.has(task.taskId)
      return task.waiting === waiting ? task : { ...task, waiting }
    })
  )
}

const ORDER: Readonly<Record<TaskStatus, number>> = {
  running: 0,
  failed: 1,
  stopped: 2,
  completed: 3
}

/** One task with the ones it started, as the map draws them. */
export interface TaskNode {
  readonly task: TaskView
  readonly children: readonly TaskNode[]
}

/**
 * The tasks as a tree: each under the subagent that started it, working ones
 * first, then the failures worth a look, then the rest, each group oldest
 * first. A parent that is not in the list — ended long ago, or ambient — leaves
 * its child at the top rather than hiding it.
 */
export function taskTree(tasks: readonly TaskView[]): readonly TaskNode[] {
  const shown = visibleTasks(tasks)
  const ids = new Set(shown.map((task) => task.taskId))
  const sorted = [...shown].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || a.startedAt.localeCompare(b.startedAt)
  )

  const build = (parent: string | null): TaskNode[] =>
    sorted
      .filter((task) =>
        parent === null
          ? task.parentTaskId === null || !ids.has(task.parentTaskId)
          : task.parentTaskId === parent
      )
      .map((task) => ({ task, children: build(task.taskId) }))

  return build(null)
}

/** The states a workflow agent ends in, as task statuses. */
const WORKFLOW_ENDINGS: ReadonlyMap<string, TaskEnd> = new Map([
  ['done', 'completed'],
  ['failed', 'failed'],
  ['error', 'failed'],
  ['stopped', 'stopped'],
  ['skipped', 'stopped']
])

/** Where a workflow agent stands. A state this build has not seen reads as still going. */
export function workflowAgentStatus(agent: WorkflowAgent): TaskStatus {
  return WORKFLOW_ENDINGS.get(agent.state) ?? 'running'
}

/** How many workflow agents are still going. */
export function workflowRunning(agents: readonly WorkflowAgent[]): number {
  return agents.filter((agent) => workflowAgentStatus(agent) === 'running').length
}
