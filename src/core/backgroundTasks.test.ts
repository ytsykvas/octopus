import { describe, expect, it } from 'vitest'

import {
  byToolUse,
  callsAbove,
  isLive,
  liveAgents,
  liveCount,
  reduceTasks,
  type TaskView,
  taskTree,
  sameTasks,
  tasksFrom,
  visibleTasks,
  withHistory,
  withWaiting,
  workflowAgentStatus,
  workflowRunning
} from './backgroundTasks.js'
import type { AgentEvent, WorkflowAgent } from './events.js'

const T0 = '2026-10-20T10:00:00.000Z'
const T1 = '2026-10-20T10:01:00.000Z'
const T2 = '2026-10-20T10:02:00.000Z'

type Started = Extract<AgentEvent, { type: 'task_started' }>

function start(taskId: string, extra: Partial<Started> = {}): Started {
  return {
    type: 'task_started',
    taskId,
    toolUseId: `call-${taskId}`,
    kind: 'agent',
    description: `Agent ${taskId}`,
    subagentType: 'Explore',
    backgrounded: true,
    ambient: false,
    ...extra
  }
}

function fold(events: readonly AgentEvent[], at = T0): readonly TaskView[] {
  return events.reduce<readonly TaskView[]>((tasks, event) => reduceTasks(tasks, event, at), [])
}

