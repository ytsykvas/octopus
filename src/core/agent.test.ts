import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'

import {
  type AgentSession,
  mapMessage,
  READ_ONLY_TOOLS,
  type SessionOptions,
  promptTokens,
  startSession,
  toIsoTimestamp
} from './agent.js'
import type { AgentEvent } from './events.js'

/**
 * A stand-in for `query()`.
 *
 * The SDK is never started: it spawns a child process and talks to a model,
 * neither of which belongs in a unit test. What the fake preserves is the
 * shape the session depends on — an async iterable with control methods —
 * which is the whole reason `query` is injected.
 */
interface FakeQuery {
  readonly session: AgentSession
  /** Pushes a message as though the agent had emitted it. */
  readonly emit: (message: SDKMessage) => void
  /** Ends the stream, as the SDK does when the process exits. */
  readonly finish: (error?: Error) => void
  /** Whatever the session read from the prompt stream. */
  readonly received: SDKUserMessage[]
  readonly options: () => Record<string, unknown>
  readonly interrupted: () => number
  readonly modes: () => string[]
  readonly closed: () => number
}

function fakeAgent(
  overrides: Partial<SessionOptions> = {},
  hooks: { askPermission?: (name: string) => Promise<boolean> } = {}
): { agent: FakeQuery; events: AgentEvent[] } {
  const queued: SDKMessage[] = []
  let deliver: (() => void) | null = null
  let done = false
  let failure: Error | null = null

  const events: AgentEvent[] = []
  const received: SDKUserMessage[] = []
  const modes: string[] = []
  let interrupted = 0
  let closed = 0
  let captured: Record<string, unknown> = {}

  async function* stream(): AsyncGenerator<SDKMessage> {
    while (!done || queued.length > 0) {
      const next = queued.shift()
      if (next) {
        yield next
        continue
      }
      if (failure) throw failure

      await new Promise<void>((resolve) => {
        deliver = resolve
      })
    }

    if (failure) throw failure
  }

  const conversation = Object.assign(stream(), {
    interrupt: () => {
      interrupted++
      return Promise.resolve(undefined)
    },
    setPermissionMode: (mode: string) => {
      modes.push(mode)
      return Promise.resolve()
    },
    close: () => {
      closed++
    }
  }) as unknown as Query

  const session = startSession(
    {
      cwd: '/ws/kyiv',
      resume: null,
      settingSources: [],
      permissionMode: 'default',
      model: null,
      allowedTools: [...READ_ONLY_TOOLS],
      ...overrides
    },
    {
      query: (params) => {
        captured = params.options ?? {}

        // Drained in the background, exactly as the SDK would.
        void (async () => {
          for await (const message of params.prompt) received.push(message)
        })()

        return conversation
      },
      onEvent: (event) => events.push(event),
      askPermission: ({ toolName }) => hooks.askPermission?.(toolName) ?? Promise.resolve(true)
    }
  )

  const wake = (): void => {
    const pending = deliver
    deliver = null
    pending?.()
  }

  return {
    events,
    agent: {
      session,
      received,
      emit: (message) => {
        queued.push(message)
        wake()
      },
      finish: (error) => {
        failure = error ?? null
        done = true
        wake()
      },
      options: () => captured,
      interrupted: () => interrupted,
      modes: () => modes,
      closed: () => closed
    }
  }
}

/** A session that ends without ever saying anything. */
async function* silence(): AsyncGenerator<SDKMessage> {
  await Promise.resolve()
  yield* []
}

