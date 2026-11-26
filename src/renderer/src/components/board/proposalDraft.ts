import type { CardDraft, CardPriority, ColumnId } from '@core/boardSchema.js'
import type { ProposedTask, TaskProposal } from '@core/taskProposal.js'
import type { WorkspaceKind } from '@core/workspaceKinds.js'

export interface DraftTask {
  /** Its place in the proposal it came from: a row keeps its own editor through a move. */
  readonly key: number
  readonly title: string
  readonly description: string
  readonly priority: CardPriority | null
  readonly tag: WorkspaceKind | null
  readonly status: ColumnId
}

export function draftTasks(proposal: TaskProposal, status: ColumnId): DraftTask[] {
  return proposal.tasks.map((task, key) => ({
    key,
    title: task.title,
    description: task.description,
    priority: task.priority ?? null,
    tag: task.tag ?? null,
    status
  }))
}

function proposedTask({ title, description, priority, tag }: DraftTask): ProposedTask {
  // Named, not spread: `key` and `status` are the window's, and the agent is told neither.
  return {
    title,
    description,
    ...(priority !== null && { priority }),
    ...(tag !== null && { tag })
  }
}

export function proposedOf(tasks: readonly DraftTask[]): ProposedTask[] {
  return tasks.map(proposedTask)
}

export function cardDraftsOf(tasks: readonly DraftTask[]): CardDraft[] {
  return tasks.map((task) => ({ ...proposedTask(task), status: task.status }))
}

export function withTask(
  tasks: readonly DraftTask[],
  index: number,
  change: Partial<DraftTask>
): DraftTask[] {
  return tasks.map((task, at) => (at === index ? { ...task, ...change } : task))
}
