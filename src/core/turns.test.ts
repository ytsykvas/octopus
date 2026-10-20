import { describe, expect, it } from 'vitest'

import type { ChatEntry } from './transcript.js'
import { nextTurnStart, turnStartedAt } from './turns.js'

const user = (text: string, at: string): ChatEntry => ({ role: 'user', at, text })

const step = (at: string): ChatEntry => ({
  role: 'agent',
  at,
  event: { type: 'tool_use', toolUseId: 'c-1', name: 'Read', input: {} }
})

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
