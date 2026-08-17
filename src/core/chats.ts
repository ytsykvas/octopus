/**
 * Chat records — a conversation with one agent inside one workspace.
 *
 * A chat, not a workspace, owns the agent session. That distinction is what let
 * a workspace hold three conversations at once without the stored shape having
 * to change — and what would let a second *kind* of agent join the same way:
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
 * What each agent is called on screen.
 *
 * Not in the locales, because these are proper nouns: no language translates
 * "Claude". Here rather than written into a tab's label so that adding `codex`
 * to the enum above is a compile error here — `Record` is exhaustive — rather
 * than a strip that goes on calling every conversation by the wrong name.
 */
export const AGENT_NAMES: Record<AgentKind, string> = {
  claude: 'Claude'
}

/**
 * Which agent a new conversation is started with.
 *
 * The only one there is, and named rather than written out at each of the three
 * places that create a record — including the tab the strip draws before the
 * record exists, which has to agree with what will be created for it.
 */
export const DEFAULT_AGENT: AgentKind = 'claude'

/**
 * What a conversation is doing.
 *
 * The workspace's own statuses minus `archived`, which is a decision taken
 * about a workspace and not something a conversation can be in. Kept as its own
 * enum rather than reusing `WorkspaceStatusSchema` for exactly that reason —
 * and because that one lives in `store.ts`, which the renderer may not import
 * values from (§11.1).
 */
export const CHAT_STATUSES = ['idle', 'running', 'waiting_permission', 'error'] as const
export const ChatStatusSchema = z.enum(CHAT_STATUSES)
export type ChatStatus = z.infer<typeof ChatStatusSchema>

/**
 * How many conversations one workspace may hold at once.
 *
 * Three because they share a worktree: past that the tabs stop being a way to
 * work in parallel and become a way to lose track of who changed what. Here
 * rather than in `store.ts` because the tab strip needs it as a **value** to
 * know when to stop offering a new one, and this module pulls in nothing
 * Node-only.
 */
export const MAX_CHATS_PER_WORKSPACE = 3

export type ChatErrorCode = 'tooManyChats' | 'lastChat' | 'nothingToFork' | 'forkFailed'

/** A refused operation on a conversation, carrying a code the UI localises. */
export class ChatError extends Error {
  constructor(
    readonly code: ChatErrorCode,
    readonly params: Readonly<Record<string, string>>,
    message: string
  ) {
    super(message)
    this.name = 'ChatError'
  }
}

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

/** What a chat asks for when nobody has said otherwise. */
export const DEFAULT_EFFORT: Effort = 'medium'

/**
 * Effort as it is stored, which is not quite as it arrives.
 *
 * Two shapes of older record, one line for both: the field may be absent, from
 * before it existed, or present and null, from when "the agent decides" was a
 * choice the picker offered. Neither is a level, and there is now exactly one
 * thing to do with them — the composer names the level in force, so there has
 * to be one.
 *
 * `.default()` alone would not do: it answers for a field that is missing, and
 * says nothing about one that is there holding null. `.catch()` would cover
 * both and is deliberately not used — it would swallow a genuinely corrupt
 * level too, and `persist.ts` exists to fail loudly rather than quietly reset.
 *
 * Applied on the way in **and** on the way out, since `persist.ts` writes what
 * the schema returned: an old null is cleaned off the disk the next time
 * anything is saved. `alwaysAllowedTools` is filtered the same way.
 */
export const StoredEffortSchema = EffortSchema.nullable()
  .default(DEFAULT_EFFORT)
  .transform((level) => level ?? DEFAULT_EFFORT)

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
 * What the agent's catalogue calls the entry it picks when asked for nothing.
 *
 * A fact about the CLI rather than about any model, which is why it is written
 * down here while model names are not — the same reasoning as `CLEAR_COMMAND`.
 */
export const DEFAULT_MODEL = 'default'

/**
 * The catalogue entry the `default` row actually runs.
 *
 * The `default` row calls itself "Default (recommended)", which names no model
 * at all. Two things in the catalogue point at the one it stands for, and both
 * are needed because the CLI sends one or the other depending on its version.
 *
 * `resolvedModel` is the good signal — an id, unambiguous — and it is tried
 * first. It is optional in the SDK's own type, though, and the CLI in hand
 * sends it for nothing at all: every row comes back with it null.
 *
 * What that CLI does send is the **description**, copied verbatim onto both
 * rows: `default` and `opus[1m]` are word for word "Opus 5 with 1M context ·
 * Best for everyday, complex tasks", because the default row is built from the
 * row it points at. Weaker than an id and enough — a wording that stopped
 * matching would cost the name, not correctness, since the caller falls back to
 * saying "the default" in words.
 *
 * The `default` row is taken out before either search rather than after:
 * without that, asking for `claude-opus-5[1m]` finds `default` itself, since it
 * is the first entry resolving to that name, and the picker would be back to
 * the word this exists to get rid of.
 *
 * Undefined when there is no `default` row, or when nothing else in the
 * catalogue answers to it either way. It never falls back to the `default`
 * row's own name, which is the one answer that would be no use.
 */
