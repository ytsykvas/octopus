/**
 * The Agent SDK layer.
 *
 * Two halves, kept apart on purpose. `mapMessage` is a pure function from an
 * SDK message to our own events — it is what stops SDK shapes from reaching
 * the UI (§11.2), and it is testable against message literals with nothing
 * running. `startSession` owns the child process the SDK spawns.
 *
 * `query` arrives as a parameter rather than being imported, so the module can
 * be exercised without a network call, a subscription or a child process —
 * the same reasoning as `makeExec` in the service.
 */

import type {
  Options,
  Query,
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKUserMessage,
  SettingSource
} from '@anthropic-ai/claude-agent-sdk'

import type { PermissionMode } from './chats.js'
import type { AgentEvent } from './events.js'
import { describeError } from './persist.js'

/** The one function this module needs from the SDK. */
export type QueryFn = (params: {
  prompt: AsyncIterable<SDKUserMessage>
  options?: Options
}) => Query

/**
 * Tools that read and never change anything, so they are not worth a prompt.
 *
 * With `settingSources: []` nothing is pre-approved, and without this list the
 * permission dialog would appear for every file the agent opens — which is
 * most of what it does. A prompt that fires constantly is one people learn to
 * dismiss without reading, which costs more transparency than it buys.
 *
 * Network tools are absent deliberately: fetching a URL leaves the machine,
 * and that is a decision worth showing.
 *
 * The SDK logs `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` about this on every start:
 * a bare name in `allowedTools` approves the tool before `canUseTool` is
 * consulted. That is the intended arrangement, not a mistake to tidy away —
 * removing the names to silence the warning would bring back a prompt for
 * every file the agent opens.
 */
export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'NotebookRead', 'TodoWrite'] as const

export interface SessionOptions {
  /** The workspace's worktree — where the agent does its work. */
  readonly cwd: string
  /** A session to continue, or null to start a new one. */
  readonly resume: string | null
  readonly settingSources: readonly SettingSource[]
  readonly permissionMode: PermissionMode
  /** Model override; null leaves the choice to the agent. */
  readonly model: string | null
  /** Tools allowed without asking, on top of the agent's own rules. */
  readonly allowedTools: readonly string[]
}

/** What the agent wants to do, as handed to whoever decides. */
export interface PermissionAsk {
  readonly toolName: string
  readonly input: unknown
}

export interface SessionHooks {
  readonly query: QueryFn
  readonly onEvent: (event: AgentEvent) => void
  /** Answers a permission request; `false` denies it. */
  readonly askPermission: (ask: PermissionAsk) => Promise<boolean>
}

export interface AgentSession {
  /** Queues a message. Returns immediately — the answer arrives as events. */
  send: (text: string) => void
  interrupt: () => Promise<void>
  setPermissionMode: (mode: PermissionMode) => Promise<void>
  /** Ends the session, killing the process the SDK spawned. */
  close: () => Promise<void>
}

/** Message the SDK sends back when the user refuses. */
const DENIED = 'The user declined this action in octopus.'

/**
 * Starts a session and streams its events.
 *
 * The prompt is a stream rather than a string: that is what allows follow-up
 * messages without tearing the session down and paying for the context again
 * (§12.3).
 */
