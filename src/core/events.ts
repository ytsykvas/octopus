/**
 * Agent events as everything outside the SDK layer sees them.
 *
 * This is the isolation boundary around the Agent SDK (§11.2 docs/PROJECT.md):
 * the UI only ever sees this union, so a change to the SDK's message shapes
 * stops here instead of reaching the renderer.
 *
 * Declared as a zod schema rather than a bare type because these events are
 * written to a transcript and read back on the next launch. A hand-written
 * type beside a hand-written validator is two things to keep in step, and they
 * drift the first time a variant is added to one of them.
 *
 * zod pulls in nothing from Node, so the renderer may import values from here.
 */

import { z } from 'zod'

import { AgentCommandSchema } from './chats.js'
import { QuestionAnswerSchema } from './questions.js'
import { UsageReportSchema } from './usage.js'

/**
 * Arguments a tool was called with.
 *
 * Left unvalidated on purpose: the shape belongs to whichever tool the model
 * picked, and the UI only renders it. Anything reading a particular field has
 * to narrow it first.
 */
const ToolInputSchema = z.unknown()

/**
 * The lines an edit landed among, and where they start.
 *
 * `startLine` is the 1-based number of the first line of the changed region in
 * the file as it stood after the edit, so everything drawn can be numbered from
 * it. Removed lines are not numbered: they belong to the file as it was, and
 * that is not something we kept.
 */
const ChangeContextSchema = z.object({
  before: z.array(z.string()),
  after: z.array(z.string()),
  startLine: z.number().int().positive()
})

export type ChangeContext = z.infer<typeof ChangeContextSchema>

export const AgentEventSchema = z.discriminatedUnion('type', [
  /** The session exists and can be resumed by this id. */
  z.object({ type: z.literal('session_started'), sessionId: z.string() }),

  /** A finished block of prose. What the transcript keeps. */
  z.object({ type: z.literal('text'), text: z.string() }),

  /** A fragment of prose still being written. Shown, never stored. */
  z.object({ type: z.literal('text_delta'), text: z.string() }),

  z.object({ type: z.literal('thinking'), text: z.string() }),
  z.object({ type: z.literal('thinking_delta'), text: z.string() }),

  z.object({
    type: z.literal('tool_use'),
    toolUseId: z.string(),
    name: z.string(),
    input: ToolInputSchema
  }),

  z.object({
    type: z.literal('tool_result'),
    toolUseId: z.string(),
    ok: z.boolean(),
    content: z.string()
  }),

  /**
   * The lines an edit landed among, read the moment it was made.
   *
   * Its own event rather than a field on the result above, because reading a
   * file is not something `handleEvent` can wait for: made asynchronous, a
   * later event could overtake an earlier one and the log would be drawn out of
   * order. Arriving a moment late is fine; arriving out of order is not.
   *
   * Paired back up by `toolUseId` when the conversation is drawn.
   */
  z.object({
    type: z.literal('change_context'),
    toolUseId: z.string(),
    context: ChangeContextSchema
  }),

  /** The agent wants to do something that needs an answer before it proceeds. */
  z.object({
    type: z.literal('permission_request'),
    requestId: z.string(),
    toolName: z.string(),
    input: ToolInputSchema
  }),

  /**
   * A turn ended.
   *
   * `costUsd` is **not money**. The SDK's own documentation calls it "an
   * estimate, not a billing statement": it is what the same tokens would have
   * cost through the API, which on a subscription is never charged to anyone.
   * It is also cumulative across the session, so it is a usage signal at best.
   *
   * Nothing draws it from here. The one place a figure like it appears is the
   * card `/usage` draws, from that command's own reading — where the cost is
   * the question being asked rather than a number volunteered beside a turn.
   * A footer saying `1.4s · 3.2k tokens · $2.11` would be claiming the turn
   * cost two dollars, and the turn cost nothing.
   */
  z.object({
    type: z.literal('result'),
    ok: z.boolean(),
    costUsd: z.number().nullable(),
    durationMs: z.number().nullable(),
    /**
     * Tokens this turn used.
     *
     * From `result.usage`, which the SDK documents as per-turn in
     * streaming-input sessions — the one figure in a result that is about the
     * turn it closes rather than the session so far.
     */
    inputTokens: z.number().nullable(),
    outputTokens: z.number().nullable(),
    /** Why the turn ended. Null on a CLI old enough not to say. */
    terminalReason: z.string().nullable()
  }),

  /**
   * How much of the subscription's window is gone.
   *
   * The SDK describes this event as "rate limit information for claude.ai
   * subscription users" — which is the thing `costUsd` was mistaken for, only
   * real and in the units that actually apply.
   */
  z.object({
    type: z.literal('rate_limit'),
    status: z.enum(['allowed', 'allowed_warning', 'rejected']),
    /** Which window: `five_hour`, `seven_day`, and so on. */
    window: z.string().nullable(),
    /** Share of the window used. See `readUtilization` in `agent.ts`. */
    utilization: z.number().nullable(),
    resetsAt: z.iso.datetime().nullable()
  }),

  /**
   * What the user chose when the agent asked them something.
   *
   * Kept, and structured rather than the string the tool receives, because this
   * is what a card read back from the transcript is drawn from. Neither of the
   * other two records can do it: the `tool_use` holds the questions as they
   * were *before* anyone answered, and the tool's result is a sentence of
   * English prose. Without this, a conversation reopened a month later could
   * only say that the question had been answered, not what with.
   *
   * It also tells a second window to take its copy of the card down.
   */
  z.object({
    type: z.literal('question_answered'),
    requestId: z.string(),
    answers: z.array(QuestionAnswerSchema)
  }),

  /**
   * The agent's memory of this conversation was replaced with an empty one.
   *
   * Carries no session id, deliberately. The SDK's `new_conversation_id` looks
   * like the thing to resume from and is not: a session started with it fails
   * with "No conversation found with session ID", while the `init` that follows
   * a moment later brings the id that does work — and `session_started` already
   * records that one. Measured against a live session rather than assumed.
   *
   * `cleared` is whether the user asked for this. The SDK emits the same reset
   * for leaving plan mode and for fresh-session flows, so the event alone
   * cannot be read as "the user wanted the log gone" — that is decided where
   * the message was sent, and travels here.
   */
  z.object({ type: z.literal('conversation_reset'), cleared: z.boolean() }),

  /**
   * The list of slash commands changed mid-session.
   *
   * Ephemeral for the same reason as a rate limit: it describes what the agent
   * can do now, not something that happened in the conversation. Reading "the
   * command list changed" back a week later says nothing.
   */
  z.object({ type: z.literal('commands_changed'), commands: z.array(AgentCommandSchema) }),

  /**
   * The agent replaced the older half of the conversation with a summary.
   *
   * Kept in the transcript rather than treated as ephemeral, and that is the
   * point: read back a week later it still says where the agent's memory of
   * this conversation thins out. `conversation_reset` is the same event with
   * the memory wholly discarded instead of partly kept.
   *
   * Every field nullable. They come from metadata the SDK types one way and
   * sends another, so a shape nothing recognises has to degrade the row rather
   * than lose it — the reader's question is whether this was compacted, not by
   * how much.
   */
  z.object({
    type: z.literal('conversation_compacted'),
    /** `auto` is the one nothing else on screen accounts for: nobody asked. */
    trigger: z.enum(['manual', 'auto']).nullable(),
    preTokens: z.number().nullable(),
    postTokens: z.number().nullable()
  }),

  /**
   * What `/usage` was asked and answered.
   *
   * Kept in the transcript, unlike the rate limit two variants up, and the
   * difference is not the data — it is who asked. A rate limit arrives on its
   * own and describes the account rather than the conversation, so a row for it
   * is a row nobody wanted. This one is the answer to a command someone typed,
   * and a transcript that keeps the question and drops the answer is worse than
   * one that keeps neither. That it is a snapshot is the point: it says what was
   * left at the moment it was asked, which is what a dated record is for.
   *
   * Null when the reading failed — an older CLI, a refused control request, a
   * response in a shape we do not know. The card says so. Sending nothing back
   * would leave a `/usage` bubble with silence under it, which reads as a hang.
   */
  z.object({ type: z.literal('usage'), report: UsageReportSchema.nullable() }),

  z.object({ type: z.literal('error'), message: z.string() })
])

