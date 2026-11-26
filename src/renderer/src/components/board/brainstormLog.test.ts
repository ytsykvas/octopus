import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '@core/events.js'
import { PROPOSE_EDIT_TOOL, PROPOSE_TASKS_TOOL } from '@core/taskProposal.js'
import type { ChatEntry } from '@core/transcript.js'

import { isWorking, latestProposal, openQuestions } from './brainstormLog.js'

const AT = '2026-11-26T10:00:00.000Z'
const said = (event: AgentEvent): ChatEntry => ({ role: 'agent', at: AT, event })
const sent = (text: string): ChatEntry => ({ role: 'user', at: AT, text })
const call = (toolUseId: string, name: string, input: unknown): ChatEntry =>
  said({ type: 'tool_use', toolUseId, name, input })
const TASK = { title: 'A', description: 'Why.' }
const result = said({
  type: 'result',
  ok: true,
  costUsd: null,
  durationMs: null
} as unknown as AgentEvent)

describe('latestProposal', () => {
  it('takes the newest call that proposed, edits included', () => {
    const entries = [
      call('c1', PROPOSE_TASKS_TOOL, { summary: 'First.', tasks: [TASK] }),
      call('c2', PROPOSE_EDIT_TOOL, { summary: 'Second.', task: TASK }),
      call('c3', 'Read', { file_path: '/a' })
    ]

    expect(latestProposal(entries)).toEqual({
      callId: 'c2',
      proposal: { summary: 'Second.', tasks: [TASK] }
    })
  })

  it('passes over a call the tool refused, and the user’s messages', () => {
    const entries = [
      call('c1', PROPOSE_TASKS_TOOL, { summary: 'Kept.', tasks: [TASK] }),
      sent('Change it'),
      call('c2', PROPOSE_TASKS_TOOL, { summary: 'x', tasks: [] })
    ]

    expect(latestProposal(entries)?.callId).toBe('c1')
  })

  it('finds none before the first', () => {
    expect(latestProposal([sent('Plan')])).toBeNull()
  })
})

describe('openQuestions', () => {
  it('keeps a question until it is answered or withdrawn', () => {
    const asked = (requestId: string): ChatEntry =>
      said({ type: 'permission_request', requestId, toolName: 'AskUserQuestion', input: {} })

    expect([
      ...openQuestions([
        sent('Plan'),
        asked('r1'),
        asked('r2'),
        asked('r3'),
        said({ type: 'question_answered', requestId: 'r1', answers: [] }),
        said({ type: 'permission_withdrawn', requestId: 'r2' })
      ])
    ]).toEqual(['r3'])
  })
})

describe('isWorking', () => {
  it('is working from a message sent until its turn ends', () => {
    expect(isWorking([])).toBe(false)
    expect(isWorking([sent('Plan')])).toBe(true)
    expect(isWorking([sent('Plan'), call('c1', 'Read', {})])).toBe(true)
    expect(isWorking([sent('Plan'), result])).toBe(false)
    expect(isWorking([sent('Plan'), result, sent('More')])).toBe(true)
  })

  it('takes an error as the end of the turn', () => {
    expect(
      isWorking([sent('Plan'), said({ type: 'error', message: 'gone', code: 'endedQuietly' })])
    ).toBe(false)
  })
})
