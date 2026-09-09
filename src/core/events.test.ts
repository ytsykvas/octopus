import { describe, expect, it } from 'vitest'

import {
  type AgentEvent,
  AgentEventSchema,
  forTranscript,
  isEphemeral,
  turnOutcome
} from './events.js'

describe('how much of it gets stored', () => {
  const result = (overrides: Partial<Extract<AgentEvent, { type: 'tool_result' }>> = {}) =>
    ({ type: 'tool_result', toolUseId: 'c-1', ok: true, content: 'done', ...overrides }) as const

  /*
   * Nothing can draw this. `AgentRow` returns null when the call succeeded and
   * the fold renders only `tool_use` entries, so a `Read` of three thousand
   * lines was written to disk whole, parsed back on every open and held in the
   * window — to be dropped at render time. The transcript is append-only, so
   * opening a conversation cost what the agent had read rather than what it
   * said.
   */
  it('keeps only the head of a long result nothing can draw', () => {
    const kept = forTranscript(result({ content: 'x'.repeat(5000) }))

    expect(kept).toMatchObject({ truncated: true })
    expect(kept.type === 'tool_result' && kept.content.length).toBe(2000)
  })

  // Under the bound it is the event itself, unmarked: a reader has to be able
  // to tell a cut output from one that simply ended.
  it('leaves a short one exactly as it was, and unmarked', () => {
    expect(forTranscript(result())).toEqual(result())
  })

  /*
   * A failure keeps everything, and this is the assertion that stops the rule
   * being applied where it costs the reader something. Its content is drawn and
   * is the whole of what the failure says — the pane shortens it from the
   * middle, which is about reading rather than about storage, and cutting the
   * tail here would take the half that names the cause.
   */
  it('keeps the whole of a failure however long it is', () => {
    const failed = result({ ok: false, content: 'x'.repeat(5000) })

    expect(forTranscript(failed)).toEqual(failed)
  })

  // Everything else passes through untouched; this is the sibling of
  // `isEphemeral`, not a second filter.
  it('leaves every other kind of event alone', () => {
    const event: AgentEvent = { type: 'text', text: 'x'.repeat(5000) }

    expect(forTranscript(event)).toBe(event)
  })
})

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
      /* A refusal nothing was retried after is the only account of why a turn
         produced nothing, so it has to outlive the session that made it. */
      {
        type: 'model_refusal_no_fallback',
        originalModel: 'claude-opus-5',
        category: null,
        explanation: null
      },
      { type: 'usage', report: null },
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

  /*
   * The pair most easily got the wrong way round, and the only reason they
   * differ is who asked. Both are readings of the same account at the same
   * moment; a rate limit arrives on its own and describes something other than
   * the conversation, while a usage report is the answer to a command somebody
   * typed. A transcript that kept the question and dropped the answer would be
   * worse read back than one that kept neither.
   */
  it('keeps a usage report while dropping the rate limit it reads like', () => {
    const window = { utilization: 62, resetsAt: null }

    expect(
      isEphemeral({ type: 'rate_limit', status: 'allowed', window: 'five_hour', ...window })
    ).toBe(true)
    expect(isEphemeral({ type: 'usage', report: null })).toBe(false)
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
   * The one variant carrying a whole document, and the one where a rejection
   * would be silent: `transcript.ts` skips a line that does not parse, so a
   * report the schema turned down would take its entry with it and the card
   * would come back blank on the next launch, with nothing said anywhere.
   *
   * Which is also why the stored shape is ours rather than the SDK's — that API
   * says of itself that it may change without notice, and this file outlives it.
   */
  it('stores and reads back a whole usage report', () => {
    const report = {
      type: 'usage',
      report: {
        session: {
          costUsd: 1.84,
          apiDurationMs: 252_000,
          wallDurationMs: 931_000,
          linesAdded: 180,
          linesRemoved: 21,
          inputTokens: 2_000,
          outputTokens: 35_000,
          cacheReadTokens: 8_412_000,
          cacheWriteTokens: 100_000
        },
        subscriptionType: 'max',
        limitsApply: true,
        limits: [
          {
            key: 'five_hour',
            label: null,
            utilization: 50,
            resetsAt: '2026-08-27T19:09:59Z',
            severity: 'normal',
            binding: true
          },
          {
            key: 'model_scoped',
            label: 'Fable',
            utilization: 5,
            resetsAt: null,
            severity: null,
            binding: false
          }
        ],
        extraUsage: { monthlyLimit: 50, usedCredits: 12.5, utilization: 25 },
        contributing: {
          day: {
            requests: 206,
            sessions: 1,
            behaviors: [{ key: 'long_context', pct: 73, count: 122 }],
            skills: [{ name: 'core-module', pct: 68 }],
            agents: [],
            plugins: [],
            mcpServers: []
          },
          week: {
            requests: 393,
            sessions: 6,
            behaviors: [],
            skills: [],
            agents: [],
            plugins: [],
            mcpServers: []
          }
        }
      }
    }

    const parsed = AgentEventSchema.safeParse(JSON.parse(JSON.stringify(report)))

    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual(report)
  })

  // A reading that failed is still an answer, and it is written down like one.
  it('stores and reads back a reading that failed', () => {
    const parsed = AgentEventSchema.safeParse(
      JSON.parse(JSON.stringify({ type: 'usage', report: null }))
    )

    expect(parsed.success).toBe(true)
  })

  // A window key outside the allowlist cannot be stored, which is what keeps a
  // codename like `iguana_necktie` out of a file we read back and draw.
  it('refuses a window it has no name for', () => {
    expect(
      AgentEventSchema.safeParse({
        type: 'usage',
        report: {
          session: {
            costUsd: 0,
            apiDurationMs: 0,
            wallDurationMs: 0,
            linesAdded: 0,
            linesRemoved: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0
          },
          subscriptionType: null,
          limitsApply: true,
          limits: [{ key: 'iguana_necktie', label: null, utilization: 3, resetsAt: null }],
          extraUsage: null,
          contributing: null
        }
      }).success
    ).toBe(false)
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
