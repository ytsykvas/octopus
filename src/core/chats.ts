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
import { CodedError } from './codedError.js'
import { type SideExchange, SideExchangeSchema } from './sideQuestions.js'

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
 * The same four the workspace has — a workspace's status is derived from these
 * now, so the two lists cannot disagree without one of them being wrong. Kept
 * as its own enum all the same, because `WorkspaceStatusSchema` lives in
 * `store.ts`, which the renderer may not import values from (§11.1).
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

/**
 * How many closed conversations a workspace keeps to be reopened.
 *
 * Closing a tab used to throw the conversation away, and one stray click lost a
 * whole session. Keeping them all would be a different leak — a record and a
 * transcript per tab, for ever — so the oldest go once this many are waiting.
 * Twenty is a week of closing a tab a day with room to spare, and small enough
 * that the list can be read rather than searched.
 */
export const MAX_CLOSED_CHATS_PER_WORKSPACE = 20

export type ChatErrorCode =
  | 'tooManyChats'
  | 'lastChat'
  | 'nothingToFork'
  | 'forkFailed'
  | 'rewindBusy'
  | 'rewindUnavailable'
  | 'rewindInProgress'
  | 'chatClosed'
  | 'autoModeUnavailable'
  | 'turnRunning'
  | 'sideQuestionUnsupported'
  | 'sideQuestionFailed'
  | 'sideQuestionTimedOut'

/**
 * What putting the files back to a message would do, or did.
 *
 * Counts rather than the files' contents: the question the user is asked is
 * "how much will this undo", and the answer fits in a line. `canRewind` is the
 * agent's own verdict — a message it never checkpointed, or a file changed by
 * something else since, makes it false with a reason in `error`.
 */
export interface FileRewind {
  readonly canRewind: boolean
  readonly error: string | null
  /** Paths as the agent reported them. */
  readonly filesChanged: readonly string[]
  readonly insertions: number
  readonly deletions: number
  /** Files left alone because a link sat at their path — never followed. */
  readonly skippedLinks: number
}

