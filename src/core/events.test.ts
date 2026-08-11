import { describe, expect, it } from 'vitest'

import { type AgentEvent, AgentEventSchema, isEphemeral, turnOutcome } from './events.js'

describe('what gets stored', () => {
  // Deltas exist so text appears while it is being written. The complete block
  // follows immediately after, so keeping both would replay every answer twice
  // on the next launch.
  it('treats streamed fragments as live only', () => {
    expect(isEphemeral({ type: 'text_delta', text: 'Loo' })).toBe(true)
    expect(isEphemeral({ type: 'thinking_delta', text: 'hm' })).toBe(true)
  })

  // It describes the account at this moment, not the conversation. Reading
  // "you were at 62%" back a week later says nothing.
  it('treats a rate limit as live only', () => {
    expect(
      isEphemeral({
        type: 'rate_limit',
        status: 'allowed',
        window: 'five_hour',
        utilization: 62,
        resetsAt: null
      })
    ).toBe(true)
  })

  it('treats completed blocks and everything else as worth keeping', () => {
    const kept: AgentEvent[] = [
      { type: 'text', text: 'Looking at auth.rb' },
      { type: 'thinking', text: 'weighing it up' },
      { type: 'session_started', sessionId: 'sess-1' },
      {
        type: 'result',
        ok: true,
        costUsd: null,
        durationMs: null,
        inputTokens: null,
        outputTokens: null,
        terminalReason: null
      }
    ]

    expect(kept.every((event) => !isEphemeral(event))).toBe(true)
  })
})

describe('the event schema', () => {
  it('rejects a variant it does not know', () => {
    expect(AgentEventSchema.safeParse({ type: 'applause', volume: 11 }).success).toBe(false)
  })

  it('accepts a null cost, which is what a crashed turn reports', () => {
    expect(
      AgentEventSchema.safeParse({
        type: 'result',
        ok: false,
        costUsd: null,
        durationMs: null,
        inputTokens: null,
        outputTokens: null,
        terminalReason: null
      }).success
    ).toBe(true)
  })

  // The shape belongs to whichever tool the model picked, so nothing here may
  // insist on a particular one.
  it('takes a tool input of any shape', () => {
    expect(
      AgentEventSchema.safeParse({
        type: 'tool_use',
        toolUseId: 'c-1',
        name: 'Bash',
        input: { command: 'ls', timeout: 5 }
      }).success
    ).toBe(true)
  })
})

describe('how a turn ended', () => {
  // Nineteen reasons localised would be nineteen claims about the interface,
  // almost none of which ever appear. Six outcomes are what a reader needs.
  it('groups the reasons a reader would act on differently', () => {
    expect(turnOutcome('completed')).toBe('completed')
    expect(turnOutcome('aborted_tools')).toBe('interrupted')
    expect(turnOutcome('max_turns')).toBe('limit')
    expect(turnOutcome('blocking_limit')).toBe('limit')
    expect(turnOutcome('prompt_too_long')).toBe('tooLong')
    expect(turnOutcome('stop_hook_prevented')).toBe('blocked')
  })

  // A CLI old enough not to report one said nothing was wrong.
  it('treats a missing reason as an ordinary finish', () => {
    expect(turnOutcome(null)).toBe('completed')
  })

  // Claiming success would mislead; printing a raw identifier would say
  // nothing. A reason added in a later SDK lands here.
  it('treats anything it does not know as a failure', () => {
    expect(turnOutcome('model_error')).toBe('failed')
    expect(turnOutcome('some_reason_invented_next_year')).toBe('failed')
  })
})