describe('the tasks beside a conversation', () => {
  it('adds a task as it starts', () => {
    expect(fold([start('a')])).toEqual([
      {
        taskId: 'a',
        runId: null,
        toolUseId: 'call-a',
        parentTaskId: null,
        kind: 'agent',
        description: 'Agent a',
        subagentType: 'Explore',
        workflowName: null,
        model: null,
        backgrounded: true,
        ambient: false,
        status: 'running',
        startedAt: T0,
        endedAt: null,
        activity: null,
        summary: null,
        tokens: 0,
        toolUses: 0,
        durationMs: null,
        workflow: null,
        waiting: false
      }
    ])
  })

  it('keeps what a start leaves out as nothing', () => {
    const [task] = fold([
      {
        type: 'task_started',
        taskId: 'b',
        kind: 'shell',
        description: 'sleep',
        backgrounded: true,
        ambient: false
      }
    ])
    expect(task).toMatchObject({ toolUseId: null, subagentType: null, parentTaskId: null })
  })

  // A resumed task keeps its id: the row starts over rather than doubling.
  it('starts a resumed task over in its own row, keeping its model', () => {
    const tasks = fold([
      start('a'),
      {
        type: 'tool_result',
        toolUseId: 'call-a',
        ok: true,
        content: '',
        stats: { model: 'haiku' }
      },
      { type: 'task_ended', taskId: 'a', status: 'completed' },
      start('a', { description: 'Again' })
    ])

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ status: 'running', description: 'Again', model: 'haiku' })
  })

  it('moves a running task with its progress, keeping what a frame leaves out', () => {
    const tasks = fold([
      start('a'),
      {
        type: 'task_progress',
        taskId: 'a',
        activity: 'Reading a.ts',
        summary: 'Looking at the module',
        tokens: 900,
        toolUses: 1,
        durationMs: 400
      },
      { type: 'task_progress', taskId: 'a', tokens: 1800, toolUses: 2, durationMs: 800 }
    ])

    expect(tasks[0]).toMatchObject({
      activity: 'Reading a.ts',
      summary: 'Looking at the module',
      tokens: 1800,
      toolUses: 2,
      durationMs: 800
    })
  })

  it('takes a workflow’s phases and agents from its progress', () => {
    const workflow = {
      phases: [{ index: 1, title: 'read' }],
      agents: []
    }
    const tasks = fold([
      start('w', { kind: 'workflow' }),
      { type: 'task_progress', taskId: 'w', tokens: 0, toolUses: 0, durationMs: 0, workflow },
      { type: 'task_progress', taskId: 'w', tokens: 1, toolUses: 0, durationMs: 1 }
    ])

    expect(tasks[0]?.workflow).toEqual(workflow)
  })

  // A frame that arrives after the end must not bring the row back to life.
  it('ignores progress for a task that has ended', () => {
    const ended = fold([start('a'), { type: 'task_ended', taskId: 'a', status: 'completed' }])
    const after = reduceTasks(
      ended,
      {
        type: 'task_progress',
        taskId: 'a',
        activity: 'late',
        tokens: 5,
        toolUses: 1,
        durationMs: 1
      },
      T1
    )

    expect(after).toBe(ended)
  })

  it('ends a task, clearing its step and its question', () => {
    const tasks = withWaiting(fold([start('a')]), new Set(['a']))
    const [task] = reduceTasks(
      tasks,
      {
        type: 'task_ended',
        taskId: 'a',
        status: 'failed',
        summary: 'No such file',
        tokens: 10,
        toolUses: 2,
        durationMs: 30
      },
      T1
    )

    expect(task).toMatchObject({
      status: 'failed',
      endedAt: T1,
      activity: null,
      waiting: false,
      summary: 'No such file',
      tokens: 10,
      toolUses: 2,
      durationMs: 30
    })
  })

  /*
   * A background task's end arrives twice — the patch, then the
   * notification. The second keeps the first's status and time and adds only
   * the totals, which the patch never carries.
   */
  it('takes the totals from a second end and nothing else', () => {
    const once = reduceTasks(
      fold([start('a')]),
      { type: 'task_ended', taskId: 'a', status: 'completed' },
      T1
    )
    const twice = reduceTasks(
      once,
      { type: 'task_ended', taskId: 'a', status: 'stopped', tokens: 50 },
      T2
    )

    expect(twice[0]).toMatchObject({ status: 'completed', endedAt: T1, tokens: 50 })
    expect(reduceTasks(twice, { type: 'task_ended', taskId: 'a', status: 'completed' }, T2)).toBe(
      twice
    )
  })

  it('answers the same list for an end of a task it does not know', () => {
    const tasks = fold([start('a')])
    expect(reduceTasks(tasks, { type: 'task_ended', taskId: 'z', status: 'completed' }, T1)).toBe(
      tasks
    )
  })

  describe('the set the CLI says is alive', () => {
    it('ends a background task that dropped out of it unannounced', () => {
      const tasks = fold([start('a'), start('b')])
      const after = reduceTasks(tasks, { type: 'background_tasks', taskIds: ['b'] }, T1)

      expect(after.map((task) => task.status)).toEqual(['completed', 'running'])
      expect(after[0]?.endedAt).toBe(T1)
    })

    // A foreground subagent was never on the list, so missing from it means nothing.
    it('leaves a foreground task alone', () => {
      const tasks = fold([start('a', { backgrounded: false })])
      expect(reduceTasks(tasks, { type: 'background_tasks', taskIds: [] }, T1)).toBe(tasks)
    })

    it('answers the same list when everything on it is still there', () => {
      const tasks = fold([start('a')])
      expect(reduceTasks(tasks, { type: 'background_tasks', taskIds: ['a'] }, T1)).toBe(tasks)
    })

    // A subagent pushed to the background mid-run is announced only by the
    // list; without this its unannounced end would leave it running for ever.
    it('counts a task that turns up on it as background from then on', () => {
      const tasks = fold([start('a', { backgrounded: false })])
      const moved = reduceTasks(tasks, { type: 'background_tasks', taskIds: ['a'] }, T1)
      expect(moved[0]?.backgrounded).toBe(true)

      const gone = reduceTasks(moved, { type: 'background_tasks', taskIds: [] }, T2)
      expect(gone[0]).toMatchObject({ status: 'completed', endedAt: T2 })
    })
  })

  describe('the turn’s own end', () => {
    // A foreground subagent holds the call that started it: the turn cannot
    // be over with it still going.
    it('ends a foreground subagent of the main agent with it', () => {
      const tasks = fold([
        start('fg', { backgrounded: false }),
        start('bg'),
        start('nested', { backgrounded: false, parentTaskId: 'bg' })
      ])
      const ok = { type: 'result', ok: true } as const
      const after = reduceTasks(tasks, ok as AgentEvent, T1)

      expect(after.map((task) => task.status)).toEqual(['completed', 'running', 'running'])
      expect(reduceTasks(after, ok as AgentEvent, T2)).toBe(after)
    })

    it('says stopped when the turn did not end well', () => {
      const tasks = fold([start('fg', { backgrounded: false })])
      const failed = { type: 'result', ok: false } as AgentEvent
      expect(reduceTasks(tasks, failed, T1)[0]?.status).toBe('stopped')
    })
  })

  // A resumed task keeps its id: a frame from the run before is late, and must
  // not end or move the run that is going now.
  describe('a task run more than once', () => {
    const resumed = (): readonly TaskView[] =>
      fold([start('a', { runId: 'r1' }), start('a', { runId: 'r2' })])

    it('ignores the end and progress of a run that is over', () => {
      const tasks = resumed()
      const lateEnd = { type: 'task_ended', taskId: 'a', runId: 'r1', status: 'completed' } as const
      const lateStep = {
        type: 'task_progress',
        taskId: 'a',
        runId: 'r1',
        tokens: 9,
        toolUses: 9,
        durationMs: 9
      } as const

      expect(reduceTasks(tasks, lateEnd, T1)).toBe(tasks)
      expect(reduceTasks(tasks, lateStep, T1)).toBe(tasks)
    })

    it('takes the frames of the run under way, and frames that name no run', () => {
      const tasks = resumed()
      const own = { type: 'task_ended', taskId: 'a', runId: 'r2', status: 'failed' } as const
      expect(reduceTasks(tasks, own, T1)[0]?.status).toBe('failed')

      const unnamed = { type: 'task_ended', taskId: 'a', status: 'completed' } as const
      expect(reduceTasks(tasks, unnamed, T1)[0]?.status).toBe('completed')
    })
  })

  describe('the model', () => {
    it('is the one the call’s result names', () => {
      const tasks = fold([
        start('a'),
        {
          type: 'tool_result',
          toolUseId: 'call-a',
          ok: true,
          content: '',
          stats: { model: 'opus' }
        }
      ])
      expect(tasks[0]?.model).toBe('opus')
    })

    it('is left alone by a result that names none, or belongs to another call', () => {
      const tasks = fold([start('a')])
      const plain = { type: 'tool_result', toolUseId: 'call-a', ok: true, content: '' } as const
      expect(reduceTasks(tasks, plain, T1)).toBe(tasks)

      const other = { ...plain, toolUseId: 'call-z', stats: { model: 'opus' } }
      expect(reduceTasks(tasks, other, T1)).toBe(tasks)
    })

    it('is not rewritten to what it already is', () => {
      const tasks = fold([
        start('a'),
        {
          type: 'tool_result',
          toolUseId: 'call-a',
          ok: true,
          content: '',
          stats: { model: 'opus' }
        }
      ])
      const again = {
        type: 'tool_result',
        toolUseId: 'call-a',
        ok: true,
        content: '',
        stats: { model: 'opus' }
      } as const
      expect(reduceTasks(tasks, again, T1)).toBe(tasks)
    })
  })

  it('stops every running task when the session fails', () => {
    const tasks = fold([
      start('a'),
      start('b'),
      { type: 'task_ended', taskId: 'b', status: 'completed' }
    ])
    const after = reduceTasks(tasks, { type: 'error', message: 'exited' }, T1)

    expect(after.map((task) => task.status)).toEqual(['stopped', 'completed'])
    expect(reduceTasks(after, { type: 'error', message: 'again' }, T2)).toBe(after)
  })

  it('answers the same list for anything that is not about tasks', () => {
    const tasks = fold([start('a')])
    expect(reduceTasks(tasks, { type: 'text', text: 'hello' }, T1)).toBe(tasks)
  })

  // What a reopened transcript says: starts and ends, never progress.
  it('reads a transcript, leaving a task with no end running', () => {
    const tasks = tasksFrom([
      { at: T0, event: start('a') },
      { at: T0, event: start('b') },
      {
        at: T1,
        event: { type: 'task_ended', taskId: 'a', status: 'completed', durationMs: 60_000 }
      }
    ])

    expect(tasks.map((task) => [task.taskId, task.status, task.endedAt])).toEqual([
      ['a', 'completed', T1],
      ['b', 'running', null]
    ])
  })
})