export type AgentEvent = Readonly<z.infer<typeof AgentEventSchema>>

/**
 * Whether an event is a live signal rather than a record of what happened.
 *
 * Deltas exist so text appears while the model is still writing it; the
 * complete block follows immediately after and is what the transcript keeps.
 * Storing both would replay every answer twice on the next launch.
 *
 * A rate limit is ephemeral for a different reason: it describes the account
 * at this moment, not the conversation. Reading "you were at 62%" back a week
 * later says nothing, and it would put a row in the log nobody asked for.
 * The command list is ephemeral on the same grounds.
 */
export function isEphemeral(event: AgentEvent): boolean {
  return (
    event.type === 'text_delta' ||
    event.type === 'thinking_delta' ||
    event.type === 'rate_limit' ||
    event.type === 'commands_changed'
  )
}

/**
 * What a turn's ending amounts to, from the SDK's nineteen reasons.
 *
 * Grouped rather than passed through: nineteen localised strings would be
 * nineteen claims about the interface, almost none of which ever appear. Six
 * outcomes are what a reader actually needs to tell apart — and only the first
 * of them is worth staying silent about.
 */
export type TurnOutcome = 'completed' | 'interrupted' | 'limit' | 'tooLong' | 'blocked' | 'failed'

const OUTCOMES: Record<string, TurnOutcome> = {
  completed: 'completed',

  aborted_streaming: 'interrupted',
  aborted_tools: 'interrupted',
  background_requested: 'interrupted',

  blocking_limit: 'limit',
  budget_exhausted: 'limit',
  max_turns: 'limit',
  rapid_refill_breaker: 'limit',

  prompt_too_long: 'tooLong',

  hook_stopped: 'blocked',
  stop_hook_prevented: 'blocked'
}

/**
 * Anything not listed counts as a failure — `model_error`, `api_error`, a
 * deferred tool that never came back, a reason added in a later SDK. Falling
 * back to "it failed" is the reading that misleads least: the alternatives are
 * to claim success or to print a raw identifier at someone.
 */
export function turnOutcome(reason: string | null): TurnOutcome {
  if (reason === null) return 'completed'
  return OUTCOMES[reason] ?? 'failed'
}
