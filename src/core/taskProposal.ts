/**
 * The tasks the board's brainstorm proposes, as its agent hands them over.
 *
 * Pure: zod and the board's own schemas, so the window reads a proposal out of
 * the log with the same rule the tool took it with.
 */
import { z } from 'zod'

import {
  CARDS_PER_BATCH,
  CardDescriptionSchema,
  CardPrioritySchema,
  CardTitleSchema
} from './boardSchema.js'
import { WorkspaceKindSchema } from './workspaceKinds.js'

/** The server octopus gives a brainstorm, and its tools, as the log names a call. */
export const PROPOSAL_SERVER = 'octopus'
export const PROPOSE_TASKS = 'propose_tasks'
export const PROPOSE_TASKS_TOOL = `mcp__${PROPOSAL_SERVER}__${PROPOSE_TASKS}`
/** Editing one card: the whole new version of it, never a second task. */
export const PROPOSE_EDIT = 'propose_edit'
export const PROPOSE_EDIT_TOOL = `mcp__${PROPOSAL_SERVER}__${PROPOSE_EDIT}`

export const ProposedTaskSchema = z.strictObject({
  title: CardTitleSchema.describe('Short, imperative, one line; also the file name'),
  description: CardDescriptionSchema.describe(
    "The task's Markdown body, written as the project's task convention says, without its title"
  ),
  priority: CardPrioritySchema.optional(),
  tag: WorkspaceKindSchema.optional()
})

const SummarySchema = z.string().trim().min(1).max(4000)

/** Shapes rather than schemas, because the SDK's `tool()` takes one. */
export const TASK_PROPOSAL_SHAPE = {
  summary: SummarySchema.describe(
    'Why the work is one task or split this way, in a sentence or two'
  ),
  tasks: z.array(ProposedTaskSchema).min(1).max(CARDS_PER_BATCH)
}
export const EDIT_PROPOSAL_SHAPE = {
  summary: SummarySchema.describe('What changed in the task, and why, in a sentence or two'),
  task: ProposedTaskSchema
}
export const TaskProposalSchema = z.strictObject(TASK_PROPOSAL_SHAPE)
const EditProposalSchema = z.strictObject(EDIT_PROPOSAL_SHAPE)

export type ProposedTask = z.infer<typeof ProposedTaskSchema>
export type TaskProposal = z.infer<typeof TaskProposalSchema>

/**
 * The proposal in a tool call, or null when it is not one; an edit reads as a list of one.
 *
 * Null too for one the tool refused: the SDK checks the call against the same
 * schema and hands the error back to the agent, which then proposes again.
 */
export function readProposal(toolName: string, input: unknown): TaskProposal | null {
  if (toolName === PROPOSE_EDIT_TOOL) {
    const edit = EditProposalSchema.safeParse(input)
    return edit.success ? { summary: edit.data.summary, tasks: [edit.data.task] } : null
  }
  if (toolName !== PROPOSE_TASKS_TOOL) return null
  const parsed = TaskProposalSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

/** A message that also tells the agent what the person changed by hand since it last proposed. */
export function withEditedTasks(text: string, tasks: readonly ProposedTask[]): string {
  const json = JSON.stringify(tasks, null, 2)
  return `${text}\n\nI edited your proposal by hand. These are the tasks as they stand now:\n\n\`\`\`json\n${json}\n\`\`\``
}
