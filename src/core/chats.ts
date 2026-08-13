/**
 * Chat records — a conversation with one agent inside one workspace.
 *
 * A chat, not a workspace, owns the agent session. The distinction costs
 * nothing today, when the UI shows a single chat per workspace, and is what
 * lets a second agent join later without the stored shape having to change:
 * another chat with a different `agent`, sharing the branch and the files.
 *
 * Deliberately free of Node imports so the renderer can import the mode list
 * as a value for its picker, not merely as a type (§11.1).
 */

import { z } from 'zod'

/**
 * Which agent runs a chat.
 *
 * A single-member enum reads like an accident, and it is not: the value is
 * stored, so adding `codex` later is a widened enum rather than a migration of
 * every existing record.
 */
export const AGENT_KINDS = ['claude'] as const
export const AgentKindSchema = z.enum(AGENT_KINDS)
export type AgentKind = z.infer<typeof AgentKindSchema>

/**
 * How much the agent is allowed to do without asking.
 *
 * What the SDK takes, and the only place `plan` appears: nothing stores this
 * union, because planning and the permission level are two independent choices
 * — see `WORKING_MODES` below. A session's mode is computed from both.
 *
 * `bypassPermissions` is absent on purpose — §4 puts transparency above
 * convenience, and a mode where nothing is ever shown is the one setting that
 * cannot be undone by reading the screen.
 */
export const PERMISSION_MODES = ['default', 'plan', 'acceptEdits'] as const
export const PermissionModeSchema = z.enum(PERMISSION_MODES)
export type PermissionMode = z.infer<typeof PermissionModeSchema>

/**
 * How much the agent may do once it is working — the half that is stored.
 *
 * Planning is not a third value here, because it is not a third amount of
 * freedom: it is a question of _when_ the agent acts, answered by `planMode`,
 * and the answer to "and how freely, once it does" has to survive that. Held as
 * one field they cannot both be true, which is why approving a plan used to
 * have no mode to return to.
 *
 * `satisfies` ties the list to the SDK's union, so a value renamed there is a
 * compile error here rather than a mode the session quietly never enters.
 */
export const WORKING_MODES = ['default', 'acceptEdits'] as const satisfies readonly PermissionMode[]
export const WorkingModeSchema = z.enum(WORKING_MODES)
export type WorkingMode = z.infer<typeof WorkingModeSchema>

/**
 * The mode a session actually starts in.
 *
 * The one place the two stored fields are folded back into the SDK's single
 * union, so nothing else has to remember which of them wins.
 */
export function sessionMode(chat: { planMode: boolean; workingMode: WorkingMode }): PermissionMode {
  return chat.planMode ? 'plan' : chat.workingMode
}

/**
 * The tool the agent calls to hand a finished plan back.
 *
 * Named here rather than in `agent.ts` because the renderer needs it too, and
 * may only import _values_ from core modules that pull in nothing Node-only
 * (§11.1) — `agent.ts` reaches the SDK.
 */
export const EXIT_PLAN_MODE = 'ExitPlanMode'

/**
 * How much thinking the agent puts into an answer.
 *
 * A list of names rather than of models, so unlike a model identifier it is
 * safe to write down: the SDK's own type is a closed enum, and `agent.ts`
 * assigns this straight into it — a widened SDK would fail the build rather
 * than drift silently.
 *
 * Which levels a given model actually accepts is the model's business, and it
 * reports that itself. Asking for more than it offers is downgraded rather than
 * refused.
 */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const EffortSchema = z.enum(EFFORT_LEVELS)
export type Effort = z.infer<typeof EffortSchema>

/**
 * A model the account may use, as the agent reported it.
 *
 * Ours rather than the SDK's `ModelInfo`, and narrower: the renderer imports
 * this as a value for its picker, and the SDK's type would drag a Node-only
 * package into the window (§11.1). It is also stored, so it has to be something
 * we can promise the shape of.
 *
 * Nothing here is hardcoded. The list arrives when a session starts and
 * replaces whatever was remembered, so a model added or withdrawn upstream
 * needs no release of ours.
 */