describe('what counts as activity', () => {
  it('is a running task that is not housekeeping', () => {
    const tasks = fold([
      start('a'),
      start('b', { ambient: true }),
      start('c'),
      { type: 'task_ended', taskId: 'c', status: 'completed' }
    ])

    expect(tasks.map(isLive)).toEqual([true, false, false])
    expect(liveCount(tasks)).toBe(1)
  })

  it('counts a command as work but not as an agent', () => {
    const tasks = fold([start('a'), start('b', { kind: 'shell' })])

    expect(liveCount(tasks)).toBe(2)
    expect(liveAgents(tasks)).toBe(1)
  })

  // One task from outside, a dozen agents inside: the count is the agents.
  it('counts a workflow as the agents it has going, and as one before it says', () => {
    const member = (state: string): WorkflowAgent => ({
      index: 1,
      label: 'x',
      phase: 1,
      state,
      model: null,
      tokens: null,
      toolCalls: null,
      durationMs: null,
      lastTool: null
    })
    const quiet = fold([start('w', { kind: 'workflow' })])
    const busy = reduceTasks(
      quiet,
      {
        type: 'task_progress',
        taskId: 'w',
        tokens: 0,
        toolUses: 0,
        durationMs: 0,
        workflow: { phases: [], agents: [member('start'), member('progress'), member('done')] }
      },
      T1
    )

    expect(liveAgents(quiet)).toBe(1)
    expect(liveAgents(busy)).toBe(2)
  })
})

