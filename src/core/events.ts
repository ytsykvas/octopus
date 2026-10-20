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

import { AgentCommandSchema, AgentEntrySchema } from './chats.js'
import { ElicitationFieldSchema } from './elicitation.js'
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
 * The tool call whose subagent said or did this, when it was not the main one.
 *
 * Absent on the conversation's own events, and optional rather than nullable so
 * a transcript written before it existed still reads: the SDK says `null` for
 * the main thread, and that is stored as nothing.
 */
const ParentSchema = z.string().optional()

/**
 * What emptied the agent's memory, as the CLI names it: `/clear` or an alias,
 * leaving plan mode with its context cleared, a fresh session for an approved
 * plan, or onboarding run again.
 */
export const ResetTriggerSchema = z.enum(['clear', 'plan_mode_exit', 'fresh_session', 'onboarding'])
export type ResetTrigger = z.infer<typeof ResetTriggerSchema>

/**
 * The lines an edit landed among, and where they start.
 *
 * `startLine` is the 1-based number of the first line of the changed region in
 * the file as it stood after the edit, so everything drawn can be numbered from
 * it. Removed lines are not numbered: they belong to the file as it was, and
 * that is not something we kept.
 */
/**
 * What a tool's structured output says in numbers.
 *
 * Every field optional, because each tool fills only the ones it has: a `Read`
 * its lines, a `Glob` its files, an `Agent` its run totals.
 */
export const ToolStatsSchema = z.object({
  lines: z.number().int().nonnegative().optional(),
  files: z.number().int().nonnegative().optional(),
  matches: z.number().int().nonnegative().optional(),
  toolUses: z.number().int().nonnegative().optional(),
  tokens: z.number().int().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
  /** A subagent sent to the background: its report arrives some other way. */
  background: z.literal(true).optional()
})

export type ToolStats = z.infer<typeof ToolStatsSchema>

const ChangeContextSchema = z.object({
  before: z.array(z.string()),
  after: z.array(z.string()),
  startLine: z.number().int().positive()
})

export type ChangeContext = z.infer<typeof ChangeContextSchema>

