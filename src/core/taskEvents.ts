/**
 * The SDK's background-task messages, as agent events.
 *
 * Five system subtypes describe one thing — a subagent, a shell command or a
 * workflow running beside the conversation — and they overlap: a background
 * task's end arrives as a `task_updated` patch **and** as a notification, in
 * that order, measured against a live session. Both become `task_ended`, and
 * the registry that reads them treats the second as the no-op it is.
 */

import type {
  SDKBackgroundTasksChangedMessage,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

import type { AgentEvent, TaskEnd, TaskKind, WorkflowAgent, WorkflowProgress } from './events.js'

const KINDS: Readonly<Record<string, TaskKind>> = {
  local_agent: 'agent',
  local_bash: 'shell',
  local_workflow: 'workflow'
}

function kindOf(taskType: string | undefined): TaskKind {
  return (taskType === undefined ? undefined : KINDS[taskType]) ?? 'other'
}

export function taskStarted(message: SDKTaskStartedMessage): AgentEvent {
  const kind = kindOf(message.task_type)
  return {
    type: 'task_started',
    taskId: message.task_id,
    kind,
    description: message.description,
    // The SDK sets the flag for agents and commands only. A workflow never
    // blocks the call that launched it — measured: its result is
    // `async_launched` — so it is background work whatever the flag says.
    backgrounded: message.is_backgrounded === true || kind === 'workflow',
    ...(message.run_id !== undefined && { runId: message.run_id }),
    // Either flag says the same thing — not activity — and the SDK sets one or
    // the other depending on the kind of housekeeping.
    ambient: message.ambient === true || message.skip_transcript === true,
    ...(message.tool_use_id !== undefined && { toolUseId: message.tool_use_id }),
    ...(message.subagent_type !== undefined && { subagentType: message.subagent_type }),
    ...(message.parent_task_id !== undefined && { parentTaskId: message.parent_task_id }),
    ...(message.workflow_name !== undefined && { workflowName: message.workflow_name })
  }
}

export function taskProgress(message: SDKTaskProgressMessage): AgentEvent {
  const workflow = readWorkflowProgress(
    (message as { workflow_progress?: unknown }).workflow_progress
  )

  return {
    type: 'task_progress',
    taskId: message.task_id,
    ...(message.run_id !== undefined && { runId: message.run_id }),
    tokens: message.usage.total_tokens,
    toolUses: message.usage.tool_uses,
    durationMs: message.usage.duration_ms,
    // The progress frame's `description` is not the task's: it is the step
    // under way, rewritten on every frame ("Reading src/b/index.ts").
    ...(message.description !== '' && { activity: message.description }),
    ...(message.summary !== undefined && message.summary !== '' && { summary: message.summary }),
    ...(workflow !== null && { workflow })
  }
}

export function taskNotification(message: SDKTaskNotificationMessage): AgentEvent {
  return {
    type: 'task_ended',
    taskId: message.task_id,
    status: message.status,
    ...(message.run_id !== undefined && { runId: message.run_id }),
    ...(message.summary !== '' && { summary: message.summary }),
    ...(message.usage !== undefined && {
      tokens: message.usage.total_tokens,
      toolUses: message.usage.tool_uses,
      durationMs: message.usage.duration_ms
    })
  }
}

const ENDINGS: Readonly<Record<string, TaskEnd>> = {
  completed: 'completed',
  failed: 'failed',
  killed: 'stopped'
}

/**
 * A patch, as an end when it is one and nothing otherwise.
 *
 * Read because not every task sends a notification: the SDK says a background
 * task may report its end only this way, and without it such a task would run
 * for ever in the window.
 */
export function taskUpdated(message: SDKTaskUpdatedMessage): AgentEvent[] {
  const status = message.patch.status === undefined ? undefined : ENDINGS[message.patch.status]
  if (status === undefined) return []
  return [
    {
      type: 'task_ended',
      taskId: message.task_id,
      status,
      ...(message.run_id !== undefined && { runId: message.run_id })
    }
  ]
}

export function backgroundTasks(message: SDKBackgroundTasksChangedMessage): AgentEvent {
  return { type: 'background_tasks', taskIds: message.tasks.map((task) => task.task_id) }
}

const Count = z.number().nonnegative()

const PhaseEntry = z.object({
  type: z.literal('workflow_phase'),
  index: z.number().int(),
  title: z.string()
})

const AgentEntry = z.object({
  type: z.literal('workflow_agent'),
  index: z.number().int(),
  label: z.string(),
  phaseIndex: z.number().int().optional(),
  state: z.string(),
  model: z.string().optional(),
  tokens: Count.optional(),
  toolCalls: z.number().int().nonnegative().optional(),
  durationMs: Count.optional(),
  lastToolName: z.string().optional()
})

/**
 * The workflow's progress, which the SDK sends but does not type.
 *
 * Every field is read as optional and each entry on its own, so an entry this
 * build cannot read is skipped rather than costing the whole frame — and a
 * frame with nothing readable is no progress at all rather than an error.
 */
function readWorkflowProgress(raw: unknown): WorkflowProgress | null {
  if (!Array.isArray(raw)) return null

  const phases: WorkflowProgress['phases'][number][] = []
  const agents: WorkflowAgent[] = []

  for (const entry of raw) {
    const phase = PhaseEntry.safeParse(entry)
    if (phase.success) {
      phases.push({ index: phase.data.index, title: phase.data.title })
      continue
    }

    const agent = AgentEntry.safeParse(entry)
    if (!agent.success) continue
    const { data } = agent
    agents.push({
      index: data.index,
      label: data.label,
      phase: data.phaseIndex ?? null,
      state: data.state,
      model: data.model ?? null,
      tokens: data.tokens ?? null,
      toolCalls: data.toolCalls ?? null,
      durationMs: data.durationMs ?? null,
      lastTool: data.lastToolName ?? null
    })
  }

  return phases.length === 0 && agents.length === 0 ? null : { phases, agents }
}