export const AgentModelSchema = z.object({
  /** What the SDK is asked for — `claude-opus-5`, `sonnet`, and so on. */
  value: z.string().min(1),
  /**
   * The full name this one resolves to, when `value` is a short one.
   *
   * `sonnet` and `claude-sonnet-5` are one model under two names, and both are
   * in circulation: the picker offers whichever the catalogue lists, while a
   * running session names itself in full. Without this, the two read as
   * different models — the picker would draw a second row for a model already
   * in it, and offer effort levels the real one does not take.
   *
   * Null when the agent did not say, which is what an entry already spelled out
   * in full has no need to.
   */
  resolvedModel: z.string().nullable().default(null),
  displayName: z.string().min(1),
  description: z.string().default(''),
  /** Null when the agent did not say, in which case every level is offered. */
  supportedEffortLevels: z.array(EffortSchema).nullable().default(null),
  supportsEffort: z.boolean().nullable().default(null)
})

export type AgentModel = z.infer<typeof AgentModelSchema>

/**
 * The catalogue entry for a model, by either of its names.
 *
 * The name in hand may be the short one the picker stored or the full one a
 * session reported, and the entry answers to both.
 *
 * The two passes are not a tidiness: more than one entry can resolve to the
 * same full name — a live catalogue offers `default` and `opus[1m]` both
 * resolving to `claude-opus-5[1m]` — so an exact name has to win over an entry
 * that merely resolves to it, or asking for `opus[1m]` would answer `default`.
 */
export function findAgentModel(
  models: readonly AgentModel[],
  value: string
): AgentModel | undefined {
  return (
    models.find((model) => model.value === value) ??
    models.find((model) => model.resolvedModel === value)
  )
}

/**
 * Whether two names mean the same model, as the catalogue resolves them.
 *
 * A plain string comparison is not enough anywhere this is used: the record may
 * hold `sonnet` while the session reports `claude-sonnet-5`, and reading that
 * as a change would have the interface announce one every time a session
 * started.
 */
export function sameModel(one: string, other: string, models: readonly AgentModel[]): boolean {
  if (one === other) return true

  const found = findAgentModel(models, one)
  return found !== undefined && findAgentModel(models, other)?.value === found.value
}

/**
 * A slash command the agent offers, as it reported them.
 *
 * Ours rather than the SDK's `SlashCommand`, for the same two reasons as
 * `AgentModel`: the renderer needs it as a value to draw the suggestion list,
 * and it is stored, so its shape has to be one we can promise.
 *
 * Every field but the name is defaulted. The SDK types `description` and
 * `argumentHint` as required and `aliases` as optional, but a command read from
 * a project's own `.claude/commands/` is written by hand — a file with no
 * front matter still names a command, and it must not fail the whole list.
 */
export const AgentCommandSchema = z.object({
  /** Without the leading slash, as the SDK reports it. */
  name: z.string().min(1),
  description: z.string().default(''),
  /** What the arguments are, e.g. `<file>`. Empty when it takes none. */
  argumentHint: z.string().default(''),
  /** Other names for the same command — `/cost` and `/stats` both reach `/usage`. */
  aliases: z.array(z.string()).default([])
})

export type AgentCommand = z.infer<typeof AgentCommandSchema>

/**
 * A command name as written, without its slash.
 *
 * Aliases are documented with slashes in the SDK's prose and without them in
 * its examples, so both forms are treated as the same name rather than trusting
 * one and quietly failing to match the other.
 */
function bareName(word: string): string {
  return word.startsWith('/') ? word.slice(1) : word
}

/**
 * The command whose entire job is to make the agent forget the conversation.
 *
 * Named here as a literal because nothing in the command list marks what a
 * command *does* — `SlashCommand` carries a name, a description and a hint, and
 * none of them can be read as "this one discards the context". The name is part
 * of the CLI's contract, so this is a fact about the agent rather than a guess.
 */
const CLEAR_COMMAND = 'clear'

/**
 * Whether this message is the user asking for the conversation to be forgotten.
 *
 * Asked before the message is sent, and remembered, because the event that
 * comes back cannot answer it: the SDK emits `conversation_reset` for leaving
 * plan mode and for fresh-session flows as well. Clearing the visible log on
 * the event alone would erase the conversation every time a plan was approved.
 */