export function startSession(options: SessionOptions, hooks: SessionHooks): AgentSession {
  const input = new InputQueue()

  const conversation = hooks.query({
    prompt: input.stream(),
    options: {
      cwd: options.cwd,
      // Spread rather than passed as null: `exactOptionalPropertyTypes` draws
      // a line between "no override" and "an override that is nothing", and
      // the SDK reads a present `resume` as a session to look for.
      ...(options.resume !== null && { resume: options.resume }),
      ...(options.model !== null && { model: options.model }),
      settingSources: [...options.settingSources],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      permissionMode: options.permissionMode,
      allowedTools: [...options.allowedTools],
      // What makes text appear while it is being written rather than in one
      // block at the end of a turn.
      includePartialMessages: true,
      canUseTool: async (toolName, toolInput) =>
        (await hooks.askPermission({ toolName, input: toolInput }))
          ? { behavior: 'allow', updatedInput: toolInput }
          : { behavior: 'deny', message: DENIED }
    }
  })

  // Started and never awaited. `close` is what actually ends the session —
  // it kills the process the SDK spawned, and the loop then falls out on its
  // own. Waiting for it there would make closing depend on a stream ending,
  // and a stream that does not would hang removing a workspace.
  void (async () => {
    try {
      for await (const message of conversation) {
        for (const event of mapMessage(message)) hooks.onEvent(event)
      }
    } catch (error) {
      // The SDK throws for a failed spawn, a lost subscription or an aborted
      // process. Whatever it was, the chat is the only place the user is
      // looking, so it has to be said there.
      hooks.onEvent({ type: 'error', message: describeError(error) })
    }
  })()

  return {
    send(text) {
      input.push(userMessage(text))
    },

    async interrupt() {
      await conversation.interrupt()
    },

    async setPermissionMode(mode) {
      await conversation.setPermissionMode(mode)
    },

    close() {
      input.close()

      // Wrapped rather than called directly. The SDK's `close` is synchronous,
      // so a failure in it would throw out of this call instead of rejecting
      // the promise every other session method returns — and the caller
      // removing a workspace catches a rejection, not a throw.
      return Promise.resolve().then(() => {
        conversation.close()
      })
    }
  }
}

/**
 * Turns one SDK message into our events.
 *
 * Returns a list because a single assistant message carries several blocks —
 * some prose, a tool call, more prose — and each is an event of its own.
 * Message kinds we do not render map to nothing rather than to a placeholder:
 * the SDK's union has some forty variants and grows between releases.
 */
export function mapMessage(message: SDKMessage): AgentEvent[] {
  switch (message.type) {
    case 'system':
      // The init message is where the session id first appears, and that id is
      // the whole basis of resuming after a restart.
      return message.subtype === 'init'
        ? [{ type: 'session_started', sessionId: message.session_id }]
        : []

    case 'assistant':
      return fromAssistant(message)

    case 'user':
      return fromUser(message)

    case 'stream_event':
      return fromStreamEvent(message)

    case 'result':
      return [
        {
          type: 'result',
          ok: !message.is_error,
          // Already cumulative for the session — the latest result is the
          // total, so summing across results would multiply it. Not a price
          // either; see the note on the schema.
          costUsd: message.total_cost_usd,
          durationMs: message.duration_ms,
          // `usage`, unlike `total_cost_usd` and `modelUsage`, is per-turn.
          inputTokens: promptTokens(message.usage),
          outputTokens: message.usage.output_tokens,
          terminalReason: message.terminal_reason ?? null
        }
      ]

    case 'rate_limit_event':
      return [
        {
          type: 'rate_limit',
          status: message.rate_limit_info.status,
          window: message.rate_limit_info.rateLimitType ?? null,
          utilization: message.rate_limit_info.utilization ?? null,
          resetsAt: toIsoTimestamp(message.rate_limit_info.resetsAt)
        }
      ]

    default:
      return []
  }
}

/**
 * How large the prompt was, all three parts of it.
 *
 * `input_tokens` alone counts only what was *not* cached, and in a running
 * conversation that is almost nothing: a real turn measured here reported 2
 * input tokens beside 17,392 read from cache and 7,825 written to it. Showing
 * the bare field would understate the prompt by four orders of magnitude.
 */
export function promptTokens(usage: {
  readonly input_tokens: number
  readonly cache_read_input_tokens: number
  readonly cache_creation_input_tokens: number
}): number {
  return usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
}

/**
 * The smallest epoch value that has to be milliseconds.
 *
 * `resetsAt` is typed as a bare number with no unit given. Seconds and
 * milliseconds for any date this side of 1973 differ by three orders of
 * magnitude, so telling them apart is a check rather than a guess: a rate
 * limit resets within days, and a seconds value that large would be the year
 * 33658.
 */
const MILLISECONDS_FROM = 1e11

/** An epoch reading in whichever unit it arrived, as an ISO string. */
export function toIsoTimestamp(value: number | undefined): string | null {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return null

  return new Date(value < MILLISECONDS_FROM ? value * 1000 : value).toISOString()
}