/** A refused operation on a conversation, carrying a code the UI localises. */
export class ChatError extends CodedError<ChatErrorCode> {
  override readonly name = 'ChatError'
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
 *
 * `auto` is not that mode, though it is the nearest one. Its classifier decides
 * each call, but what it cannot decide still comes to the chat as a question,
 * and what it refuses is drawn as a line in the log — so the screen still says
 * what happened. The SDK grants it only to some accounts and models, and says
 * so either by refusing the switch or by starting the session in `default`;
 * the service turns both into a visible fall back to `default`.
 */
export const PERMISSION_MODES = ['default', 'plan', 'acceptEdits', 'auto'] as const
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
export const WORKING_MODES = [
  'default',
  'acceptEdits',
  'auto'
] as const satisfies readonly PermissionMode[]
export const WorkingModeSchema = z.enum(WORKING_MODES)
export type WorkingMode = z.infer<typeof WorkingModeSchema>

/**
 * What an approved plan may be carried out in.
 *
 * Only the two that go ahead without asking about edits: a plan read and
 * approved is the edits agreed in advance, so going back to Manual after it
 * would ask about every step the user has just said yes to.
 */
export const PLAN_EXECUTION_MODES = [
  'acceptEdits',
  'auto'
] as const satisfies readonly WorkingMode[]
export const PlanExecutionModeSchema = z.enum(PLAN_EXECUTION_MODES)
export type PlanExecutionMode = z.infer<typeof PlanExecutionModeSchema>

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
 * The working mode a conversation goes on in once its plan is approved.
 *
 * `executeIn` out of planning — the setting, `acceptEdits` or `auto`. The
 * composer holds one control that cycles through the modes, so there is no
 * second one left to say what should follow a plan, and a plan read and
 * approved is the edits accepted in advance.
 *
 * Only out of planning, though. The agent may call the plan tool from any
 * mode, and handing over there would let it raise a conversation the user set
 * to Manual into one that does not ask, by asking once. And never down from
 * `auto`, which already decides each edit on its own — the CLI makes the same
 * choice, returning to auto when a plan it entered from auto is approved.
 *
 * Here rather than in the service, because the window applies the same rule
 * to its own copy of the record: nothing tells it the record changed.
 */
export function modeAfterPlan(
  chat: { planMode: boolean; workingMode: WorkingMode },
  executeIn: PlanExecutionMode
): WorkingMode {
  return chat.planMode && chat.workingMode !== 'auto' ? executeIn : chat.workingMode
}

/**
 * The model a session actually runs, once planning is folded in.
 *
 * `sessionMode`'s counterpart, and here for the same reason: two stored fields
 * answer one question the SDK asks once, and nothing outside this file should
 * have to remember which of them wins.
 *
 * The three cases `planModel` carries, in order — not planning, or planning
 * with no split, both of which are `model`; planning on the agent's own
 * default; and planning on a named model. Only the last two are a split, and
 * only they can move the running session off what `model` says.
 */
export function sessionModel(chat: {
  planMode: boolean
  model: string | null
  planModel: string | null
}): string | null {
  if (!chat.planMode || chat.planModel === null) return chat.model
  return chat.planModel === DEFAULT_MODEL ? null : chat.planModel
}

/**
 * Which effort a conversation is running at, planning or not.
 *
 * `sessionModel`'s twin, and the argument for it is the same one word for word
 * — arguably harder. Somebody who has Opus think an approach through and Sonnet
 * carry it out wants **more** thinking in the first half and less in the
 * second, which is one judgement of which half used to be expressible.
 *
 * It also costs money in the direction nobody wants: without the split, effort
 * left where planning needed it is what every file edit after the plan is paid
 * for.
 *
 * Two cases rather than `sessionModel`'s three: there is no "the agent's own
 * default" here, because effort is always a level and `null` can mean nothing
 * but "no split".
 */
export function effortInForce(chat: {
  planMode: boolean
  effort: EffortChoice
  planEffort: EffortChoice | null
}): EffortChoice {
  return chat.planMode && chat.planEffort !== null ? chat.planEffort : chat.effort
}

/**
 * The two answers to "what plans, and what writes the code", for one setting —
 * the model or the effort.
 *
 * Presented with the plan as the choice and the writing as the half that may
 * follow it ("same as plan"), while it is **stored the other way round**:
 * `model` and `effort` are always set, and `planModel`/`planEffort` null is "no
 * split". With no split, one value does both jobs, so which half carries it is
 * a matter of naming — and flipping the fields would have been a migration of
 * every record and of the settings for a difference nobody sees. So `work` is
 * the always-set half and `plan` the nullable one, and the functions below are
 * the one place that turns a choice in the presentation into the stored pair.
 * Everything that offers the choice goes through them.
 */
export interface JobPair<T> {
  readonly work: T
  /** Null while there is no split: the writing follows the plan. */
  readonly plan: T | null
}

/** What planning runs on: its own value, or the shared one when there is no split. */
export function planInForce<T>(pair: JobPair<T>): T {
  return pair.plan ?? pair.work
}

/**
 * The pair after choosing what plans.
 *
 * With no split the writing follows the plan, so the shared value moves and the
 * pair stays unsplit.
 */
export function choosePlan<T>(pair: JobPair<T>, value: T): JobPair<T> {
  return pair.plan === null ? { work: value, plan: null } : { work: pair.work, plan: value }
}

/**
 * The pair after choosing what writes the code; null is "the same as the plan".
 *
 * Choosing a value while there is no split is what creates one, and the plan
 * keeps the value it was running on — what the pickers showed it with.
 */
export function chooseWork<T>(pair: JobPair<T>, value: T | null): JobPair<T> {
  if (value === null) return { work: planInForce(pair), plan: null }
  return { work: value, plan: pair.plan ?? pair.work }
}

/**
 * A chat's or a config's two models as a pair of catalogue rows.
 *
 * `model` null is the agent's own default, which the catalogue calls
 * `DEFAULT_MODEL`; read as that row, so the pair can move it into `plan`, where
 * null is already spoken for.
 */
export function modelPair(models: {
  readonly model: string | null
  readonly planModel: string | null
}): JobPair<string> {
  return { work: models.model ?? DEFAULT_MODEL, plan: models.planModel }
}

/** `modelPair` the way back: the default row is stored as null on the writing side. */
export function storedModels(pair: JobPair<string>): {
  model: string | null
  planModel: string | null
} {
  return { model: pair.work === DEFAULT_MODEL ? null : pair.work, planModel: pair.plan }
}

/**
 * The conversation that last sent a message, or null if none ever has.
 *
 * Closed ones count: a tab closed after the work was done is still the one
 * that did it.
 */
export function latestWorkingChat(chats: readonly Chat[]): Chat | null {
  let latest: Chat | null = null
  let latestAt = ''
  for (const chat of chats) {
    // ISO timestamps in one zone sort as text; null never ran.
    if (chat.lastTurnAt === null || chat.lastTurnAt <= latestAt) continue
    latest = chat
    latestAt = chat.lastTurnAt
  }
  return latest
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
 * What a conversation may be set to, which is one more thing than a level.
 *
 * `ultracode` is not a sixth amount of thinking. The SDK spells it as a session
 * flag standing beside `xhigh` — that effort plus dynamic-workflow
 * orchestration — and it belongs here rather than in `EFFORT_LEVELS` for two
 * reasons: `agent.ts` assigns a level straight into the SDK's closed enum, and
 * `supportedEffortLevels` is a list of levels a model reports, which will never
 * name this one.
 *
 * Held as one field rather than as a level plus a boolean, because the two
 * cannot vary independently: `ultracode` with `low` is a state nothing can run
 * and the scale cannot draw. One setting, one value, and the pair is worked out
 * where the SDK needs it.
 */
export const EFFORT_CHOICES = [...EFFORT_LEVELS, 'ultracode'] as const
export const EffortChoiceSchema = z.enum(EFFORT_CHOICES)
export type EffortChoice = z.infer<typeof EffortChoiceSchema>

/**
 * Where a conversation may ask to be compacted, in tokens of context.
 *
 * Five fixed points rather than a number field: the agent takes anything from
 * 100k to 1M, and a free field would invite 1 234 567 — refused at the far end
 * with nothing said here. The choices sit where a 1M window is worth cutting:
 * left alone, such a model compacts only near 967k, by which point every turn
 * pays for a context it mostly no longer reads.
 */
export const AUTO_COMPACT_WINDOWS = [300_000, 400_000, 500_000, 600_000, 800_000] as const
export const AutoCompactWindowSchema = z.literal(AUTO_COMPACT_WINDOWS)
export type AutoCompactWindow = z.infer<typeof AutoCompactWindowSchema>

/**
 * The variable the agent reads ahead of any window a conversation chooses.
 *
 * Here rather than beside the code that looks for it (`autoCompact.ts`), which
 * reads files: the window names it in the message saying it is in the way,
 * and may only take a value from a module that pulls in nothing Node-only.
 */
export const AUTO_COMPACT_VARIABLE = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW'

/**
 * The variables that switch compaction off altogether, whatever window is
 * chosen. Here for the same reason as the one above: the window names them in
 * the message saying nothing will compact.
 */
export const AUTO_COMPACT_OFF_VARIABLES = ['DISABLE_AUTO_COMPACT', 'DISABLE_COMPACT'] as const

/**
 * How far along the way to `against` a context has come, in whole percent.
 *
 * Capped at 100 because the context can sit past the point where the agent
 * compacts for as long as it takes the next turn to begin, and "101%" would
 * say the figure is wrong rather than that compaction is due. Here so the core
 * that reads the agent's figure and the window that moves it after a
 * compaction round alike.
 */
export function contextShare(used: number, against: number): number {
  return Math.min(100, Math.round((used / against) * 100))
}

/**
 * Whether a session measures against another window than its choice gives.
 *
 * The choice capped by what the model holds is what should be in force, and a
 * reading that names anything else strays from it — the variable, whether the
 * start saw it or the CLI took it from a settings file mid-session, or a model
 * holding less than a window nobody has measured. Here so the menu that says
 * so and the core that starts the session over decide it alike. Auto chooses
 * nothing, so there is nothing to stray from.
 */
export function windowStrayed(reading: {
  readonly chosen: AutoCompactWindow | null
  readonly effective: number
  readonly modelWindow: number | null
}): boolean {
  if (reading.chosen === null) return false
  return reading.effective !== Math.min(reading.chosen, reading.modelWindow ?? reading.chosen)
}

/** A chat's choice as it is stored — see `StoredEffortSchema` for the why. */
export const StoredEffortChoiceSchema = EffortChoiceSchema.nullable()
  .default(DEFAULT_EFFORT)
  .transform((choice) => choice ?? DEFAULT_EFFORT)

/**
 * The effort a session actually runs, once `ultracode` is folded out.
 *
 * `sessionMode` and `sessionModel`'s third counterpart, and here for the same
 * reason: one stored field answers two questions the SDK asks separately, and
 * nothing outside this file should have to remember how they divide.
 */
export function sessionEffort(choice: EffortChoice): {
  effort: Effort
  ultracode: boolean
} {
  return choice === 'ultracode'
    ? { effort: 'xhigh', ultracode: true }
    : { effort: choice, ultracode: false }
}

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
 *
 * Compared through what the entries resolve to rather than through the entries
 * themselves. A catalogue holds several rows for one model — `default` and
 * `opus[1m]` both resolve to `claude-opus-5[1m]` — so which row answers depends
 * on which name was asked: `opus[1m]` finds itself, `claude-opus-5[1m]` finds
 * `default`, being the first that resolves to it. Comparing the rows therefore
 * made two names of one model differ, and it did so precisely when the account
 * default was in play, which is the common case.
 *
 * The name is the fallback, for a catalogue that resolves nothing: the CLI in
 * hand sends `resolvedModel` null for every row, and there an entry's own name
 * is all there is to compare.
 */
export function sameModel(one: string, other: string, models: readonly AgentModel[]): boolean {
  if (one === other) return true

  const found = findAgentModel(models, one)
  const against = findAgentModel(models, other)
  if (found === undefined || against === undefined) return false

  return (found.resolvedModel ?? found.value) === (against.resolvedModel ?? against.value)
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
  aliases: z.array(z.string()).default([]),
  /**
   * Whether it is a skill rather than one of Claude Code's own commands.
   *
   * The difference decides where it may be offered. A command runs only at the
   * start of a message, while a skill named after plain text still means
   * something — permission for Claude to run it in that reply — so only skills
   * are suggested mid-sentence. `SlashCommand.builtin` cannot tell the two
   * apart, since the bundled skills are Claude Code's own as well; the session's
   * `init` lists the skills, and `startSession` marks them from that.
   *
   * Defaulted, because it is stored: a list remembered before the field
   * existed has to load, and reads as no skills until the next session.
   */
  skill: z.boolean().default(false)
})

export type AgentCommand = z.infer<typeof AgentCommandSchema>

/**
 * A subagent the session can hand work to, as it reported them.
 *
 * Ours rather than the SDK's `AgentInfo` for the reasons `AgentCommandSchema`
 * gives: the composer draws it, and it is stored. Only what the `@` list shows
 * is kept — the model an agent runs on is the agent's business, not the list's.
 */
export const AgentEntrySchema = z.object({
  /** The agent type, as `@agent-<name>` names it — `Explore`, `my-plugin:review`. */
  name: z.string().min(1),
  description: z.string().default('')
})

export type AgentEntry = z.infer<typeof AgentEntrySchema>

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
 * The command that reports how much of the subscription is left.
 *
 * Named as a literal for the same reason as `clear`, and answered here rather
 * than by the CLI for a different one: the CLI answers it in prose, while the
 * same figures are available structured. See `toUsageReport` in `usage.ts`.
 */
const USAGE_COMMAND = 'usage'

/**
 * Whether a message opens with a particular command, under any of its names.
 *
 * The alias half is why this consults the chat's own list instead of comparing
 * the text to one word: `/reset` and `/new` reach `/clear`, `/cost` and
 * `/stats` reach `/usage`, and the mapping belongs to whichever CLI is on the
 * other end rather than to us.
 */
function isCommand(text: string, command: string, commands: readonly AgentCommand[]): boolean {
  const [word] = text.trim().split(/\s+/)
  if (!word?.startsWith('/')) return false

  const name = bareName(word)
  if (name === command) return true

  /*
   * Every record with that name, not the first.
   *
   * The agent can report two commands under one name — seen live, twice for
   * `code-review` — and this decides whether a message is intercepted or
   * reaches the agent. Reading the aliases off one match made the other's
   * invisible: `/reset` went to the agent while the log stood, claiming a
   * history it no longer had.
   *
   * Whichever record a duplicate came from, its aliases are the user's, so
   * they all count. The list is not ours to curate.
   */
  return commands
    .filter((candidate) => candidate.name === command)
    .some((candidate) => candidate.aliases.some((alias) => bareName(alias) === name))
}

/**
 * Whether a message opens with any command the agent listed, under any name.
 *
 * Text put in front of such a message would stop it being the command, so this
 * is what decides whether something may be.
 */
export function isKnownCommand(text: string, commands: readonly AgentCommand[]): boolean {
  return commands.some((command) => isCommand(text, bareName(command.name), commands))
}

/**
 * Whether this message is the user asking for the conversation to be forgotten.
 *
 * Asked before the message is sent, and remembered, because the event that
 * comes back from an older CLI cannot answer it: the SDK emits
 * `conversation_reset` for leaving plan mode and for fresh-session flows as
 * well, and only a newer one says which. Clearing the visible log on such an
 * event alone would erase the conversation every time a plan was approved.
 */
export function isClearCommand(text: string, commands: readonly AgentCommand[]): boolean {
  return isCommand(text, CLEAR_COMMAND, commands)
}

/**
 * Whether this message is the user asking what the subscription has left.
 *
 * Asked before the message is sent, and unlike `/clear` the message then never
 * goes: this one is answered here, from the structured reading, and forwarding
 * it as well would print the prose version underneath the card.
 */
export function isUsageCommand(text: string, commands: readonly AgentCommand[]): boolean {
  return isCommand(text, USAGE_COMMAND, commands)
}

/**
 * The command that chooses the model for the session.
 *
 * A literal for the same reason as `clear`: nothing in the command list says
 * what a command does, and the name is part of the CLI's contract.
 */
const MODEL_COMMAND = 'model'

/**
 * What the CLI's `opusplan` aliases mean, as the names a catalogue may hold.
 *
 * `opusplan` is "Opus in plan mode, else Sonnet", and `opusplan[1m]` the same
 * on the long-context models. These are facts about the CLI's aliases, written
 * down like `DEFAULT_MODEL`; which models the account actually has is the
 * catalogue's to say.
 *
 * Lists, tried in order, because the catalogue is not guaranteed to spell Opus
 * the way the alias does: a live one holds `opus[1m]` and no plain `opus`, and
 * the row called `default` resolves to the same model without being Opus by
 * name — on another account it is something else.
 *
 * A map rather than an object: the lookup key is whatever the user typed, and
 * `/model constructor` must not find a function on the prototype.
 */
const OPUS_PLAN = new Map<string, { plan: readonly string[]; code: readonly string[] }>([
  ['opusplan', { plan: ['opus', 'opus[1m]'], code: ['sonnet'] }],
  ['opusplan[1m]', { plan: ['opus[1m]'], code: ['sonnet[1m]'] }]
])

/**
 * The first of these the catalogue lists, by the name it goes by.
 *
 * Exact on `value`, deliberately not `findAgentModel`: that one also answers to
 * the name an entry *resolves to*, which would let `default` stand in for Opus.
 */
function firstListed(
  models: readonly AgentModel[],
  candidates: readonly string[]
): string | undefined {
  return candidates.find((candidate) => models.some((model) => model.value === candidate))
}

/** The alias the CLI answers to for "Opus in plan mode, else Sonnet". */
export const OPUS_PLAN_ALIAS = 'opusplan'

/**
 * The pair of catalogue models an `opusplan` alias stands for, or null when the
 * catalogue cannot express it.
 *
 * Null whenever either half is missing, so a record never holds a name the
 * panel cannot tick.
 */
export function opusPlanPair(
  models: readonly AgentModel[],
  alias: string = OPUS_PLAN_ALIAS
): { model: string; planModel: string } | null {
  const names = OPUS_PLAN.get(alias)
  if (names === undefined) return null

  const planModel = firstListed(models, names.plan)
  const model = firstListed(models, names.code)
  if (planModel === undefined || model === undefined) return null

  return { model, planModel }
}

/**
 * What `/model opusplan` means for a chat's two model settings, or null when
 * the message is not that.
 *
 * `/model` is scoped to the session ("for this session only"), so the chat's
 * record is left as it was for every other argument. This one is the exception
 * because the record can say the same thing: a split — Opus planning, Sonnet
 * writing — is exactly what the alias asks for, and without it the panel drew
 * Opus on both rows over a session running two models.
 *
 * The argument is matched exactly: whether the CLI accepts other spellings is
 * not measured, and mirroring a command it refused would put a split in the
 * panel over a session that did not take it.
 */
export function opusPlanSplit(
  text: string,
  commands: readonly AgentCommand[],
  models: readonly AgentModel[]
): { model: string; planModel: string } | null {
  if (!isCommand(text, MODEL_COMMAND, commands)) return null

  // The command word, then exactly one argument.
  const [, argument, ...rest] = text.trim().split(/\s+/)
  if (argument === undefined || rest.length > 0) return null

  return opusPlanPair(models, argument)
}

/**
 * What a chat's two models may be set to in one write; either may be left out.
 *
 * One write rather than one per field: a choice in the panel can move both, and
 * done in two steps the session was told the half-done pair in between.
 */
export const ChatModelsSchema = z.object({
  model: z.string().min(1).nullable().exactOptional(),
  planModel: z.string().min(1).nullable().exactOptional()
})
export type ChatModels = z.infer<typeof ChatModelsSchema>

/** `ChatModelsSchema`'s twin for effort, for the same reason. */
export const ChatEffortsSchema = z.object({
  effort: EffortChoiceSchema.exactOptional(),
  planEffort: EffortChoiceSchema.nullable().exactOptional()
})
export type ChatEfforts = z.infer<typeof ChatEffortsSchema>

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
   * Whether the last turn was cut off by the application exiting rather than
   * brought to an end.
   *
   * `settleStatuses` puts a turn the last run was carrying down to `idle`, and
   * `idle` alone reads as "finished" — a worktree left half-edited by a session
   * that died mid-command was announced as done, and nobody went back to it.
   *
   * A flag beside `status` rather than a fifth value in it: the packaged app
   * reads the same `state.json`, and an older reader throws on a status it does
   * not know, where an unknown key is simply dropped. The price is that two
   * fields describe one state, so it is held by an invariant: true only while
   * `status` is `idle`. `settleStatuses` is the only thing that sets it and
   * `setChatStatus` clears it on every move. Defaulted: a record written before
   * the field existed was not interrupted.
   */
  interrupted: z.boolean().default(false),
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
  /**
   * Where the next session picks the conversation up, after it was rewound.
   *
   * The id of the last message the agent should still remember, handed to the
   * SDK as `resumeSessionAt`. Stored rather than applied at once because the
   * cut only lands once a turn runs on top of it: measured, a session started
   * with it and closed without a message leaves a plain `resume` remembering
   * everything that was cut. So it stays until that turn has finished, and an
   * application closed in between applies it on the next message.
   *
   * Null for the ordinary case, and defaulted: a record from before rewinding
   * existed was never rewound.
   */
  resumeAt: z.string().nullable().default(null),
  /** Model override; null leaves the choice to the agent. */
  model: z.string().nullable(),
  /**
   * Which model plans, when that is not the one that writes the code.
   *
   * Null does **not** mean what it means one line up. `model`'s null is "the
   * agent's own default"; this one is "no split at all" — planning runs on
   * whatever `model` says. The asymmetry is the point: a conversation nobody
   * has opened this panel in behaves exactly as it did before the field
   * existed, which is what a default of null has to buy.
   *
   * "Plan on the agent's default, write the code on something else" is said
   * with `DEFAULT_MODEL`, which is a row the picker offers like any other.
   * `sessionModel` is the one place that folds the three cases back together.
   *
   * Defaulted rather than migrated, the convention `StateSchema` states: a
   * field that can be absent needs a default, not a version bump.
   */
  planModel: z.string().min(1).nullable().default(null),
  /**
   * The effort planning runs at, or null for "the same as the work".
   *
   * `planModel`'s twin and defaulted the same way, for the same reason: a
   * conversation that has never opened this panel behaves exactly as it did
   * before the field existed.
   *
   * `ultracode` is a choice here like any other. It is a decision about one
   * task, and planning is where a task is decided.
   */
  planEffort: EffortChoiceSchema.nullable().default(null),
  /**
   * How much thinking this conversation asks for; always answered.
   *
   * Wider than the settings' own field, which stays a plain level: `ultracode`
   * runs a fleet of agents and is a decision taken about one task, not a mode
   * every new conversation should inherit.
   *
   * Normalised rather than merely defaulted: a record written before the field
   * existed must still load, and so must one written while null was a choice.
   * `readJsonFile` throws on a schema mismatch rather than falling back, so
   * neither case may reach it unanswered — it would stop the app opening.
   */
  effort: StoredEffortChoiceSchema,
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
   * Where this conversation compacts itself, or null for wherever the agent
   * would — its own default, or what `/autocompact` saved for the model.
   *
   * Per conversation, as the effort is: how long a context is worth keeping
   * is a decision about one task. Defaulted rather than migrated: a record
   * written before the field existed left the choice to the agent.
   */
  autoCompactWindow: AutoCompactWindowSchema.nullable().default(null),
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
  /**
   * The subagents this conversation may mention, as the agent last reported.
   *
   * On the chat for the reason `knownCommands` is: a project's own agents live
   * in its `.claude/agents/`, which is a fact about the worktree. Defaulted, so
   * a record written before the `@` list offered agents still loads.
   */
  knownAgents: z.array(AgentEntrySchema).default([]),
  /**
   * Which skills this conversation was told to differ on, and how.
   *
   * Only what the user changed, not the whole answer. The effective state is
   * this over the project's default list over the installation's, so a skill
   * added, renamed or removed after a conversation existed follows the new
   * defaults instead of being stuck at a stale copy of the old ones — and a
   * conversation nobody has opened the panel in stores nothing at all.
   *
   * Keyed by the bare name, whichever source the skill came from — the keys
   * were qualified once, and a live session showed two skills of one name
   * coming back as a single row. `skillKey` is the one place that says so.
   */
  skillOverrides: z.record(z.string(), z.boolean()).default({}),
  createdAt: z.iso.datetime(),
  /**
   * When a turn last started in this conversation, or null if none has.
   *
   * What tells which of a workspace's conversations did the work, so a pull
   * request is described by the model that wrote the change rather than by the
   * settings' default. On the record because the in-memory activity clock is
   * lost with the process, and a restart must not make the answer "nobody".
   *
   * Defaulted rather than migrated, the convention `StateSchema` states: a
   * record written before the field existed simply has not had a turn since.
   */
  lastTurnAt: z.iso.datetime().nullable().default(null),
  /**
   * When this conversation was closed, or null while it is open.
   *
   * A closed conversation keeps its record and its transcript so it can be
   * reopened; everything that means "the tabs of this workspace" skips it.
   *
   * Defaulted rather than migrated, the convention `StateSchema` states: a
   * record written before the field existed was open.
   */
  closedAt: z.iso.datetime().nullable().default(null),
  /**
   * A side question and its answer this conversation was forked off, not yet
   * told to the agent.
   *
   * The fork copies the session as it stood, and the exchange was never part
   * of it, so it rides here until the first message that reaches the agent as
   * a prompt carries it (`formatAside`). Defaulted: a record written before
   * this existed was forked off nothing.
   */
  aside: SideExchangeSchema.nullable().default(null)
})