export const AgentEventSchema = z.discriminatedUnion('type', [
  /** The session exists and can be resumed by this id. */
  z.object({ type: z.literal('session_started'), sessionId: z.string() }),

  /**
   * A finished block of prose. What the transcript keeps.
   *
   * `uuid` is the wire id the CLI gave the message this came from, kept so a
   * retraction has something to point at. **Optional, and it must stay so:**
   * every line already on disk lacks it, and `readTranscript` drops a line it
   * cannot parse — a required field would erase the history of every
   * conversation on the machine without anything saying so.
   */
  z.object({
    type: z.literal('text'),
    text: z.string(),
    uuid: z.string().optional(),
    parentToolUseId: ParentSchema
  }),

  /** A fragment of prose still being written. Shown, never stored. */
  z.object({ type: z.literal('text_delta'), text: z.string() }),

  z.object({
    type: z.literal('thinking'),
    text: z.string(),
    uuid: z.string().optional(),
    parentToolUseId: ParentSchema
  }),
  z.object({ type: z.literal('thinking_delta'), text: z.string() }),

  z.object({
    type: z.literal('tool_use'),
    toolUseId: z.string(),
    name: z.string(),
    input: ToolInputSchema,
    uuid: z.string().optional(),
    parentToolUseId: ParentSchema
  }),

  z.object({
    type: z.literal('tool_result'),
    toolUseId: z.string(),
    ok: z.boolean(),
    content: z.string(),
    /**
     * Whether `content` is only the head of what the tool actually said.
     *
     * A field rather than a trailing ellipsis in the text, because a later
     * reader has to tell a cut output from one that happened to end that way.
     * Only ever set on the transcript's copy — see `forTranscript` below; the
     * live event carries the whole thing.
     */
    truncated: z.boolean().optional(),
    /**
     * The task a `TaskCreate` call made, by the id later calls refer to it with.
     *
     * Only the tool's structured output carries it — `content` says
     * "Task #1 created successfully", which is prose, not a contract — and
     * without it no later `TaskUpdate` could be matched to the line it changes.
     * Optional: every other result, and every transcript written before, has
     * none.
     */
    taskId: z.string().optional(),
    /**
     * How many lines the whole output had, where `content` keeps only its head.
     *
     * Set by `forTranscript` alongside `truncated`, so "120 lines" reads the
     * same after a restart as it did live. Counting the kept head instead
     * would make the number shrink on reopening.
     */
    lineCount: z.number().int().nonnegative().optional(),
    /**
     * Counts from the tool's structured output.
     *
     * The same argument `taskId` makes: "Found 3 files" is prose, and a summary
     * built by parsing it would break on the next wording change.
     */
    stats: ToolStatsSchema.optional(),
    /**
     * A subagent's final answer, as it wrote it.
     *
     * Its own field because `content` carries the CLI's trailer after the
     * report — the agent's id and a usage block meant for the model, not for a
     * reader. Never cut on disk: it is the one thing the subagent was for.
     */
    report: z.string().optional(),
    uuid: z.string().optional(),
    parentToolUseId: ParentSchema
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
    input: ToolInputSchema,
    /**
     * Why the bridge raised it, where the bridge says.
     *
     * Optional because it is: the SDK sends one for a request with something
     * particular behind it — a file under `.claude/`, a path outside the
     * allowed directories — and nothing for a request the mode explains on its
     * own. Optional also keeps every transcript written before this readable.
     */
    reason: z.string().optional(),
    /**
     * The bridge said a standing answer must not be offered here, so the card
     * draws no "Always". Optional: absent on most requests and on every one
     * written before.
     */
    suppressAlways: z.boolean().optional()
  }),

  /**
   * The bridge withdrew a permission request before anyone answered it.
   *
   * The turn goes on without the answer, so the card has to stop offering
   * buttons that no longer reach anything. Drawn as nothing itself.
   */
  z.object({
    type: z.literal('permission_withdrawn'),
    requestId: z.string()
  }),

  /**
   * An MCP server has stopped mid-call to ask the user something.
   *
   * A different mechanism from the permission request above and from the
   * agent's own questions: this comes from a server the session started, over
   * `onElicitation`, and the SDK **declines it automatically** when nothing
   * answers. So the alternative to drawing it is not a delay, it is a refusal
   * nobody sees.
   *
   * The form is already read by the time it gets here — `elicitation.ts` turns
   * the server's JSON Schema into fields a window can draw, and answers null
   * for anything it cannot. A request whose form could not be read never
   * becomes one of these; it is declined where it arrives, with a reason.
   */
  z.object({
    type: z.literal('elicitation_request'),
    requestId: z.string(),
    /** Which server is asking. The one thing a reader needs to place it. */
    serverName: z.string(),
    /** What it is asking for, in its own words. */
    message: z.string(),
    /** A heading the server offered for the question, where it offered one. */
    title: z.string().default(''),
    fields: z.array(ElicitationFieldSchema)
  }),

  /**
   * The same question, answered or withdrawn.
   *
   * Written into the transcript so a reopened conversation shows that something
   * was asked and what became of it. Without it the log would carry the
   * question for ever, with no sign that it had been dealt with.
   */
  z.object({
    type: z.literal('elicitation_answered'),
    requestId: z.string(),
    action: z.enum(['accept', 'decline', 'cancel'])
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
   * for leaving plan mode and for fresh-session flows. A newer CLI says which
   * in `trigger`; an older one does not, and then it is decided where the
   * message was sent, and travels here. Optional, so a reset stored before the
   * field still reads.
   */
  z.object({
    type: z.literal('conversation_reset'),
    cleared: z.boolean(),
    trigger: ResetTriggerSchema.optional()
  }),

  /**
   * A model refused, and the turn was retried on another one.
   *
   * Kept in the transcript rather than treated as ephemeral. It is the one
   * change of model that is neither the user's decision nor the agent's, and
   * without a line the reader sees the chip name a different model
   * mid-conversation with nothing accounting for it — or, worse, sees a turn
   * that reads as normal with an odd answer.
   *
   * `scope` is the difference between two sentences and not a detail:
   * `session` means the swap outlives the turn and the chip has moved, while
   * `local` means only a subagent, a side question or a background fork fell
   * back and the session model is unchanged.
   *
   * `direction` is not carried. The SDK still types it as
   * `retry | revert | sticky` and emits only `retry`, keeping the other two
   * for consumer compatibility — so there is one shape to draw, and a field
   * whose every value is the same value says nothing.
   *
   * `explanation` is the model's own prose about the refusal, to display and
   * never to parse, and absent more often than not.
   */
  z.object({
    type: z.literal('model_refusal_fallback'),
    originalModel: z.string(),
    fallbackModel: z.string(),
    scope: z.enum(['session', 'local']),
    category: z.string().nullable(),
    explanation: z.string().nullable()
  }),

  /**
   * A model refused, and nothing was retried.
   *
   * The worse of the two wearing the quieter symptom. Where a fallback ran the
   * reader at least gets an answer and a line saying who gave it; here the turn
   * simply ends, and without this the log shows nothing at all — leaving them to
   * work out whether the agent is still thinking, whether the app dropped
   * something, or whether to ask again.
   *
   * Its own member rather than a nullable `fallbackModel` and a nullable
   * `scope` on the one above. Those two would have to agree — null exactly when
   * null — and a shape that can spell a state nothing means is a shape the
   * renderer has to answer for. It also leaves every transcript already written
   * untouched, since no line on disk carries this type.
   *
   * `scope` has nothing to describe: with no retry there is no swap, so the
   * `session`/`local` distinction does not arise. The `why` is carried exactly
   * as it is above — the SDK sends the same two fields either way.
   */
  /**
   * Messages the agent has taken back, named by their wire ids.
   *
   * A model refuses, the CLI retries on another one, and what the first had
   * already said is retracted — a half-answer and any tool results that went
   * with it. The CLI evicts them from its own state; without this the
   * transcript keeps them for ever, so a reopened conversation shows the
   * abandoned work above its replacement and disagrees with what the agent
   * holds.
   *
   * Appended rather than applied by rewriting. The transcript is append-only
   * and the log's React keys are positions in it, so removing an entry would
   * renumber every row below and remount the rest of the conversation — and
   * the file would stop being the record of what happened.
   *
   * The ids are **opaque**. They are matched by equality and an unmatched one
   * is a no-op, which is what the SDK promises and what its own reader does;
   * anything that computed them here would be encoding an implementation.
   */
  z.object({ type: z.literal('retracted'), uuids: z.array(z.string()) }),

  z.object({
    type: z.literal('model_refusal_no_fallback'),
    originalModel: z.string(),
    category: z.string().nullable(),
    explanation: z.string().nullable()
  }),

  /**
   * The list of slash commands, as the session announced it — once it has
   * started, and again whenever it changes.
   *
   * Ephemeral for the same reason as a rate limit: it describes what the agent
   * can do now, not something that happened in the conversation. Reading "the
   * command list changed" back a week later says nothing.
   */
  z.object({ type: z.literal('commands_changed'), commands: z.array(AgentCommandSchema) }),

  /**
   * The subagents the session can hand work to, announced once it has started.
   *
   * Ephemeral like the commands, and for the `@` list what those are for the
   * `/` one. The SDK announces no change to it, so this is ours.
   */
  z.object({ type: z.literal('agents_changed'), agents: z.array(AgentEntrySchema) }),

  /**
   * Where a message the user sent is in the CLI's queue.
   *
   * A message typed while a turn runs waits there until the agent folds it into
   * that turn or starts a turn for it — measured against a live session (SDK
   * 0.3.299): `queued` at once, `started` only when it is taken, seconds later.
   * A Stop does not withdraw it: the interrupt's receipt lists it as still
   * queued, and it runs as a turn of its own. The CLI's `completed` and
   * `cancelled` are one `finished` here, and kept apart from `started` because
   * they arrive **after** the turn's result — a reader taking any of them for
   * "a turn is starting" would wake a conversation that has just ended. Live
   * only, like the deltas.
   */
  z.object({
    type: z.literal('message_queue'),
    messageId: z.string(),
    state: z.enum(['queued', 'started', 'finished'])
  }),

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
   * The plan as the user rewrote it before approving.
   *
   * The agent works from this text, not from the one it wrote — so the log has
   * to say what it was actually told to do. Kept whole: the original is above it
   * in the same log, and the pair is the record of what was changed.
   */
  z.object({ type: z.literal('plan_edited'), plan: z.string() }),

  /**
   * The files were put back to how they were when a message was sent.
   *
   * A row of its own in the log, and in the transcript: it changed the working
   * tree without the agent doing anything, and a conversation read back later
   * would otherwise show the agent's edits with no trace of their being undone.
   * The counts are what the user was shown before agreeing, kept so the record
   * says how much it was.
   */
  z.object({
    type: z.literal('files_rewound'),
    /** The user message the files were restored to. */
    messageId: z.string(),
    files: z.number().int().min(0),
    insertions: z.number().int().min(0),
    deletions: z.number().int().min(0),
    /**
     * Files left alone because a link sat at their path. The rewind never
     * follows one, and a record saying "5 changed" without this would read as
     * though everything it tracked had come back.
     */
    skippedLinks: z.number().int().min(0).default(0)
  }),

  /**
   * The conversation was cut back to before a message.
   *
   * Never written down: the transcript it describes has already been cut, so a
   * line saying so would be the first thing in a history that no longer has
   * what it refers to. It exists to tell every window holding the log to read
   * it again.
   */
  z.object({
    type: z.literal('conversation_rewound'),
    /** The user message the conversation was rewound to — now gone with it. */
    messageId: z.string()
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

  /**
   * The mode the session says it is in.
   *
   * Ephemeral: it describes the session now, and the record is what says what
   * was chosen. It exists for one case — a session asked to start in `auto`
   * that the CLI quietly started in `default`, because the account, the model
   * or a setting does not allow auto mode. Nothing else reports that, so the
   * service reads this to stop the chip claiming a mode that is not running.
   * A plain string rather than the SDK's union, since only one value is read.
   */
  z.object({ type: z.literal('mode_reported'), mode: z.string() }),

  /**
   * A tool call refused without anyone being asked.
   *
   * Mostly auto mode's classifier, which is why it is drawn: a call the
   * classifier blocks otherwise shows only as a failed tool, and a mode that
   * decides on the user's behalf has to leave its decisions on the screen. A
   * deny rule produces the same message, and `byClassifier` tells the two
   * apart. `reason` is the deciding component's own prose, shown and never
   * parsed.
   */
  z.object({
    type: z.literal('permission_denied'),
    toolName: z.string(),
    byClassifier: z.boolean(),
    reason: z.string().nullable()
  }),

  /**
   * Auto mode was asked for and could not be had, so the chat moved to
   * `fallback` — `default`, or `acceptEdits` when auto came from carrying out
   * an approved plan, which Manual would undo.
   *
   * Written by the service rather than mapped from the SDK, which either
   * refuses the switch with a reason or reports a different mode with none.
   * Kept in the transcript: the chip changed on its own, and this is the line
   * that says why — and the only word of it the window gets.
   */
  z.object({
    type: z.literal('auto_mode_unavailable'),
    reason: z.string().nullable(),
    fallback: z.enum(['default', 'acceptEdits'])
  }),

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
 * The command list is ephemeral on the same grounds, and so is the mode the
 * session reports.
 */
/**
 * How much of a successful tool result is worth writing down.
 *
 * Enough to recognise what came back and to make a head of a build log useful,
 * and far short of a file. There is no right number; what there was before was
 * no number at all.
 */
const KEPT_RESULT_CHARS = 2000

/**
 * The event as the transcript should keep it.
 *
 * The sibling of `isEphemeral`: that one says whether an event is written down
 * at all, this one says how much of it. A successful tool result is the only
 * thing they treat differently. The transcript is append-only and never
 * trimmed, so keeping a `Read` of three thousand lines whole made opening a
 * conversation cost what the agent had **read** rather than what it said.
 *
 * The log draws the head of an output under its call and opens into the rest,
 * so the head is what is kept, with `lineCount` saying how long the whole was.
 * Live, the event carries everything; reopened, the expanded row says that
 * only the start was saved.
 *
 * A subagent's `report` is not cut: it is a separate field for exactly that
 * reason.
 *
 * **A failure keeps everything.** Its content is drawn, and is the whole of
 * what a failure says; the pane shortens it from the middle for display, which
 * is a choice about reading rather than about storage, and cutting the tail
 * here would take the half that names the cause.
 */
export function forTranscript(event: AgentEvent): AgentEvent {
  if (event.type !== 'tool_result' || !event.ok) return event
  if (event.content.length <= KEPT_RESULT_CHARS) return event

  return {
    ...event,
    content: event.content.slice(0, KEPT_RESULT_CHARS),
    truncated: true,
    lineCount: countLines(event.content)
  }
}

/** Lines in a tool's output, not counting the newline most of them end with. */
export function countLines(text: string): number {
  if (text === '') return 0
  const lines = text.split('\n')
  return lines.at(-1) === '' ? lines.length - 1 : lines.length
}

export function isEphemeral(event: AgentEvent): boolean {
  return (
    event.type === 'text_delta' ||
    event.type === 'thinking_delta' ||
    event.type === 'rate_limit' ||
    event.type === 'commands_changed' ||
    event.type === 'agents_changed' ||
    event.type === 'message_queue' ||
    event.type === 'conversation_rewound' ||
    event.type === 'mode_reported'
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
