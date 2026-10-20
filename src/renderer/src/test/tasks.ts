import { byToolUse, type TaskView } from '@core/backgroundTasks.js'

import { type Agents, NO_AGENTS } from '../components/chat/agentTasks.js'

/** A subagent at work, started before `NOW`, with anything overridden. */
export function task(overrides: Partial<TaskView> = {}): TaskView {
  return {
    taskId: 't-1',
    runId: null,
    toolUseId: 'call-1',
    parentTaskId: null,
    kind: 'agent',
    description: 'Audit route handlers',
    subagentType: 'Explore',
    workflowName: null,
    model: 'claude-haiku-5-5',
    backgrounded: true,
    ambient: false,
    status: 'running',
    startedAt: '2026-10-20T10:00:00.000Z',
    endedAt: null,
    activity: 'Reading src/routes/auth.ts',
    summary: null,
    tokens: 18_400,
    toolUses: 3,
    durationMs: null,
    workflow: null,
    waiting: false,
    ...overrides
  }
}

/** A minute and forty-two seconds after `task()` started. */
export const NOW = Date.parse('2026-10-20T10:01:42.000Z')

/** What `AgentsContext` holds for these tasks, as `ChatSession` builds it. */
export function agentsOf(tasks: readonly TaskView[], overrides: Partial<Agents> = {}): Agents {
  return {
    ...NO_AGENTS,
    tasks,
    byToolUse: byToolUse(tasks),
    byId: new Map(tasks.map((each) => [each.taskId, each])),
    ...overrides
  }
}