export type Chat = z.infer<typeof ChatSchema>

/** A closed conversation as the history list draws it. */
export interface ClosedChat {
  readonly chat: Chat
  /** When it was closed; what the list says beside its opening message. */
  readonly closedAt: string
  /** Its opening message on one line, empty if it never had one. */
  readonly preview: string
}

/** Whether a conversation is one of its workspace's tabs rather than history. */
export function isOpenChat(chat: { readonly closedAt: string | null }): boolean {
  return chat.closedAt === null
}

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
 *
 * The number is named so the field can carry it too. A bound only the boundary
 * knows about turns an ordinary keystroke into a refusal a round trip later,
 * where a field that simply stops is what every rename box does — and this is
 * the one cap in the app that is a **name** rather than a body, which is why
 * it is the one worth spending on the field. Truncating a pasted body would be
 * worse than refusing it.
 */
export const MAX_CHAT_TITLE = 60
export const ChatTitleSchema = z.string().max(MAX_CHAT_TITLE)

/** How the user may answer a permission request. */
export const PermissionAnswerSchema = z.enum(['allow', 'always', 'deny'])

/**
 * What the user writes back when a plan is not right yet.
 *
 * Bounded like `ChatMessageSchema` and for the same reason: it reaches the
 * agent as the refusal's message, which is a prompt by another name.
 */