export function defaultAgentModel(models: readonly AgentModel[]): AgentModel | undefined {
  const declared = models.find((model) => model.value === DEFAULT_MODEL)
  if (declared === undefined) return undefined

  const others = models.filter((model) => model.value !== DEFAULT_MODEL)
  if (declared.resolvedModel !== null) return findAgentModel(others, declared.resolvedModel)

  // An empty description would match every row that also has none, which is a
  // coincidence rather than an answer.
  if (declared.description === '') return undefined

  return others.find((model) => model.description === declared.description)
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
  /**
   * What this conversation is doing.
   *
   * On the chat as well as on the workspace, because a workspace holds several
   * and they run at once: a workspace-wide flag meant the tab that finished
   * marked the ones still working as idle. The workspace keeps its own, derived
   * from these — `workspaceStatusFrom` in `store.ts`.
   *
   * Defaulted rather than migrated: a record written before this field existed
   * was not running when it was written, and `settleStatuses` would put it down
   * to `idle` on the next load anyway.
   */
  status: ChatStatusSchema.default('idle'),
  /**
   * A name the user gave this conversation, or null for the one it is given.
   *
   * Null rather than a copy of "Claude 1", and defaulted rather than migrated,
   * for the reason the project icon is: absent is already the right answer, and
   * writing the automatic name down would freeze it — a conversation would keep
   * the number it had when it was opened after the tab beside it was closed.
   * Clearing the field is how the interface says "back to the automatic name",
   * which is a value rather than an absence.
   */
  title: z.string().nullable().default(null),
  /** Agent session id; null until the agent has answered once. */
  sessionId: z.string().nullable(),
  /** Model override; null leaves the choice to the agent. */
  model: z.string().nullable(),
  /**
   * How much thinking this conversation asks for; always a level.
   *
   * Normalised rather than merely defaulted: a record written before the field
   * existed must still load, and so must one written while null was a choice.
   * `readJsonFile` throws on a schema mismatch rather than falling back, so
   * neither case may reach it unanswered — it would stop the app opening.
   */
  effort: StoredEffortSchema,
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

/**
 * A name as accepted from the renderer.
 *
 * Bounded because it is drawn in a tab a few characters wide; past this the
 * strip is carrying a sentence. Empty is allowed and means the automatic name.
 */
export const ChatTitleSchema = z.string().max(60)

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
  readonly effort: Effort
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
    status: 'idle',
    title: null,
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

export interface ForkChatOptions {
  readonly id: string
  /**
   * The **forked** session, never the source's.
   *
   * Resuming a session continues it in place and keeps its id, so two records
   * holding one id would be two agent processes writing one transcript. The
   * caller forks first and passes what came back.
   */
  readonly sessionId: string
  readonly createdAt: string
}

/**
 * Builds a chat continuing another one.
 *
 * Carries across everything that describes how this conversation is run —
 * model, effort, working mode, the commands its worktree offers — because the
 * fork is the same work in the same place, and re-picking all of it would be
 * the first thing anyone did.
 *
 * `planMode` deliberately does not come along. Planning is a decision about a
 * particular task, and forking out of a settled plan to try the other approach
 * is the likeliest reason to fork at all — inheriting it would start the new
 * conversation planning the old one's task.
 */
export function forkChat(source: Chat, options: ForkChatOptions): Chat {
  return {
    id: options.id,
    workspaceId: source.workspaceId,
    agent: source.agent,
    status: 'idle',
    // Not the source's name either, and for the same reason as `planMode`: the
    // fork is a divergence, and two tabs called "auth refactor" is a strip that
    // cannot be read. It takes the automatic name until it is given one.
    title: null,
    sessionId: options.sessionId,
    model: source.model,
    effort: source.effort,
    workingMode: source.workingMode,
    planMode: false,
    knownCommands: source.knownCommands,
    createdAt: options.createdAt
  }
}