/** Lets the microtask queue drain, so pushed messages reach the handler. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function assistant(content: unknown[]): SDKMessage {
  return {
    type: 'assistant',
    message: { content },
    parent_tool_use_id: null,
    uuid: 'u-1',
    session_id: 's-1'
  } as unknown as SDKMessage
}

describe('mapping SDK messages', () => {
  it('reports the session id from the init message', () => {
    const message = {
      type: 'system',
      subtype: 'init',
      session_id: 'sess-42'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([{ type: 'session_started', sessionId: 'sess-42' }])
  })

  it('ignores system messages that are not the init one', () => {
    const message = {
      type: 'system',
      subtype: 'permission_denied',
      session_id: 'sess-42'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([])
  })

  // One assistant message carries several blocks, and each is an event: the
  // log has to show the reasoning, the prose and the tool call separately.
  it('splits an assistant message into one event per block', () => {
    const events = mapMessage(
      assistant([
        { type: 'thinking', thinking: 'weighing it up' },
        { type: 'text', text: 'Looking at auth.rb' },
        { type: 'tool_use', id: 'call-1', name: 'Read', input: { file_path: '/a.rb' } },
        { type: 'redacted_thinking', data: 'opaque' }
      ])
    )

    expect(events).toEqual([
      { type: 'thinking', text: 'weighing it up' },
      { type: 'text', text: 'Looking at auth.rb' },
      { type: 'tool_use', toolUseId: 'call-1', name: 'Read', input: { file_path: '/a.rb' } }
    ])
  })

  // Measured, not supposed: a real transcript held three thinking events whose
  // text was the empty string. The SDK can be asked to summarise reasoning or
  // omit it, and an omitted one still sends the block — for the signature —
  // with nothing in it. Left through, each drew a disclosure with nothing
  // behind it and stayed in the transcript forever.
  it('drops a block that carries no content', () => {
    const events = mapMessage(
      assistant([
        { type: 'thinking', thinking: '' },
        { type: 'text', text: '' },
        { type: 'thinking', thinking: '   \n  ' },
        { type: 'text', text: 'Looking at auth.rb' }
      ])
    )

    expect(events).toEqual([{ type: 'text', text: 'Looking at auth.rb' }])
  })

  it('reads a tool result out of the user message that carries it', () => {
    const message = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'done' }]
      },
      parent_tool_use_id: null,
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'tool_result', toolUseId: 'call-1', ok: true, content: 'done' }
    ])
  })

  it('marks a failed tool result as failed', () => {
    const message = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call-1', is_error: true, content: 'no such file' },
          { type: 'text', text: 'ignored' }
        ]
      },
      parent_tool_use_id: null,
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'tool_result', toolUseId: 'call-1', ok: false, content: 'no such file' }
    ])
  })

  // A plain string is what a user's own message looks like; only the ones
  // carrying blocks hold tool results.
  it('ignores a user message whose content is plain text', () => {
    const message = {
      type: 'user',
      message: { role: 'user', content: 'hello' },
      parent_tool_use_id: null,
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([])
  })

  it('flattens a block-shaped tool result and drops what cannot be shown', () => {
    const message = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call-1',
            content: [
              { type: 'text', text: 'first' },
              { type: 'image', source: {} },
              { type: 'text', text: 'second' }
            ]
          }
        ]
      },
      parent_tool_use_id: null,
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'tool_result', toolUseId: 'call-1', ok: true, content: 'first\nsecond' }
    ])
  })

  it('treats a tool result with no content as empty', () => {
    const message = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call-1' }]
      },
      parent_tool_use_id: null,
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'tool_result', toolUseId: 'call-1', ok: true, content: '' }
    ])
  })

  it('turns streamed text and thinking into deltas', () => {
    const text = {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Loo' } },
      parent_tool_use_id: null,
      uuid: 'u-1',
      session_id: 's-1'
    } as unknown as SDKMessage

    const thinking = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'hmm' }
      },
      parent_tool_use_id: null,
      uuid: 'u-1',
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(text)).toEqual([{ type: 'text_delta', text: 'Loo' }])
    expect(mapMessage(thinking)).toEqual([{ type: 'thinking_delta', text: 'hmm' }])
  })

  // Tool arguments stream in as JSON fragments, which read as nothing until
  // complete — and arrive complete in the assistant message that follows.
  it('ignores stream events that carry no readable text', () => {
    const partialJson = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"fi' }
      },
      parent_tool_use_id: null,
      uuid: 'u-1',
      session_id: 's-1'
    } as unknown as SDKMessage

    const blockStart = {
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      parent_tool_use_id: null,
      uuid: 'u-1',
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(partialJson)).toEqual([])
    expect(mapMessage(blockStart)).toEqual([])
  })

  it('reports what a turn used and why it ended', () => {
    const message = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.0421,
      duration_ms: 3200,
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: 40_000,
        cache_creation_input_tokens: 8118,
        output_tokens: 1180
      },
      terminal_reason: 'max_turns',
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      {
        type: 'result',
        ok: true,
        costUsd: 0.0421,
        durationMs: 3200,
        inputTokens: 48_120, // 2 + 40_000 + 8_118, all three parts of the prompt
        outputTokens: 1180,
        terminalReason: 'max_turns'
      }
    ])
  })

  // Older CLIs do not send one, and the field is optional in the SDK's types.
  it('accepts a result that does not say why it ended', () => {
    const message = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0,
      duration_ms: 10,
      usage: {
        input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 0
      },
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)[0]).toMatchObject({ terminalReason: null })
  })

  // The one figure here that is about the subscription rather than about an
  // API bill — which is what makes it worth showing at all.
  it('reports how much of the subscription window is gone', () => {
    const message = {
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed_warning',
        rateLimitType: 'five_hour',
        utilization: 62,
        resetsAt: 1_786_000_000_000
      },
      uuid: 'u-1',
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      {
        type: 'rate_limit',
        status: 'allowed_warning',
        window: 'five_hour',
        utilization: 62,
        resetsAt: new Date(1_786_000_000_000).toISOString()
      }
    ])
  })

  // Copied verbatim from a live session rather than composed here. The shape
  // the types allow and the shape that arrives are not the same: `utilization`
  // is absent, `resetsAt` is in seconds, and fields the types never mention
  // ride along. A fixture written from the declaration alone would have tested
  // a message the SDK does not send.
  it('reads the payload a live session actually sends', () => {
    const message = {
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        resetsAt: 1_786_468_800,
        rateLimitType: 'five_hour',
        overageStatus: 'rejected',
        overageDisabledReason: 'org_level_disabled',
        isUsingOverage: false
      },
      uuid: 'u-1',
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      {
        type: 'rate_limit',
        status: 'allowed',
        window: 'five_hour',
        // Seconds, read as seconds: the same number taken for milliseconds
        // would put the reset in January 1970.
        resetsAt: '2026-08-11T17:20:00.000Z',
        utilization: null
      }
    ])
  })

  it('accepts a rate limit that reports only its status', () => {
    const message = {
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed' },
      uuid: 'u-1',
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'rate_limit', status: 'allowed', window: null, utilization: null, resetsAt: null }
    ])
  })

  // The SDK union has some forty variants and grows between releases; the ones
  // we do not draw have to map to nothing rather than to a placeholder row.
  it('ignores message kinds the UI does not render', () => {
    expect(mapMessage({ type: 'compact_boundary' } as unknown as SDKMessage)).toEqual([])
  })
})

describe('a session', () => {
  it('passes the workspace and the transparency switch to the SDK', () => {
    const { agent } = fakeAgent({ cwd: '/ws/anna', settingSources: ['project'] })

    expect(agent.options()).toMatchObject({
      cwd: '/ws/anna',
      settingSources: ['project'],
      permissionMode: 'default',
      includePartialMessages: true,
      systemPrompt: { type: 'preset', preset: 'claude_code' }
    })
  })

  // A resume of nothing is not the same as no resume: the SDK reads a present
  // `resume` as a session to go looking for.
  it('omits resume and model when there is nothing to continue', () => {
    const { agent } = fakeAgent()

    expect(agent.options()).not.toHaveProperty('resume')
    expect(agent.options()).not.toHaveProperty('model')
  })

  it('continues a stored session when given one', () => {
    const { agent } = fakeAgent({ resume: 'sess-9', model: 'claude-opus-5' })

    expect(agent.options()).toMatchObject({ resume: 'sess-9', model: 'claude-opus-5' })
  })

  it('sends a message down the prompt stream', async () => {
    const { agent } = fakeAgent()

    agent.session.send('add a test')
    await settle()

    expect(agent.received).toHaveLength(1)
    expect(agent.received[0]?.message.content).toBe('add a test')
  })

  // The two ends run on different clocks: the SDK may not be reading yet when
  // the user presses enter.
  it('holds messages queued before the SDK started reading', async () => {
    const { agent } = fakeAgent()

    agent.session.send('first')
    agent.session.send('second')
    await settle()

    expect(agent.received.map((message) => message.message.content)).toEqual(['first', 'second'])
  })

  // Closing must not swallow what the user already typed: the message is on
  // its way to a session that is still there to read it.
  it('delivers what was queued before the close', async () => {
    const { agent } = fakeAgent()

    agent.session.send('first')
    agent.session.send('second')
    await agent.session.close()
    await settle()

    expect(agent.received.map((message) => message.message.content)).toEqual(['first', 'second'])
  })

  it('drops a message sent to a session that is closing', async () => {
    const { agent } = fakeAgent()
    agent.finish()

    await agent.session.close()
    agent.session.send('too late')
    await settle()

    expect(agent.received).toHaveLength(0)
  })

  it('turns the agent stream into events', async () => {
    const { agent, events } = fakeAgent()

    agent.emit(assistant([{ type: 'text', text: 'done' }]))
    await settle()

    expect(events).toEqual([{ type: 'text', text: 'done' }])
  })

  // Whatever the SDK failed at — a spawn, a lost subscription — the chat is
  // the only place the user is looking.
  it('reports a stream failure as an error event', async () => {
    const { agent, events } = fakeAgent()

    agent.finish(new Error('claude exited with code 1'))
    await settle()

    expect(events).toEqual([{ type: 'error', message: 'claude exited with code 1' }])
  })

  it('forwards interrupt and mode changes to the SDK', async () => {
    const { agent } = fakeAgent()

    await agent.session.interrupt()
    await agent.session.setPermissionMode('plan')

    expect(agent.interrupted()).toBe(1)
    expect(agent.modes()).toEqual(['plan'])
  })

  // Closing runs from two places — the workspace being removed and the app
  // quitting — and the second must not fall over the first.
  it('is safe to close twice', async () => {
    const { agent } = fakeAgent()
    agent.finish()

    await agent.session.close()
    await expect(agent.session.close()).resolves.toBeUndefined()
  })

  it('closes the SDK session and waits for the stream to end', async () => {
    const { agent } = fakeAgent()
    agent.finish()

    await agent.session.close()

    expect(agent.closed()).toBe(1)
  })
})

describe('a session that will not close', () => {
  // The SDK's `close` is synchronous, so without wrapping it a failure would
  // throw out of the call rather than reject — and the caller removing a
  // workspace catches a rejection.
  it('rejects rather than throwing at the caller', async () => {
    const conversation = Object.assign(silence(), {
      interrupt: () => Promise.resolve(undefined),
      setPermissionMode: () => Promise.resolve(),
      close: () => {
        throw new Error('the process would not die')
      }
    }) as unknown as Query

    const session = startSession(
      {
        cwd: '/ws/kyiv',
        resume: null,
        settingSources: [],
        permissionMode: 'default',
        model: null,
        allowedTools: []
      },
      {
        query: () => conversation,
        onEvent: () => undefined,
        askPermission: () => Promise.resolve(true)
      }
    )

    await expect(session.close()).rejects.toThrow('the process would not die')
  })
})

describe('permissions', () => {
  function permissionCall(
    agent: FakeQuery
  ): (name: string, input: Record<string, unknown>) => Promise<unknown> {
    const canUseTool = agent.options().canUseTool
    if (typeof canUseTool !== 'function') throw new Error('canUseTool was not passed to the SDK')

    return canUseTool as (name: string, input: Record<string, unknown>) => Promise<unknown>
  }

  it('allows a tool the user approved, keeping the arguments', async () => {
    const { agent } = fakeAgent({}, { askPermission: () => Promise.resolve(true) })

    await expect(permissionCall(agent)('Edit', { file_path: '/a.rb' })).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { file_path: '/a.rb' }
    })
  })

  it('denies with a message the agent can read', async () => {
    const { agent } = fakeAgent({}, { askPermission: () => Promise.resolve(false) })

    await expect(permissionCall(agent)('Bash', { command: 'rm -rf /' })).resolves.toMatchObject({
      behavior: 'deny'
    })
  })

  // Without this the dialog would fire for every file the agent opens, which
  // is most of what it does — and a prompt that constant stops being read.
  it('pre-approves the read-only tools rather than asking about each read', () => {
    const { agent } = fakeAgent()

    expect(agent.options().allowedTools).toEqual([...READ_ONLY_TOOLS])
    expect(READ_ONLY_TOOLS).toContain('Read')
    expect(READ_ONLY_TOOLS).not.toContain('Bash')
  })

  it('asks about a tool through the hook it was given', async () => {
    const asked = vi.fn(() => Promise.resolve(true))
    const { agent } = fakeAgent({}, { askPermission: asked })

    await permissionCall(agent)('Write', { file_path: '/b.rb' })

    expect(asked).toHaveBeenCalledWith('Write')
  })
})

describe('an epoch reading with no unit given', () => {
  // `resetsAt` is typed as a bare number. Seconds and milliseconds for any
  // date this side of 1973 differ by three orders of magnitude, so telling
  // them apart is a check rather than a guess.
  it('reads seconds and milliseconds as the same moment', () => {
    const moment = '2026-08-11T09:00:00.000Z'
    const milliseconds = Date.parse(moment)

    expect(toIsoTimestamp(milliseconds)).toBe(moment)
    expect(toIsoTimestamp(milliseconds / 1000)).toBe(moment)
  })

  it('says nothing rather than inventing a date', () => {
    expect(toIsoTimestamp(undefined)).toBeNull()
    expect(toIsoTimestamp(0)).toBeNull()
    expect(toIsoTimestamp(-1)).toBeNull()
    expect(toIsoTimestamp(Number.NaN)).toBeNull()
  })
})

describe('how large the prompt was', () => {
  // Measured on a real turn: 2 input tokens beside 17,392 read from cache and
  // 7,825 written to it. The bare field understates the prompt by four orders
  // of magnitude, which on screen would read as a broken number.
  it('counts what was cached as well as what was not', () => {
    expect(
      promptTokens({
        input_tokens: 2,
        cache_read_input_tokens: 17_392,
        cache_creation_input_tokens: 7825
      })
    ).toBe(25_219)
  })

  it('is zero for a turn that sent nothing', () => {
    expect(
      promptTokens({
        input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0
      })
    ).toBe(0)
  })
})