export const PlanFeedbackSchema = z.string().max(10_000)

/**
 * A plan the user rewrote before approving it.
 *
 * Bounded generously — a plan is several screens — but bounded: it replaces the
 * tool's own argument, which the agent then reads and works from, so it is a
 * prompt like the message field is. Never empty: an empty plan is not an edit,
 * it is a way to approve nothing.
 */
export const EditedPlanSchema = z.string().min(1).max(100_000)

export interface NewChatOptions {
  readonly id: string
  readonly agent: AgentKind
  readonly workingMode: WorkingMode
  /** The application-wide default the conversation starts from. */
  readonly effort: Effort
  /** The settings' model, copied in rather than followed: see `newChat`. */
  readonly model: string | null
  readonly planModel: string | null
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
    interrupted: false,
    title: null,
    sessionId: null,
    resumeAt: null,
    // Copied from the settings rather than left null and read through them
    // later: the pair is a starting point, and a conversation that changed it
    // must not move again when the settings do.
    model: options.model,
    planModel: options.planModel,
    effort: options.effort,
    // Null rather than copied from the settings: there is no application-wide
    // "effort for planning", and there should not be — the split is a decision
    // about one conversation's one task.
    planEffort: null,
    workingMode: options.workingMode,
    // Planning first: a new conversation is about a task nobody has scoped yet,
    // and the plan is the cheap place to find out what it is. A fork is the
    // opposite case and starts outside it, see `forkChat`.
    planMode: true,
    autoCompactWindow: null,
    // Nothing known until a session has run: the agent is the only thing that
    // can say which commands and agents this worktree has.
    knownCommands: [],
    knownAgents: [],
    // Empty, which is not the same as "no skills": it means this conversation
    // has been told nothing and follows the defaults, so a skill switched off
    // for the project after this chat was opened is off here too.
    skillOverrides: {},
    closedAt: null,
    aside: null,
    createdAt: options.createdAt,
    lastTurnAt: null
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
  /** The side exchange forked off, when the fork came from a `/btw` answer. */
  readonly aside?: SideExchange
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
  return carryOver(source, options)
}

