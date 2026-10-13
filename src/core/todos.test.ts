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

  it('looks past events that are not tool calls', () => {
    const entries: ChatEntry[] = [
      call(LIST),
      { role: 'agent', at: AT, event: { type: 'text', text: 'done' } }
    ]

    expect(latestTodos(entries)).toEqual(LIST)
  })
})
