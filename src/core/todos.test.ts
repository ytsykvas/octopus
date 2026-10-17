import { describe, expect, it } from 'vitest'

import { latestTodos, readTodos } from './todos.js'
import type { ChatEntry } from './transcript.js'

const AT = '2026-08-20T10:00:00.000Z'

function call(todos: unknown, name = 'TodoWrite'): ChatEntry {
  return {
    role: 'agent',
    at: AT,
    event: { type: 'tool_use', toolUseId: 'c', name, input: { todos } }
  }
}

const LIST = [
  { content: 'Write the test', status: 'completed', activeForm: 'Writing the test' },
  { content: 'Make it pass', status: 'in_progress', activeForm: 'Making it pass' },
  { content: 'Document it', status: 'pending', activeForm: 'Documenting it' }
]

describe('reading a TodoWrite call', () => {
  it('reads the list it carries', () => {
    expect(readTodos('TodoWrite', { todos: LIST })).toEqual(LIST)
  })

  it('is null for any other tool', () => {
    expect(readTodos('Bash', { todos: LIST })).toBeNull()
  })

  // The model's own JSON. A list that does not parse is an ordinary tool row.
  it('is null for input that is not a list of todos', () => {
    expect(readTodos('TodoWrite', { todos: [{ content: 1 }] })).toBeNull()
    expect(readTodos('TodoWrite', 'nonsense')).toBeNull()
    expect(readTodos('TodoWrite', { todos: [{ content: 'x', status: 'done' }] })).toBeNull()
  })

  it('tolerates a call that left the progressive form out', () => {
    expect(readTodos('TodoWrite', { todos: [{ content: 'x', status: 'pending' }] })).toEqual([
      { content: 'x', status: 'pending', activeForm: '' }
    ])
  })
})

describe('the list as it stands', () => {
  // `TodoWrite` always sends the whole list, so the newest is the state.
  it('is the newest call', () => {
    const entries = [
      call([{ content: 'old', status: 'pending', activeForm: '' }]),
      { role: 'user' as const, at: AT, text: 'carry on' },
      call(LIST)
    ]

    expect(latestTodos(entries)).toEqual(LIST)
  })

  it('skips a newest call that does not parse rather than blanking the list', () => {
    expect(latestTodos([call(LIST), call('nonsense')])).toEqual(LIST)
  })

  it('is null when the agent never kept one', () => {
    expect(latestTodos([{ role: 'user', at: AT, text: 'hi' }, call(LIST, 'Bash')])).toBeNull()
    expect(latestTodos([])).toBeNull()
  })

  // A subagent keeps a list for its own task, and the newest one written must
  // not replace the conversation's.
  it('does not take a subagent’s list for the conversation’s', () => {
    const own = call(LIST)
    const theirs: ChatEntry = {
      role: 'agent',
      at: AT,
      event: {
        type: 'tool_use',
        toolUseId: 'c-2',
        name: 'TodoWrite',
        input: { todos: [{ content: 'theirs', status: 'pending', activeForm: '' }] },
        parentToolUseId: 'toolu_task_1'
      }
    }

    expect(latestTodos([own, theirs])).toEqual(LIST)
  })

  it('is still the whole list after a later call replaces it', () => {
    expect(latestTodos([call(LIST), call([LIST[0]])])).toEqual([LIST[0]])
  })

  it('looks past events that are not tool calls', () => {
    const entries: ChatEntry[] = [
      call(LIST),
      { role: 'agent', at: AT, event: { type: 'text', text: 'done' } }
    ]

    expect(latestTodos(entries)).toEqual(LIST)
  })
})

