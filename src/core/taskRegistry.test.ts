import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentEvent } from './events.js'
import { createTaskRegistry, ENDED_KEPT, TASK_PUSH_MS, type TasksEvent } from './taskRegistry.js'

const AT = '2026-10-20T10:00:00.000Z'
const CHAT = { id: 'c-1', workspaceId: 'planner/anna' }

const start = (taskId: string): AgentEvent => ({
  type: 'task_started',
  taskId,
  kind: 'agent',
  description: taskId,
  backgrounded: true,
  ambient: false
})

const end = (taskId: string): AgentEvent => ({ type: 'task_ended', taskId, status: 'completed' })

const step = (taskId: string): AgentEvent => ({
  type: 'task_progress',
  taskId,
  tokens: 1,
  toolUses: 1,
  durationMs: 1
})

function registry(asking: ReadonlySet<string> = new Set()): {
  readonly tasks: ReturnType<typeof createTaskRegistry>
  readonly pushed: TasksEvent[]
} {
  const pushed: TasksEvent[] = []
  const tasks = createTaskRegistry({ asking: () => asking, onSnapshot: (e) => pushed.push(e) })
  return { tasks, pushed }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('what a conversation has running beside it', () => {
  it('says a start or an end at once, and answers what ended', () => {
    const { tasks, pushed } = registry()

    expect(tasks.apply(CHAT, start('a'), AT)).toEqual([])
    expect(tasks.apply(CHAT, end('a'), AT)).toEqual([{ taskId: 'a', status: 'completed' }])
    expect(pushed.map((event) => event.tasks[0]?.status)).toEqual(['running', 'completed'])
  })

  it('answers null for an event that moves nothing', () => {
    const { tasks, pushed } = registry()
    expect(tasks.apply(CHAT, { type: 'text', text: 'hi' }, AT)).toBeNull()
    expect(pushed).toEqual([])
  })

  it('gathers a burst of progress into one push', () => {
    const { tasks, pushed } = registry()
    tasks.apply(CHAT, start('a'), AT)
    pushed.length = 0

    tasks.apply(CHAT, step('a'), AT)
    tasks.apply(CHAT, { ...step('a'), tokens: 2 } as AgentEvent, AT)
    expect(pushed).toEqual([])

    vi.advanceTimersByTime(TASK_PUSH_MS)
    expect(pushed.map((event) => event.tasks[0]?.tokens)).toEqual([2])
  })

  it('marks the agents with a question open', () => {
    const { tasks } = registry(new Set(['a']))
    tasks.apply(CHAT, start('a'), AT)
    expect(tasks.list()[0]?.tasks[0]?.waiting).toBe(true)
  })

  // Every push carries the whole list; the transcript keeps the older ones.
  it('keeps only the newest ended tasks', () => {
    const { tasks } = registry()
    for (let index = 0; index <= ENDED_KEPT; index++) {
      tasks.apply(CHAT, start(`t-${String(index)}`), AT)
      tasks.apply(CHAT, end(`t-${String(index)}`), AT)
    }
    tasks.apply(CHAT, start('live'), AT)

    const kept = tasks.tasks(CHAT.id).map((task) => task.taskId)
    expect(kept).toHaveLength(ENDED_KEPT + 1)
    expect(kept).not.toContain('t-0')
    expect(kept).toContain('live')
  })
})

describe('whether the main agent is mid-turn', () => {
  it('is said with the tasks, and only when it changes', () => {
    const { tasks, pushed } = registry()
    tasks.apply(CHAT, start('a'), AT)
    pushed.length = 0

    tasks.setTurnOpen(CHAT.id, true)
    tasks.setTurnOpen(CHAT.id, true)
    tasks.setTurnOpen(CHAT.id, false)

    expect(pushed.map((event) => event.mainWorking)).toEqual([true, false])
    expect(tasks.turnOpen(CHAT.id)).toBe(false)
  })

  // Without tasks the conversation's status says it already.
  it('is not pushed for a conversation with no tasks', () => {
    const { tasks, pushed } = registry()
    tasks.setTurnOpen(CHAT.id, true)
    expect(tasks.turnOpen(CHAT.id)).toBe(true)
    expect(pushed).toEqual([])
  })
})

describe('forgetting a conversation', () => {
  it('tells the windows to drop its rows, and its turn with it', () => {
    const { tasks, pushed } = registry()
    tasks.apply(CHAT, start('a'), AT)
    tasks.setTurnOpen(CHAT.id, true)
    pushed.length = 0

    tasks.forget(CHAT.id)
    tasks.forget(CHAT.id)

    expect(pushed).toEqual([
      { chatId: CHAT.id, workspaceId: CHAT.workspaceId, tasks: [], mainWorking: false }
    ])
    expect(tasks.turnOpen(CHAT.id)).toBe(false)
    expect(tasks.list()).toEqual([])
  })

  it('sends no gathered push for a conversation forgotten meanwhile', () => {
    const { tasks, pushed } = registry()
    tasks.apply(CHAT, start('a'), AT)
    tasks.pushSoon(CHAT.id)
    tasks.forget(CHAT.id)
    pushed.length = 0

    vi.advanceTimersByTime(TASK_PUSH_MS)
    expect(pushed).toEqual([])
  })

  // A timer left for after a quit would hold the process open.
  it('drops every gathered push when told to stop', () => {
    const { tasks, pushed } = registry()
    tasks.apply(CHAT, start('a'), AT)
    tasks.pushSoon(CHAT.id)
    pushed.length = 0

    tasks.stop()
    vi.advanceTimersByTime(TASK_PUSH_MS)
    expect(pushed).toEqual([])
  })
})