/** Prose, reasoning and tool calls all arrive as blocks of one message. */
function fromAssistant(message: SDKAssistantMessage): AgentEvent[] {
  const events: AgentEvent[] = []

  for (const block of message.message.content) {
    // A block with nothing in it is not an event. Reasoning arrives that way
    // routinely — the SDK can be asked to summarise it or omit it, and an
    // omitted one still sends the block for signature continuity, empty. Left
    // through, each drew a disclosure with nothing behind it and left a record
    // in the transcript that remembers nothing.
    if (block.type === 'text' && block.text.trim() !== '') {
      events.push({ type: 'text', text: block.text })
    }
    if (block.type === 'thinking' && block.thinking.trim() !== '') {
      events.push({ type: 'thinking', text: block.thinking })
    }
    if (block.type === 'tool_use') {
      events.push({
        type: 'tool_use',
        toolUseId: block.id,
        name: block.name,
        input: block.input
      })
    }
  }

  return events
}

/**
 * Tool results come back as a user message.
 *
 * Counter-intuitive but correct: the transcript models a tool's answer as
 * something handed *to* the model, so it travels in the user role.
 */
function fromUser(message: SDKUserMessage): AgentEvent[] {
  const content = message.message.content
  if (typeof content === 'string') return []

  const events: AgentEvent[] = []

  for (const block of content) {
    if (block.type !== 'tool_result') continue

    events.push({
      type: 'tool_result',
      toolUseId: block.tool_use_id,
      ok: block.is_error !== true,
      content: describeToolResult(block.content)
    })
  }

  return events
}

/**
 * A tool's output as one string.
 *
 * The field is either a string or a list of blocks, and only the text ones
 * carry anything a chat can show — an image block renders as nothing rather
 * than as `[object Object]`.
 */
function describeToolResult(content: SDKToolResultContent): string {
  if (content === undefined) return ''
  if (typeof content === 'string') return content

  return content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter((text) => text !== '')
    .join('\n')
}

/** What a `tool_result` block may hold, narrowed from the SDK's block union. */
type SDKToolResultContent = string | { type: string; text?: string }[] | undefined

/** Fragments of a block still being written. */
function fromStreamEvent(message: SDKPartialAssistantMessage): AgentEvent[] {
  const event = message.event
  if (event.type !== 'content_block_delta') return []

  const delta = event.delta
  if (delta.type === 'text_delta') return [{ type: 'text_delta', text: delta.text }]
  if (delta.type === 'thinking_delta') return [{ type: 'thinking_delta', text: delta.thinking }]

  // Tool arguments and thinking signatures also stream in. Neither reads as
  // anything mid-flight, and both arrive complete in the message that follows.
  return []
}

function userMessage(text: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    session_id: ''
  }
}

/**
 * The stream of messages the session reads from.
 *
 * A queue rather than a plain generator because the two ends run on different
 * clocks: the UI pushes whenever someone presses enter, and the SDK pulls when
 * it is ready for the next turn. Whichever arrives first waits for the other.
 */
class InputQueue {
  private readonly queued: SDKUserMessage[] = []
  private waiting: ((result: IteratorResult<SDKUserMessage>) => void) | null = null
  private closed = false

  push(message: SDKUserMessage): void {
    // A message sent to a session that is shutting down is dropped rather than
    // queued forever: nothing will ever read it.
    if (this.closed) return

    const pending = this.waiting
    if (pending) {
      this.waiting = null
      pending({ value: message, done: false })
      return
    }

    this.queued.push(message)
  }

  close(): void {
    this.closed = true

    const pending = this.waiting
    if (pending) {
      this.waiting = null
      pending({ value: undefined, done: true })
    }
  }

  /** Ends once the queue is closed and whatever was already queued has gone out. */
  async *stream(): AsyncGenerator<SDKUserMessage> {
    while (!this.closed || this.queued.length > 0) {
      const next = this.queued.shift()
      if (next !== undefined) {
        yield next
        continue
      }

      const arrived = await new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
        this.waiting = resolve
      })

      if (arrived.done === true) return
      yield arrived.value
    }
  }
}