export function isClearCommand(text: string, commands: readonly AgentCommand[]): boolean {
  const [word] = text.trim().split(/\s+/)
  if (!word?.startsWith('/')) return false

  const name = bareName(word)
  if (name === CLEAR_COMMAND) return true

  const clear = commands.find((command) => command.name === CLEAR_COMMAND)
  return clear?.aliases.some((alias) => bareName(alias) === name) ?? false
}

export const ChatSchema = z.object({
  /**
   * A uuid rather than a readable composite.
   *
   * The id becomes a filename for the transcript, and a workspace name reaches
   * it from a repository directory the user did not necessarily choose.
   */
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  agent: AgentKindSchema,
  /** Agent session id; null until the agent has answered once. */
  sessionId: z.string().nullable(),
  /** Model override; null leaves the choice to the agent. */
  model: z.string().nullable(),
  /**
   * Effort override; null leaves the choice to the agent.
   *
   * Defaulted because a record written before this field existed must still
   * load: `readJsonFile` throws on a schema mismatch rather than falling back,
   * so a field without one does not lose the value — it stops the app opening.
   */
  effort: EffortSchema.nullable().default(null),
  /**
   * What replaced the old three-valued `permissionMode`.
   *
   * No migration is written for that field and none is needed: this is a plain
   * object schema, so zod drops the key it no longer knows, and both halves
   * below carry a default. A conversation left stuck in `plan` — which was the
   * bug — therefore loads as an ordinary one that is not planning.
   */
  workingMode: WorkingModeSchema.default('default'),
  planMode: z.boolean().default(false),
  /**
   * The slash commands this conversation may use, as the agent last reported.
   *
   * On the chat rather than beside `knownModels` in the state, because the two
   * lists have different scopes. Which models an account may use is a fact about
   * the account. Which commands exist is a fact about a working directory and
   * the branch checked out in it: `.claude/commands/` lives in the repository,
   * and two workspaces of one project sit on different branches. Remembered
   * globally, a command from one workspace would be suggested in another that
   * does not have it.
   *
   * The cost is that a chat suggests nothing until its first message has
   * started a session — the same trade as `knownModels`, and the honest one.
   */
  knownCommands: z.array(AgentCommandSchema).default([]),
  createdAt: z.iso.datetime()
})

export type Chat = z.infer<typeof ChatSchema>

/**
 * A message as accepted from the renderer.
 *
 * Bounded because it becomes a prompt: anything past this is a pasted file,
 * which belongs in the workspace where the agent can read it rather than in
 * the conversation.
 */
export const ChatMessageSchema = z.string().min(1).max(100_000)

/** How the user may answer a permission request. */
export const PermissionAnswerSchema = z.enum(['allow', 'always', 'deny'])

/**
 * What the user writes back when a plan is not right yet.
 *
 * Bounded like `ChatMessageSchema` and for the same reason: it reaches the
 * agent as the refusal's message, which is a prompt by another name.
 */
export const PlanFeedbackSchema = z.string().max(10_000)

export interface NewChatOptions {
  readonly id: string
  readonly agent: AgentKind
  readonly workingMode: WorkingMode
  /** The application-wide default the conversation starts from. */
  readonly effort: Effort | null
  readonly createdAt: string
}

/**
 * Builds a chat record.
 *
 * The id and the timestamp arrive as parameters rather than being generated
 * here, which keeps the module pure and testable — the same reasoning as
 * `createDefaultConfig`.
 */
export function newChat(workspaceId: string, options: NewChatOptions): Chat {
  return {
    id: options.id,
    workspaceId,
    agent: options.agent,
    sessionId: null,
    model: null,
    effort: options.effort,
    workingMode: options.workingMode,
    // Never planning to begin with. Planning is a decision taken about a
    // particular task, in the composer, once there is a task to plan.
    planMode: false,
    // Nothing known until a session has run: the agent is the only thing that
    // can say which commands this worktree has.
    knownCommands: [],
    createdAt: options.createdAt
  }
}
