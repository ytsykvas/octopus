import type {
  ModelInfo,
  Query,
  SDKMessage,
  SDKUserMessage,
  SlashCommand
} from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'

import {
  type AgentSession,
  DENIED,
  mapMessage,
  type PermissionOutcome,
  READ_ONLY_TOOLS,
  type SessionOptions,
  promptTokens,
  readContextUsage,
  readUsageReport,
  startSession,
  toAgentCommands,
  toAgentModels,
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
  /** Settings pushed onto a running session — where effort changes land. */
  readonly flagSettings: () => Record<string, unknown>[]
  readonly skillReloads: () => number
  /** Models asked for mid-session; `undefined` is "back to the default". */
  readonly requestedModels: () => (string | undefined)[]
  readonly closed: () => number
}

function fakeAgent(
  overrides: Partial<SessionOptions> = {},
  hooks: {
    askPermission?: (name: string) => Promise<PermissionOutcome>
    models?: ModelInfo[]
    commands?: SlashCommand[]
  } = {}
): { agent: FakeQuery; events: AgentEvent[] } {
  const queued: SDKMessage[] = []
  let deliver: (() => void) | null = null
  let done = false
  let failure: Error | null = null

  const events: AgentEvent[] = []
  const received: SDKUserMessage[] = []
  const modes: string[] = []
  const flagSettings: Record<string, unknown>[] = []
  let skillReloads = 0
  const requestedModels: (string | undefined)[] = []
  const offeredModels = hooks.models ?? []
  const offeredCommands = hooks.commands ?? []
  let interrupted = 0
  let closed = 0
  let transportClosed = false
  let captured: Record<string, unknown> = {}

  async function* stream(): AsyncGenerator<SDKMessage> {
    try {
      yield* messages()
    } finally {
      // A consumer that leaves the loop early runs this. The real SDK closes
      // its transport at the same moment, and every control request after it
      // fails — so the fake refuses them too, or a `break` added to
      // `startSession` would go unnoticed.
      if (!done) transportClosed = true
    }
  }

  async function* messages(): AsyncGenerator<SDKMessage> {
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

  /** What a control request answers: the value, or the real error verbatim. */
  const whileOpen = <T>(value: T): Promise<T> =>
    transportClosed
      ? Promise.reject(new Error('ProcessTransport is not ready for writing'))
      : Promise.resolve(value)

  const conversation = Object.assign(stream(), {
    interrupt: () => {
      interrupted++
      return Promise.resolve(undefined)
    },
    setPermissionMode: (mode: string) => {
      modes.push(mode)
      return Promise.resolve()
    },
    reloadSkills: () => {
      skillReloads += 1
      return Promise.resolve({ skills: [] })
    },
    applyFlagSettings: (settings: Record<string, unknown>) => {
      flagSettings.push(settings)
      return Promise.resolve()
    },
    setModel: (model: string | undefined) => {
      requestedModels.push(model)
      return Promise.resolve()
    },
    supportedModels: () => whileOpen(offeredModels),
    supportedCommands: () => whileOpen(offeredCommands),
    getContextUsage: () => whileOpen(CONTEXT_RESPONSE),
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () => whileOpen(USAGE_RESPONSE),
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
      effort: 'medium',
      allowedTools: [...READ_ONLY_TOOLS],
      additionalDirectories: [],
      skillOverrides: {},
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
      askPermission: ({ toolName }) =>
        hooks.askPermission?.(toolName) ?? Promise.resolve({ allow: true } as const)
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
      flagSettings: () => flagSettings,
      skillReloads: () => skillReloads,
      requestedModels: () => requestedModels,
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

  it('ignores system messages it has no use for', () => {
    const message = {
      type: 'system',
      subtype: 'permission_denied',
      session_id: 'sess-42'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([])
  })

  /*
   * The mistake this guards against, written down as a test because it is
   * invisible in the types and expensive in practice.
   *
   * A reset carries two ids: `new_conversation_id`, which reads like the thing
   * to resume from, and `session_id`, which is the conversation just left
   * behind. Neither is the answer — resuming with the first fails outright
   * ("No conversation found with session ID"), and the id that works arrives a
   * moment later in an `init` of its own. So this event carries no id at all,
   * and `session_started` goes on being the only thing that records one.
   */
  it('takes no session id from a reset, because neither of its ids is the one', () => {
    const message = {
      type: 'conversation_reset',
      new_conversation_id: 'conv-new',
      session_id: 'sess-old'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([{ type: 'conversation_reset', cleared: false }])
  })

  // Whether the user asked for it cannot be known from one message — the same
  // reset arrives when the agent leaves plan mode — so the mapping reports the
  // form that changes nothing, and the service, which sent the message, decides.
  it('never claims a reset was asked for', () => {
    const message = { type: 'conversation_reset' } as unknown as SDKMessage
    const [event] = mapMessage(message)

    expect(event).toEqual({ type: 'conversation_reset', cleared: false })
  })

  it('passes on a new command list, translated', () => {
    const message = {
      type: 'system',
      subtype: 'commands_changed',
      commands: [{ name: 'deploy', description: 'Ship it', argumentHint: '<env>' }]
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      {
        type: 'commands_changed',
        commands: [{ name: 'deploy', description: 'Ship it', argumentHint: '<env>', aliases: [] }]
      }
    ])
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

  it('changes the model of a running session', async () => {
    const { agent } = fakeAgent()

    await agent.session.setModel('claude-opus-5')

    expect(agent.requestedModels()).toEqual(['claude-opus-5'])
  })

  // Null is our word for "no override". The SDK's is `undefined`; asking it for
  // a model called null would be asking for a model that does not exist.
  it('hands the choice back to the agent as nothing rather than as null', async () => {
    const { agent } = fakeAgent()

    await agent.session.setModel(null)

    expect(agent.requestedModels()).toEqual([undefined])
  })

  // The SDK has no `setEffort`: `effort` is a start-time option, and flag
  // settings are the only way to move it on a session already running.
  it('moves the effort of a running session through its flag settings', async () => {
    const { agent } = fakeAgent()

    await agent.session.setEffort('max')

    expect(agent.flagSettings()).toEqual([
      { effortLevel: 'max', ultracode: false, enableWorkflows: false, skillOverrides: {} }
    ])
  })

  // One call rather than three: `applyFlagSettings` shallow-merges top-level
  // keys, so an `ultracode` sent after the level would replace it rather than
  // join it, and the session would run the orchestration at whatever effort it
  // was already on.
  it('asks for ultracode and the effort it runs at in a single call', async () => {
    const { agent } = fakeAgent()

    await agent.session.setEffort('ultracode')

    expect(agent.flagSettings()).toEqual([
      { effortLevel: 'xhigh', ultracode: true, enableWorkflows: true, skillOverrides: {} }
    ])
  })

  // Leaving it has to say so. Nothing else is loaded that would turn it off —
  // `settingSources` is empty — so an unsaid `ultracode` is one still running.
  it('turns ultracode off explicitly when the level moves off it', async () => {
    const { agent } = fakeAgent()

    await agent.session.setEffort('ultracode')
    await agent.session.setEffort('high')

    expect(agent.flagSettings()[1]).toEqual({
      effortLevel: 'high',
      ultracode: false,
      enableWorkflows: false,
      skillOverrides: {}
    })
  })

  it('names the withheld skills at start-up, in the flag layer', () => {
    const { agent } = fakeAgent({ skillOverrides: { 'octopus:review': 'off' } })

    expect(agent.options().settings).toEqual({
      ultracode: false,
      enableWorkflows: false,
      skillOverrides: { 'octopus:review': 'off' }
    })
  })

  it('leaves the extra roots unsaid when there are none to hand over', () => {
    expect(fakeAgent().agent.options().additionalDirectories).toBeUndefined()
  })

  /*
   * A root rather than a local plugin, which was tried first: a plugin's
   * skills load and then cannot be switched off under any spelling of the
   * override key, while a root's obey it like the checkout's own.
   */
  it('hands over the stores as extra working-directory roots', () => {
    const additionalDirectories = ['/data/skills']

    expect(fakeAgent({ additionalDirectories }).agent.options().additionalDirectories).toEqual(
      additionalDirectories
    )
  })

  it('moves the withheld skills of a running session', async () => {
    const { agent } = fakeAgent()

    await agent.session.setSkills({ 'octopus:review': 'off' })

    expect(agent.flagSettings()).toEqual([
      {
        effortLevel: 'medium',
        ultracode: false,
        enableWorkflows: false,
        skillOverrides: { 'octopus:review': 'off' }
      }
    ])
  })

  /*
   * The two halves of the flag layer travel together because
   * `applyFlagSettings` replaces a top-level key rather than merging into it.
   * Sent separately, switching a skill would put the effort back to whatever
   * the session started on — silently, and a turn later.
   */
  it('keeps the effort while the skills move, and the skills while the effort does', async () => {
    const { agent } = fakeAgent()

    await agent.session.setEffort('max')
    await agent.session.setSkills({ 'octopus:review': 'off' })
    await agent.session.setEffort('low')

    expect(agent.flagSettings()[1]).toMatchObject({ effortLevel: 'max' })
    expect(agent.flagSettings()[2]).toMatchObject({
      effortLevel: 'low',
      skillOverrides: { 'octopus:review': 'off' }
    })
  })

  it('puts a skill back by sending a map that no longer names it', async () => {
    const { agent } = fakeAgent()

    await agent.session.setSkills({ 'octopus:review': 'off' })
    await agent.session.setSkills({})

    expect(agent.flagSettings()[1]).toMatchObject({ skillOverrides: {} })
  })

  it('re-reads the skill directories on request', async () => {
    const { agent } = fakeAgent()

    await agent.session.refreshSkills()

    expect(agent.skillReloads()).toBe(1)
  })

  it('asks for an effort at start-up when the chat has one', () => {
    const { agent } = fakeAgent({ effort: 'xhigh' })

    expect(agent.options().effort).toBe('xhigh')
  })

  // Always sent, unlike `resume` and `model`, which are spread in only when
  // there is one: a chat always holds a level, so there is no absence to
  // express — and the composer names the level on the promise that it goes.
  it('always asks for a level, since the chat always has one', () => {
    const { agent } = fakeAgent()

    expect(agent.options().effort).toBe('medium')
  })

  // `ultracode` is not a level the SDK takes, so what goes out is the pair it
  // stands for: the effort it runs at, and the flag that turns the fleet on.
  it('starts ultracode as xhigh with the workflow flags set', () => {
    const { agent } = fakeAgent({ effort: 'ultracode' })

    expect(agent.options().effort).toBe('xhigh')
    expect(agent.options().settings).toEqual({
      ultracode: true,
      enableWorkflows: true,
      skillOverrides: {}
    })
  })

  // Said rather than left out. Nothing else is loaded that could say otherwise
  // — `settingSources` is empty — so silence here would be a session inheriting
  // whatever the last one was started with.
  it('says so at start-up when the level is an ordinary one', () => {
    const { agent } = fakeAgent({ effort: 'high' })

    expect(agent.options().settings).toEqual({
      ultracode: false,
      enableWorkflows: false,
      skillOverrides: {}
    })
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
      applyFlagSettings: () => Promise.resolve(),
      setModel: () => Promise.resolve(),
      supportedModels: () => Promise.resolve([]),
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
        effort: 'medium',
        allowedTools: [],
        additionalDirectories: [],
        skillOverrides: {}
      },
      {
        query: () => conversation,
        onEvent: () => undefined,
        askPermission: () => Promise.resolve({ allow: true } as const)
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
    const { agent } = fakeAgent({}, { askPermission: () => Promise.resolve({ allow: true }) })

    await expect(permissionCall(agent)('Edit', { file_path: '/a.rb' })).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { file_path: '/a.rb' }
    })
  })

  /*
   * How an answer reaches a tool that asked a question.
   *
   * `AskUserQuestion` reads the user's choices off its own input, so the reply
   * releasing the tool call carries a modified copy of the arguments. There is
   * no message to send back and no other way in — get this wrong and the tool
   * runs with nothing in it, which reads to the agent as "nobody answered".
   */
  it('hands a tool the arguments the answer changed', async () => {
    const answered = { questions: [], answers: { 'Which one?': 'the first' } }
    const { agent } = fakeAgent(
      {},
      { askPermission: () => Promise.resolve({ allow: true, updatedInput: answered }) }
    )

    await expect(
      permissionCall(agent)('AskUserQuestion', { questions: [] })
    ).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: answered
    })
  })

  // Arguments that are not an object at all would be a bug in whoever answered,
  // and one a session cannot fix. The agent's own arguments are the safe thing
  // to fall back to: that is what approving a tool means.
  it('falls back to what the agent asked with when the answer is not arguments', async () => {
    const { agent } = fakeAgent(
      {},
      { askPermission: () => Promise.resolve({ allow: true, updatedInput: 'yes please' }) }
    )

    await expect(permissionCall(agent)('Edit', { file_path: '/a.rb' })).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { file_path: '/a.rb' }
    })
  })

  // The SDK's own way to change mode on an approval, and the reason approving
  // a plan can hand the session to the mode chosen for the work that follows.
  // Verified against a live session before being written down: without this
  // field the very next edit asks again.
  it('carries a mode change on an approval that asks for one', async () => {
    const { agent } = fakeAgent(
      {},
      { askPermission: () => Promise.resolve({ allow: true, setMode: 'acceptEdits' }) }
    )

    await expect(permissionCall(agent)('ExitPlanMode', { plan: 'do it' })).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { plan: 'do it' },
      updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]
    })
  })

  // Absent rather than present and empty: the SDK reads the key as a set of
  // updates to apply, and every ordinary approval would otherwise carry one.
  it('says nothing about permissions on an ordinary approval', async () => {
    const { agent } = fakeAgent({}, { askPermission: () => Promise.resolve({ allow: true }) })

    const result = await permissionCall(agent)('Edit', { file_path: '/a.rb' })

    expect(result).not.toHaveProperty('updatedPermissions')
  })

  it('denies with a message the agent can read', async () => {
    const { agent } = fakeAgent(
      {},
      { askPermission: () => Promise.resolve({ allow: false, message: DENIED }) }
    )

    await expect(permissionCall(agent)('Bash', { command: 'rm -rf /' })).resolves.toEqual({
      behavior: 'deny',
      message: DENIED
    })
  })

  // The refusal's message is instruction, not an apology: this is how "not
  // quite, do this instead" reaches the agent without costing a turn.
  it('sends the words the user wrote when a refusal carries them', async () => {
    const { agent } = fakeAgent(
      {},
      {
        askPermission: () => Promise.resolve({ allow: false, message: 'Add a step for the tests' })
      }
    )

    await expect(permissionCall(agent)('ExitPlanMode', { plan: 'do it' })).resolves.toEqual({
      behavior: 'deny',
      message: 'Add a step for the tests'
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
    const asked = vi.fn(() => Promise.resolve<PermissionOutcome>({ allow: true }))
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

describe('the commands a session offers', () => {
  it('asks the running session, since that is the only thing that knows', async () => {
    const { agent } = fakeAgent(
      {},
      {
        commands: [
          {
            name: 'clear',
            description: 'Start a new session with empty context',
            argumentHint: '[name]',
            aliases: ['reset', 'new']
          }
        ]
      }
    )

    await expect(agent.session.commands()).resolves.toEqual([
      {
        name: 'clear',
        description: 'Start a new session with empty context',
        argumentHint: '[name]',
        aliases: ['reset', 'new']
      }
    ])
  })

  // Most commands have no other name, and the SDK simply leaves the field out.
  // A list rather than nothing, because every caller searches it — and one that
  // had to guard for absence would forget.
  it('gives a command with no other name an empty list of them', () => {
    const [command] = toAgentCommands([
      { name: 'usage', description: 'What you have spent', argumentHint: '' }
    ])

    expect(command?.aliases).toEqual([])
  })

  // The SDK's own array, handed straight through, would be shared with whatever
  // else holds it — and this one gets written to disk.
  it('copies the aliases rather than sharing the array the SDK handed over', () => {
    const aliases = ['reset']
    const [command] = toAgentCommands([
      { name: 'clear', description: '', argumentHint: '', aliases }
    ])

    aliases.push('new')
    expect(command?.aliases).toEqual(['reset'])
  })
})

describe('the models the account may use', () => {
  it('asks the running session, since that is the only thing that knows', async () => {
    const { agent } = fakeAgent(
      {},
      {
        models: [
          {
            value: 'claude-opus-5',
            displayName: 'Opus 5',
            description: 'The capable one',
            supportsEffort: true,
            supportedEffortLevels: ['high', 'max']
          }
        ]
      }
    )

    await expect(agent.session.models()).resolves.toEqual([
      {
        value: 'claude-opus-5',
        resolvedModel: null,
        displayName: 'Opus 5',
        description: 'The capable one',
        supportsEffort: true,
        supportedEffortLevels: ['high', 'max']
      }
    ])
  })

  // "Did not say" and "says no" lead to different pickers: the first offers
  // every level, the second offers none. Collapsing both to false would quietly
  // grey out the control for every model that simply stayed quiet.
  it('keeps silence about effort apart from a refusal', () => {
    const [quiet, refusing] = toAgentModels([
      { value: 'a', displayName: 'A', description: '' },
      { value: 'b', displayName: 'B', description: '', supportsEffort: false }
    ])

    expect(quiet?.supportsEffort).toBeNull()
    expect(quiet?.supportedEffortLevels).toBeNull()
    expect(refusing?.supportsEffort).toBe(false)
  })

  // The SDK reports more about a model than a picker has any use for, and
  // letting those fields through would put an SDK shape in the window. The one
  // exception is the name this entry resolves to — see below.
  it('drops what the interface does not need', () => {
    const [model] = toAgentModels([
      {
        value: 'a',
        displayName: 'A',
        description: '',
        supportsFastMode: true,
        supportsAutoMode: true,
        supportsAdaptiveThinking: true
      }
    ])

    expect(model).toEqual({
      value: 'a',
      resolvedModel: null,
      displayName: 'A',
      description: '',
      supportsEffort: null,
      supportedEffortLevels: null
    })
  })

  /*
   * The one SDK field about a model that is kept, because two names for one
   * model reach us from different directions: the catalogue offers the short
   * one, a running session reports itself in full. Without this they read as
   * different models — a second row in the picker for a model already in it.
   */
  it('keeps the full name a short one stands for', () => {
    const [model] = toAgentModels([
      { value: 'sonnet', displayName: 'Sonnet', description: '', resolvedModel: 'claude-sonnet-5' }
    ])

    expect(model?.resolvedModel).toBe('claude-sonnet-5')
  })

  // An entry already spelled out in full has nothing to resolve to.
  it('says nothing where the agent said nothing', () => {
    const [model] = toAgentModels([{ value: 'a', displayName: 'A', description: '' }])

    expect(model?.resolvedModel).toBeNull()
  })
})

/**
 * Both responses as a live CLI actually sent them, trimmed of what we drop.
 *
 * Copied from one throwaway session against build 2.1.228 rather than written
 * from the type declarations. This SDK has already cost three bugs on that
 * difference, and it cost a fourth here: the payload carries nine windows the
 * declaration never mentions — `seven_day_cowork`, `tangelo`, `iguana_necktie`,
 * `nimbus_quill` and more — plus dollar fields on every one of them.
 */
const CONTEXT_RESPONSE = {
  totalTokens: 23_921,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
  percentage: 2,
  autoCompactThreshold: 967_000,
  isAutoCompactEnabled: true,
  categories: [{ name: 'System prompt', tokens: 3313, color: 'promptBorder' }],
  gridRows: [],
  model: 'claude-opus-5[1m]',
  memoryFiles: [],
  mcpTools: [],
  apiUsage: null
} as unknown as Awaited<ReturnType<Query['getContextUsage']>>

const USAGE_RESPONSE = {
  // A session that has not run a turn reports an empty map rather than zeros,
  // which is what a `/usage` typed as a conversation's first message hits.
  // What the mapping does with the rest of this is `usage.test.ts`'s subject.
  session: {
    total_cost_usd: 0,
    total_api_duration_ms: 0,
    total_duration_ms: 695,
    total_lines_added: 0,
    total_lines_removed: 0,
    model_usage: {}
  },
  subscription_type: 'max',
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 18, resets_at: '2026-08-12T19:50:00.149775+00:00' },
    seven_day: { utilization: 84, resets_at: '2026-08-12T22:00:00.149796+00:00' },
    seven_day_opus: null,
    seven_day_sonnet: null,
    nimbus_quill: { utilization: 0, resets_at: null },
    extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null }
  }
} as unknown as Awaited<
  ReturnType<Query['usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET']>
>

/** A `Query` that answers control requests however the test says. */
function queryAnswering(overrides: Record<string, unknown>): Query {
  return overrides as unknown as Query
}

describe('reading how full the context window is', () => {
  it('takes the figures worth showing and leaves the rest', async () => {
    const usage = await readContextUsage(
      queryAnswering({ getContextUsage: () => Promise.resolve(CONTEXT_RESPONSE) })
    )

    expect(usage).toEqual({
      percentage: 2,
      usedTokens: 23_921,
      maxTokens: 1_000_000,
      model: 'claude-opus-5[1m]'
    })
  })

  /*
   * The model rides along because this is the one call that already asks and
   * whose answer is current: measured against a live session, the init that
   * follows a `/model` command still names the *old* model, while this answers
   * correctly the moment the turn ends.
   */
  it('names the model the session is actually running', async () => {
    const usage = await readContextUsage(
      queryAnswering({
        getContextUsage: () =>
          Promise.resolve({ ...CONTEXT_RESPONSE, model: 'claude-haiku-4-5-20251001' })
      })
    )

    expect(usage?.model).toBe('claude-haiku-4-5-20251001')
  })

  // The field arrived later than the rest of the response, so a CLI a few
  // versions back answers without it — and an empty string is not a model.
  it('says nothing about the model when the CLI does not', async () => {
    const { model, ...older } = CONTEXT_RESPONSE
    void model

    await expect(
      readContextUsage(queryAnswering({ getContextUsage: () => Promise.resolve(older) }))
    ).resolves.toMatchObject({ model: null })

    await expect(
      readContextUsage(
        queryAnswering({
          getContextUsage: () => Promise.resolve({ ...CONTEXT_RESPONSE, model: '' })
        })
      )
    ).resolves.toMatchObject({ model: null })
  })

  // The typed package and the CLI binary are versioned separately, so a method
  // the types promise can simply not be there.
  it('says nothing when the CLI has no such control request', async () => {
    await expect(readContextUsage(queryAnswering({}))).resolves.toBeNull()
  })

  it('says nothing when the request is refused', async () => {
    const refusing = queryAnswering({
      getContextUsage: () => Promise.reject(new Error('not ready for writing'))
    })

    await expect(readContextUsage(refusing)).resolves.toBeNull()
  })
})

describe('reading everything /usage answers', () => {
  const asking = (response: unknown): Query =>
    queryAnswering({
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () => Promise.resolve(response)
    })

  it('takes the whole report, not just the two windows the strip wants', async () => {
    const report = await readUsageReport(asking(USAGE_RESPONSE))

    expect(report?.subscriptionType).toBe('max')
    expect(report?.session.wallDurationMs).toBe(695)
    expect(report?.limits.map((limit) => limit.key)).toEqual(['five_hour', 'seven_day'])
  })

  it('says nothing when the CLI has no such control request', async () => {
    await expect(readUsageReport(queryAnswering({}))).resolves.toBeNull()
  })

  it('says nothing when the request is refused', async () => {
    const refusing = queryAnswering({
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () =>
        Promise.reject(new Error('unknown control request'))
    })

    await expect(readUsageReport(refusing)).resolves.toBeNull()
  })

  // The one failure this reading has that the others do not. The SDK says of
  // this API that its shape "may change or be removed in any release without
  // notice", so a response it no longer recognises is a case to expect.
  it('says nothing when the response is in a shape it does not know', async () => {
    await expect(readUsageReport(asking({ session: 'moved elsewhere' }))).resolves.toBeNull()
  })
})

describe('the session, asked about usage', () => {
  it('answers every question from the conversation it holds', async () => {
    const { agent } = fakeAgent()

    await expect(agent.session.contextUsage()).resolves.toMatchObject({ percentage: 2 })
    await expect(agent.session.usageReport()).resolves.toMatchObject({ subscriptionType: 'max' })
  })
})

// The read loop must run to the end of the stream. Leaving it early — after a
// `result`, which looks like the end of the work — closes the transport, and
// every control request afterwards fails. Walked into while probing the usage
// calls; this is what would notice it being walked into again.
describe('the stream the session reads', () => {
  it('still answers control requests after a turn has ended', async () => {
    const { agent } = fakeAgent()

    agent.emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 10,
      total_cost_usd: 0,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0
      },
      session_id: 's-1'
    } as unknown as SDKMessage)
    await settle()

    await expect(agent.session.contextUsage()).resolves.toMatchObject({ percentage: 2 })
    await expect(agent.session.models()).resolves.toEqual([])
  })
})