describe('the tasks with a question open', () => {
  it('marks them, and only while they run', () => {
    const tasks = fold([
      start('a'),
      start('b'),
      { type: 'task_ended', taskId: 'b', status: 'completed' }
    ])
    const marked = withWaiting(tasks, new Set(['a', 'b']))

    expect(marked.map((task) => task.waiting)).toEqual([true, false])
    expect(withWaiting(marked, new Set(['a', 'b']))).toBe(marked)
    expect(withWaiting(marked, new Set()).map((task) => task.waiting)).toEqual([false, false])
  })
})

describe('the tree the map draws', () => {
  it('nests each task under the one that started it, working ones first', () => {
    const tasks = [
      ...fold([start('done')], T0),
      ...fold([start('root')], T1),
      ...fold([start('child', { parentTaskId: 'root' })], T2),
      ...fold([start('orphan', { parentTaskId: 'gone' })], T2),
      ...fold([start('quiet', { ambient: true })], T0)
    ].map((task) => (task.taskId === 'done' ? { ...task, status: 'completed' as const } : task))

    const tree = taskTree(tasks)

    expect(tree.map((node) => node.task.taskId)).toEqual(['root', 'orphan', 'done'])
    expect(tree[0]?.children.map((node) => node.task.taskId)).toEqual(['child'])
  })

  it('puts a failure above a stop and a stop above a completion', () => {
    const tasks = (['completed', 'stopped', 'failed'] as const).map((status, index) => ({
      ...fold([start(String(index))])[0],
      status
    })) as TaskView[]

    expect(taskTree(tasks).map((node) => node.task.status)).toEqual([
      'failed',
      'stopped',
      'completed'
    ])
  })
})

