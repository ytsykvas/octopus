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

  // The same reasoning as the rate limit: it says what the agent can do now,
  // not what happened. "The command list changed" is nothing to read back.
  it('treats a new command list as live only', () => {
    expect(isEphemeral({ type: 'commands_changed', commands: [] })).toBe(true)
  })

  it('treats completed blocks and everything else as worth keeping', () => {
    const kept: AgentEvent[] = [
      { type: 'text', text: 'Looking at auth.rb' },
      { type: 'thinking', text: 'weighing it up' },
      { type: 'session_started', sessionId: 'sess-1' },
      // Kept because a reset nobody asked for leaves the log standing, and the
      // line explaining why the agent forgot has to survive a restart.
      { type: 'conversation_reset', cleared: false },
      { type: 'question_answered', requestId: 'r-1', answers: [] },
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

  /*
   * The record a card is redrawn from. Neither of the other two can do it: the
   * `tool_use` holds the questions as they were before anyone answered, and the
   * tool's result is a sentence of English prose.
   */
  it('stores and reads back what the user chose', () => {
    const answered = {
      type: 'question_answered',
      requestId: 'r-1',
      answers: [{ question: 'Which one?', selected: ['the first'], other: null }]
    }

    const parsed = AgentEventSchema.safeParse(JSON.parse(JSON.stringify(answered)))

    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual(answered)
  })

  // Written down and read back on the next launch, so the round trip is the
  // thing worth asserting rather than the literal.
  it('stores and reads back a reset nobody asked for', () => {
    const parsed = AgentEventSchema.safeParse(
      JSON.parse(JSON.stringify({ type: 'conversation_reset', cleared: false }))
    )

    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ type: 'conversation_reset', cleared: false })
  })

  // `cleared` has no default on purpose: it is the difference between wiping a
  // conversation and drawing a line under it, and a shape missing it is a bug
  // rather than an older record.
  it('insists a reset says whether it was asked for', () => {
    expect(AgentEventSchema.safeParse({ type: 'conversation_reset' }).success).toBe(false)
  })

  it('carries a command list with everything a suggestion needs', () => {
    const parsed = AgentEventSchema.safeParse({
      type: 'commands_changed',
      commands: [{ name: 'clear', aliases: ['reset'] }]
    })

    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({
      type: 'commands_changed',
      commands: [{ name: 'clear', description: '', argumentHint: '', aliases: ['reset'] }]
    })
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