/**
 * What a new conversation keeps of the one it came from; `forkChat` and
 * `planHandOff` differ only in whether there is a session to continue.
 */
function carryOver(
  source: Chat,
  options: Omit<ForkChatOptions, 'sessionId'> & { readonly sessionId: string | null }
): Chat {
  return {
    id: options.id,
    workspaceId: source.workspaceId,
    agent: source.agent,
    status: 'idle',
    // A fork is a new conversation: what cut the source's last turn off is the
    // source's to report, and this one has not had a turn yet.
    interrupted: false,
    // Not the source's name either, and for the same reason as `planMode`: the
    // fork is a divergence, and two tabs called "auth refactor" is a strip that
    // cannot be read. It takes the automatic name until it is given one.
    //
    // A fork off a side answer is named after its question, as the CLI names
    // its own: that question is what the new conversation is about.
    title: options.aside === undefined ? null : asideTitle(options.aside.question),
    sessionId: options.sessionId,
    // The fork was cut where the source was waiting to be, so it has nothing
    // left to apply.
    resumeAt: null,
    model: source.model,
    planModel: source.planModel,
    // The split comes along, unlike `planMode`. It is a statement about how
    // this task should be approached, and a fork is another go at the same one.
    planEffort: source.planEffort,
    effort: source.effort,
    workingMode: source.workingMode,
    planMode: false,
    // Comes along: how long a context is worth keeping is part of how this
    // work is run, and the fork is the same work.
    autoCompactWindow: source.autoCompactWindow,
    closedAt: null,
    knownCommands: source.knownCommands,
    knownAgents: source.knownAgents,
    // Carried across with the model and the effort, and for the same reason: a
    // fork is the same work in the same place, and a skill switched off
    // because it was getting in the way is still in the way.
    skillOverrides: source.skillOverrides,
    aside: options.aside ?? null,
    createdAt: options.createdAt,
    // The fork has not spoken yet; the source's turns are the source's.
    lastTurnAt: null
  }
}