// The tools a current CLI keeps the list with — `TodoWrite` is not offered at
// all (measured on 2.1.299). Shapes as that session sent them.
describe('the list kept with TaskCreate and TaskUpdate', () => {
  function tool(toolUseId: string, name: string, input: unknown, parent?: string): ChatEntry {
    return {
      role: 'agent',
      at: AT,
      event: {
        type: 'tool_use',
        toolUseId,
        name,
        input,
        ...(parent !== undefined && { parentToolUseId: parent })
      }
    }
  }

  function result(toolUseId: string, taskId?: string, parent?: string): ChatEntry {
    return {
      role: 'agent',
      at: AT,
      event: {
        type: 'tool_result',
        toolUseId,
        ok: true,
        content: '',
        ...(taskId !== undefined && { taskId }),
        ...(parent !== undefined && { parentToolUseId: parent })
      }
    }
  }

  function create(n: string, subject: string, activeForm?: string): ChatEntry[] {
    return [
      tool(`c-${n}`, 'TaskCreate', {
        subject,
        description: `Task ${subject}`,
        ...(activeForm !== undefined && { activeForm })
      }),
      result(`c-${n}`, n)
    ]
  }

  function update(n: string, input: Record<string, unknown>): ChatEntry {
    return tool(`u-${n}-${JSON.stringify(input)}`, 'TaskUpdate', { taskId: n, ...input })
  }

  const THREE = [
    ...create('1', 'Alpha', 'Doing alpha'),
    ...create('2', 'Beta'),
    ...create('3', 'Gamma')
  ]

  it('lists created tasks in the order they were made', () => {
    expect(latestTodos(THREE)).toEqual([
      { content: 'Alpha', status: 'pending', activeForm: 'Doing alpha' },
      { content: 'Beta', status: 'pending', activeForm: '' },
      { content: 'Gamma', status: 'pending', activeForm: '' }
    ])
  })

  it('applies an update to the task it names, leaving the rest of it alone', () => {
    const entries = [
      ...THREE,
      update('1', { status: 'completed' }),
      update('2', { status: 'in_progress', subject: 'Beta, renamed', activeForm: 'Renaming' }),
      update('3', { status: 'in_progress' }),
      update('3', { subject: 'Gamma, renamed' })
    ]

    expect(latestTodos(entries)).toEqual([
      { content: 'Alpha', status: 'completed', activeForm: 'Doing alpha' },
      { content: 'Beta, renamed', status: 'in_progress', activeForm: 'Renaming' },
      { content: 'Gamma, renamed', status: 'in_progress', activeForm: '' }
    ])
  })

  it('drops a task updated to deleted', () => {
    const entries = [...THREE, update('3', { status: 'deleted' })]

    expect(latestTodos(entries)?.map((todo) => todo.content)).toEqual(['Alpha', 'Beta'])
  })

  it('ignores an update to a task it never saw, or one that does not parse', () => {
    const entries = [
      ...create('1', 'Alpha'),
      update('9', { status: 'completed' }),
      update('1', { status: 'done' }),
      tool('u-bad', 'TaskUpdate', 'nonsense')
    ]

    expect(latestTodos(entries)).toEqual([{ content: 'Alpha', status: 'pending', activeForm: '' }])
  })

  // The id exists nowhere in the call, so a task still being created has no
  // line any update could reach.
  it('adds a task only once its result names its id', () => {
    const pending = tool('c-1', 'TaskCreate', { subject: 'Alpha', description: '' })

    expect(latestTodos([pending])).toBeNull()
    expect(latestTodos([pending, result('c-1')])).toBeNull()
    expect(latestTodos([pending, result('c-1', '1')])).toHaveLength(1)
  })

  it('reads an id only off the result of a create', () => {
    expect(latestTodos([tool('g-1', 'TaskGet', { taskId: '1' }), result('g-1', '1')])).toBeNull()
    expect(latestTodos([tool('c-1', 'TaskCreate', { nope: 1 }), result('c-1', '1')])).toBeNull()
  })

  it('does not take a subagent’s tasks for the conversation’s', () => {
    const theirs = [
      tool('c-9', 'TaskCreate', { subject: 'Theirs', description: '' }, 'toolu_task_1'),
      result('c-9', '9', 'toolu_task_1'),
      tool('u-1', 'TaskUpdate', { taskId: '1', status: 'completed' }, 'toolu_task_1')
    ]

    expect(latestTodos([...create('1', 'Alpha'), ...theirs])).toEqual([
      { content: 'Alpha', status: 'pending', activeForm: '' }
    ])
  })

  // Task ids are "1", "2"… — a list `TodoWrite` wrote must not be reachable by
  // them, nor survive being replaced.
  it('lets a TodoWrite list replace the tasks, and keeps the two apart', () => {
    const entries = [...THREE, call(LIST), update('1', { status: 'completed' })]

    expect(latestTodos(entries)).toEqual(LIST)
  })

  it('adds tasks after a TodoWrite list', () => {
    expect(latestTodos([call([LIST[0]]), ...create('1', 'Alpha')])).toEqual([
      LIST[0],
      { content: 'Alpha', status: 'pending', activeForm: '' }
    ])
  })
})