describe('a workflow’s agents', () => {
  const agent = (state: string): WorkflowAgent => ({
    index: 1,
    label: 'x',
    phase: 1,
    state,
    model: null,
    tokens: null,
    toolCalls: null,
    durationMs: null,
    lastTool: null
  })

  it('counts every agent not yet ended as going, a state it has not seen included', () => {
    expect(
      workflowRunning([agent('start'), agent('progress'), agent('queued_x'), agent('done')])
    ).toBe(3)
  })

  it('reads each ending as the status a task would have', () => {
    expect(
      ['done', 'failed', 'error', 'stopped', 'skipped', 'progress'].map((state) =>
        workflowAgentStatus(agent(state))
      )
    ).toEqual(['completed', 'failed', 'failed', 'stopped', 'stopped', 'running'])
  })
})

describe('the calls above an agent', () => {
  // What has to be open in the log for a nested agent's own row to be drawn.
  it('are its parent’s, that one’s parent’s, and so on up', () => {
    const tasks = fold([
      start('top'),
      start('middle', { parentTaskId: 'top' }),
      start('bottom', { parentTaskId: 'middle' })
    ])

    expect([...callsAbove(tasks, 'call-bottom')]).toEqual(['call-middle', 'call-top'])
    expect(callsAbove(tasks, 'call-top').size).toBe(0)
    expect(callsAbove(tasks, 'call-unknown').size).toBe(0)
  })

  it('stops at a parent it does not know, or one it has met before', () => {
    const lost = fold([start('a', { parentTaskId: 'gone' })])
    expect(callsAbove(lost, 'call-a').size).toBe(0)

    const loop = fold([
      start('a', { parentTaskId: 'b' }),
      start('b', { parentTaskId: 'a', toolUseId: undefined })
    ])
    expect([...callsAbove(loop, 'call-a')]).toEqual(['call-a'])
  })
})

describe('the tasks a person is shown', () => {
  it('leaves out the CLI’s housekeeping', () => {
    const tasks = fold([start('a'), start('b', { ambient: true })])
    expect(visibleTasks(tasks).map((task) => task.taskId)).toEqual(['a'])
  })

  // What lets a list built afresh keep its identity, so nothing drawn from it
  // redraws when nothing in it moved.
  it('tells a list folded again from one that moved', () => {
    const tasks = fold([start('a'), start('b')])

    expect(sameTasks(tasks, fold([start('a'), start('b')]))).toBe(true)
    expect(sameTasks(tasks, tasks.slice(0, 1))).toBe(false)
    expect(sameTasks(tasks, [...tasks].reverse())).toBe(false)
    expect(sameTasks(tasks, fold([start('a'), start('b', { description: 'other' })]))).toBe(false)
  })
})

describe('what a conversation shows', () => {
  it('is the live tasks, then what only the transcript remembers, cut off', () => {
    const live = fold([start('a')])
    const history = tasksFrom([
      { at: T0, event: start('a') },
      { at: T0, event: start('old') },
      { at: T0, event: start('done') },
      { at: T1, event: { type: 'task_ended', taskId: 'done', status: 'completed' } }
    ])

    expect(withHistory(live, history).map((task) => [task.taskId, task.status])).toEqual([
      ['a', 'running'],
      ['old', 'stopped'],
      ['done', 'completed']
    ])
  })

  it('is the live list itself when the transcript adds nothing', () => {
    const live = fold([start('a')])
    expect(withHistory(live, live)).toBe(live)
  })

  it('finds a task by the call that started it', () => {
    const tasks = fold([start('a'), start('b', { toolUseId: undefined })])
    const found = byToolUse(tasks)

    expect(found.get('call-a')?.taskId).toBe('a')
    expect(found.size).toBe(1)
  })
})
