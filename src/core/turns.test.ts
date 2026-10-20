import { describe, expect, it } from 'vitest'

import type { AgentEvent } from './events.js'
import type { ChatEntry } from './transcript.js'
import { nextTurnStart, turnStartedAt } from './turns.js'

const user = (text: string, at: string): ChatEntry => ({ role: 'user', at, text })

const agent = (event: AgentEvent, at: string): ChatEntry => ({ role: 'agent', at, event })

const step = (at: string): ChatEntry =>
  agent({ type: 'tool_use', toolUseId: 'c-1', name: 'Read', input: {} }, at)

const footer: ChatEntry = {
  role: 'agent',
  at: '09:01',
  event: {
    type: 'result',
    ok: true,
    costUsd: 0,
    durationMs: 100,
    inputTokens: 0,
    outputTokens: 0,
    terminalReason: null
  }
}

describe('when the turn under way began', () => {
  it('is the first thing said after the last turn closed', () => {
    const entries = [user('one', '09:00'), footer, user('two', '09:05'), step('09:06')]

    expect(turnStartedAt(entries)).toBe('09:05')
  })

  // An agent the turn sent off records its start and end after the turn's
  // result, while no turn is running: counting from one would start a clock
  // for work the main agent is not doing.
  it('is not an agent starting or ending after the turn closed', () => {
    const started = agent(
      {
        type: 'task_started',
        taskId: 't',
        kind: 'agent',
        description: 'd',
        backgrounded: true,
        ambient: false
      },
      '09:02'
    )
    const ended = agent({ type: 'task_ended', taskId: 't', status: 'completed' }, '09:03')

    expect(turnStartedAt([user('one', '09:00'), footer, started, ended])).toBeNull()
    expect(turnStartedAt([user('one', '09:00'), footer, started, user('two', '09:05')])).toBe(
      '09:05'
    )
  })

  // Its steps and its questions land there too, at any moment.
  it('is not a step or a question of an agent at work after the turn closed', () => {
    const inner = agent(
      { type: 'tool_use', toolUseId: 'inner', name: 'Read', input: {}, parentToolUseId: 'c-1' },
      '09:02'
    )
    const asked = agent(
      {
        type: 'permission_request',
        requestId: 'r-1',
        toolName: 'Bash',
        input: { command: 'ls' },
        taskId: 't'
      },
      '09:03'
    )

    expect(turnStartedAt([user('one', '09:00'), footer, inner, asked])).toBeNull()
    expect(
      turnStartedAt([
        user('one', '09:00'),
        footer,
        inner,
        agent({ type: 'text', text: 'hm' }, '09:04')
      ])
    ).toBe('09:04')
  })

  it('is the start of the log when no turn has closed yet', () => {
    expect(turnStartedAt([user('one', '09:00')])).toBe('09:00')
  })

  it('is nothing when nothing has been said since', () => {
    expect(turnStartedAt([user('one', '09:00'), footer])).toBeNull()
    expect(turnStartedAt([])).toBeNull()
  })

  /* The service keeps the start one entry at a time, for conversations whose
     logs nobody has loaded; it must land where reading the whole log does. */
  it('keeps its start while the turn goes on, one entry at a time', () => {
    expect(nextTurnStart('09:05', step('09:06'))).toBe('09:05')
    expect(nextTurnStart(null, step('09:06'))).toBe('09:06')
    expect(nextTurnStart('09:05', footer)).toBeNull()
  })
})
