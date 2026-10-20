/**
 * How an agent's facts read on screen: its time, its model, its kind.
 *
 * Kept apart from the components because the map, its detail and the row in
 * the log all say the same three things and must say them alike.
 */

import type { TFunction } from 'i18next'

import type { TaskView } from '@core/backgroundTasks.js'

/**
 * Elapsed time as a clock reads: `0:07`, `1:42`, `1:05:03`.
 *
 * A clock rather than `1m 42s`, because these tick while they are read and a
 * clock's digits stay where they are — with `tabular-nums` a column of them
 * lines up, where words shift by a character every ten seconds.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')

  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${String(minutes)}:${seconds}`
}

/**
 * How long a task has run, or ran.
 *
 * A running one is counted on the window's clock so it ticks; an ended one
 * takes the CLI's own figure where it gave one, which leaves out the time it
 * spent paused.
 */
export function elapsedOf(task: TaskView, now: number): number {
  const started = Date.parse(task.startedAt)
  if (task.status === 'running') return now - started
  if (task.durationMs !== null) return task.durationMs
  return task.endedAt === null ? 0 : Date.parse(task.endedAt) - started
}

/**
 * A model id as a person names it: `claude-haiku-5-5` is Haiku 5.5.
 *
 * The family is the word after `claude-`, and the version is the run of short
 * numbers after it; a date stamp and a bracketed context size are dropped. An
 * id that is not shaped like that — an alias, a provider's own — is shown as
 * it came rather than guessed at.
 */
export function shortModel(id: string): string {
  const bare = id.replace(/\[.*\]$/, '')
  const match = /^claude-([a-z]+)((?:-\d{1,2})+)(?:-\d{8})?$/.exec(bare)
  if (match === null) return bare

  const [, family = '', version = ''] = match
  const number = version.slice(1).split('-').join('.')
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${number}`
}

/** What kind of worker it is: the subagent's type, or what else it is. */
export function kindLabel(task: TaskView, t: TFunction): string {
  if (task.subagentType !== null) return task.subagentType
  if (task.kind === 'shell') return t('agents.kindShell')
  if (task.kind === 'workflow') return t('agents.kindWorkflow')
  return t('agents.kindOther')
}

/** The task's name for a reader: its own description, or a workflow's name. */
export function nameOf(task: TaskView): string {
  return task.description === '' ? (task.workflowName ?? task.taskId) : task.description
}

/** What it is doing now, in the fewest words that say so. */
export function activityOf(task: TaskView): string | null {
  return task.summary ?? task.activity
}