export interface PlanHandOffOptions {
  readonly id: string
  readonly createdAt: string
  /** What follows the plan — `modeAfterPlan`'s answer, which the window has already worked out. */
  readonly workingMode: WorkingMode
}

/**
 * Builds the conversation that carries out a plan another one made.
 *
 * Not `forkChat`: a fork remembers everything the source did, and what the
 * executor needs is the plan alone. The planning — the files read, the
 * alternatives dropped — is context that costs tokens on every turn after it and
 * pulls the model back towards the approach that was rejected.
 *
 * So there is no session to resume, no history copied and no name, and
 * `planMode` is off: `sessionModel` and `effortInForce` then answer with the
 * models that write code, from the first message. Everything else that
 * describes how the work is run comes along, as it does for a fork, because it
 * is the same work in the same place.
 */
export function planHandOff(source: Chat, options: PlanHandOffOptions): Chat {
  return {
    ...carryOver(source, { id: options.id, sessionId: null, createdAt: options.createdAt }),
    workingMode: options.workingMode
  }
}

/** `btw: <question>` on one line, cut to what a tab name may hold. */
function asideTitle(question: string): string {
  const title = `btw: ${question.replace(/\s+/g, ' ').trim()}`

  return title.length > MAX_CHAT_TITLE ? `${title.slice(0, MAX_CHAT_TITLE - 1)}…` : title
}
