import { Check, Square, X } from 'lucide-react'

import type { TaskStatus, TaskView } from '@core/backgroundTasks.js'

/**
 * The word for each state, for a reader who is not shown the mark — and for
 * the detail, which says it as well as drawing it.
 */
export const STATUS_LABELS = {
  running: 'agents.statusRunning',
  completed: 'agents.statusCompleted',
  failed: 'agents.statusFailed',
  stopped: 'agents.statusStopped'
} as const satisfies Record<TaskStatus, string>

/** The word for a task as it stands — a question open outranks "working". */
export function statusLabel(
  task: Pick<TaskView, 'status' | 'waiting'>
): (typeof STATUS_LABELS)[TaskStatus] | 'agents.statusWaiting' {
  return task.waiting ? 'agents.statusWaiting' : STATUS_LABELS[task.status]
}

/** The text colour that goes with each, for the detail's status word. */
export const STATUS_TONES: Record<TaskStatus, string> = {
  running: 'text-accent',
  completed: 'text-success',
  failed: 'text-danger',
  stopped: 'text-ink-faint'
}

/**
 * A task's state as one 12px mark: a turning arc while it works, an amber dot
 * while it waits on an answer, and a tick, a cross or a square once it is over.
 *
 * Always the same box, so a list of them keeps its names in one column whatever
 * each is doing.
 */
export function AgentGlyph({
  task
}: {
  readonly task: Pick<TaskView, 'status' | 'waiting'>
}): React.JSX.Element {
  return (
    <span aria-hidden className="inline-flex size-3 shrink-0 items-center justify-center">
      {task.waiting ? (
        <span className="bg-warning size-2 rounded-full" />
      ) : task.status === 'running' ? (
        <span className="agent-arc" />
      ) : task.status === 'completed' ? (
        <Check size={11} strokeWidth={2.5} className="text-success" />
      ) : task.status === 'failed' ? (
        <X size={11} strokeWidth={2.5} className="text-danger" />
      ) : (
        <Square size={8} strokeWidth={2.5} className="text-ink-faint" />
      )}
    </span>
  )
}
