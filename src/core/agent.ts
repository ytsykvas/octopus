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

import type { UUID } from 'node:crypto'

import type {
  HookCallback,
  AgentInfo,
  ModelInfo,
  Options,
  Settings,
  PermissionUpdate,
  Query,
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKUserMessage,
  SettingSource,
  SlashCommand
} from '@anthropic-ai/claude-agent-sdk'

import type {
  AgentCommand,
  AgentEntry,
  AgentModel,
  EffortChoice,
  FileRewind,
  PermissionMode
} from './chats.js'
import { contextShare, sessionEffort } from './chats.js'
import { type ContextBreakdown, breakdownFrom } from './contextBreakdown.js'
import { type AnswerValue, type ElicitationField, readForm } from './elicitation.js'
import { type AgentEvent, ResetTriggerSchema } from './events.js'
import { describeError } from './persist.js'
import {
  agentEnv,
  PUBLISH_DENY_RULES,
  PUBLISH_REFUSAL,
  refusesPublish,
  refusesPublishTool
} from './publishGuard.js'
import {
  backgroundTasks,
  taskNotification,
  taskProgress,
  taskStarted,
  taskUpdated
} from './taskEvents.js'
import { readToolOutput } from './toolOutput.js'
import type { SideAnswer, SideExchange } from './sideQuestions.js'
import type { SkillOverride, SkillVisibility } from './skills.js'
import type { UsageReport } from './usage.js'
import { toUsageReport } from './usage.js'

import { z } from 'zod'

/** The one function this module needs from the SDK. */
export type QueryFn = (params: {
  prompt: AsyncIterable<SDKUserMessage>
  options?: Options
}) => Query

/**
 * Tools that read and never change anything, so they are not worth a prompt.
 *
 * A floor, not a ceiling. Every other tool still runs — it asks first, and the
 * user's own `permissions.allow` now answers alongside this, since octopus
 * loads their settings as the CLI does. What this list buys is that the dialog
 * does not fire for every file the agent opens, which is most of what it does:
 * a prompt that fires constantly is one people learn to dismiss without
 * reading.
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
  /**
   * Where to pick `resume` up, when the conversation was rewound: the last
   * entry of the session the agent should still remember. Null continues
   * from the end, and it means nothing without a session to resume.
   */
  readonly resumeAt: string | null
  readonly settingSources: readonly SettingSource[]
  readonly permissionMode: PermissionMode
  /** Model override; null leaves the choice to the agent. */
  readonly model: string | null
  /** How much thinking to ask for; a chat always has an answer. */
  readonly effort: EffortChoice
  /** Tools allowed without asking, on top of the agent's own rules. */
  readonly allowedTools: readonly string[]
  /**
   * Extra working-directory roots — how the skills octopus keeps are found.
   *
   * A root rather than a plugin because a plugin's skills cannot be switched
   * off: `skillOverrides` has no effect on them, measured against a live
   * session, while a skill discovered under a root obeys it like any other.
   * The cost is that these follow `settingSources` as the checkout's own do,
   * which is the honest reading of "load nothing" anyway.
   */
  readonly additionalDirectories: readonly string[]
  /** The workspace's remote URLs and the user's URL rewrites (`pushTargets`), for `agentEnv`. */
  readonly pushTargets: readonly string[]
  /**
   * The workspace's variables (`workspaceEnv`), laid under the publish guard's
   * own, which they cannot displace. Read once, as the session starts;
   * `service.ts` starts the session again when they move.
   */
  readonly env: Readonly<Record<string, string>>
  /**
   * What this conversation was told about each skill the record names, by the
   * name the agent knows (`skillOverridesFor`).
   *
   * Not an allow-list, which would silently hide everything octopus failed to
   * enumerate — Claude Code's own bundled skills first among them. A skill the
   * record says nothing about is not in the map, so a conversation with nothing
   * switched behaves exactly as it did before any of this existed.
   */
  readonly skillOverrides: Readonly<Record<string, SkillOverride>>
  /**
   * Where the conversation compacts itself, in tokens; null leaves it to the
   * agent.
   *
   * Read once, when the session starts. Measured against a live session:
   * `applyFlagSettings` takes the key and changes nothing — `getContextUsage`
   * still reports the window the session began with, before a turn and after
   * one. So it is not among the flags `applyFlags` sends, and a change reaches
   * a conversation by starting its session again (`service.ts`).
   */
  readonly autoCompactWindow: number | null
  /**
   * Whether each running subagent is given a one-line status, written from a
   * fork of its own context. Read once, when the session starts: it is an
   * option of the query, not a flag a running session takes.
   */
  readonly agentProgressSummaries: boolean
}

/** What the agent wants to do, as handed to whoever decides. */
/**
 * One skill a running session holds, as it names it.
 *
 * Ours rather than the SDK's `SlashCommand`, and narrower: the two fields the
 * panel draws and the one that says which group it goes in. The SDK's own doc calls `name` "Skill name (without the leading
 * slash)", which is the key `skillOverrides` is written under — a bare name for
 * an ordinary skill, `plugin:skill` for a plugin's.
 */
export interface AgentSkill {
  readonly name: string
  readonly description: string
  /**
   * Claude Code's own, as `SlashCommand.builtin` documents it — absent from
   * the SDK's answer for anything a user, project, plugin or MCP server
   * defined, and false here for all of those.
   */
  readonly builtin: boolean
}

export interface PermissionAsk {
  readonly toolName: string
  readonly input: unknown
  /**
   * The bridge's own explanation of why this request was raised.
   *
   * The third argument to `canUseTool`, which this used to declare only two of.
   * Without it a request that looks identical to fifty silent ones has nothing
   * to say for itself: measured against a live session, 59 edits under
   * `acceptEdits` passed without a word and the sixtieth — a file under
   * `.claude/` — was asked about, because the CLI guards the agent's own
   * instructions separately. It says so in this field, and the mode looked
   * broken until it was read.
   */
  readonly reason?: string
  /**
   * The narrow rule the bridge says this question was actually about.
   *
   * `{ toolName: 'Edit', ruleContent: '/w/.claude/skills/demo/**' }` for a
   * question about one file there. "Always allow" used to store the tool name
   * alone, which granted an order of magnitude more than was asked — this is
   * what it stores instead.
   */
  readonly suggestions?: readonly PermissionUpdate[]
  /**
   * The bridge saying a standing answer must not be offered for this question.
   *
   * Set when the rule "always" would write grants more than the question's own
   * action — and on exactly those questions the suggestion carries no narrow
   * rule, so the fallback would store the whole tool.
   */
  readonly suppressAlways?: boolean
  /** The background task asking, when a subagent is asking rather than the conversation. */
  readonly taskId?: string
  /** Aborted when the bridge withdraws the question before anyone answered. */
  readonly signal: AbortSignal
}

/**
 * The answer to a permission request.
 *
 * Richer than the boolean it replaces, because two of the three things an
 * answer can carry have no room in one:
 *
 * - a refusal says **why**, and the agent reads that as instruction — it is how
 *   "not quite, do X instead" reaches it without a second turn;
 * - approving a plan is also the moment planning ends, and `setMode` is how the
 *   session is told, on the same reply that releases the tool call.
 */
export type PermissionOutcome =
  | {
      readonly allow: true
      readonly setMode?: PermissionMode
      /**
       * Rules the session should keep, for an answer of "always".
       *
       * The SDK's own suggestion, handed straight back: it names the narrow
       * thing the question was about, and reconstructing that here would be
       * this application guessing at a rule the bridge already wrote.
       */
      readonly standing?: readonly PermissionUpdate[]
      /**
       * The tool's own arguments, changed by whoever answered.
       *
       * How an answer reaches a tool that asked for one. `AskUserQuestion`
       * reads the user's choices off its own input, so the reply that releases
       * it carries a modified copy — there is no message to send back and no
       * other way in.
       */
      readonly updatedInput?: unknown
    }
  | { readonly allow: false; readonly message: string }

/**
 * An answer's arguments, if they are the shape the SDK takes.
 *
 * `PermissionOutcome` types them as `unknown` because what a tool wants back is
 * the tool's business, while the SDK insists on a plain object. Anything else —
 * which is a bug in whoever answered, not something a session can fix — falls
 * back to the arguments the agent asked with.
 */
function asToolInput(input: unknown): Record<string, unknown> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  return { ...input }
}

/** What an approval asks the SDK to remember, if anything. */
function updates(outcome: Extract<PermissionOutcome, { allow: true }>): PermissionUpdate[] {
  return [
    ...(outcome.setMode === undefined
      ? []
      : [{ type: 'setMode' as const, mode: outcome.setMode, destination: 'session' as const }]),
    ...(outcome.standing ?? [])
  ]
}

export interface SessionHooks {
  readonly query: QueryFn
  readonly onEvent: (event: AgentEvent) => void
  /** Answers a permission request. */
  readonly askPermission: (ask: PermissionAsk) => Promise<PermissionOutcome>
  /**
   * Answers an MCP server's question, or declines it.
   *
   * Held open exactly as `askPermission` is: the server is blocked until it
   * comes back, which is what an elicitation is for.
   */
  readonly askElicitation: (ask: ElicitationAsk) => Promise<ElicitationAnswer>
  /**
   * What the settings files this session reads say about each skill they
   * name (`skillsInFiles`) — asked as a skill drops off octopus's map, since
   * that is what it goes back to. Optional because the account probe is
   * never told about skills; a session left without it goes back to `'on'`.
   */
  readonly skillsInFiles?: () => Promise<ReadonlyMap<string, SkillVisibility>>
  /**
   * A refusal for a shell command, or null to let it run (`branchGuard`) —
   * beside the publish guard every session carries. Optional because the
   * account probe works on no branch.
   */
  readonly refuseCommand?: (command: string) => string | null
}

/** What an MCP server wants from the user, once the form has been read. */
export interface ElicitationAsk {
  readonly serverName: string
  readonly message: string
  /** A heading the server offered, where it offered one. */
  readonly title: string
  readonly fields: readonly ElicitationField[]
}

/** What comes back. `content` only for an answer, and only what was filled in. */
export type ElicitationAnswer =
  | { readonly action: 'accept'; readonly content: Readonly<Record<string, AnswerValue>> }
  | { readonly action: 'decline' | 'cancel' }

export interface AgentSession {
  /**
   * Queues a message. Returns immediately — the answer arrives as events.
   *
   * `messageId` is the id the agent will know it by, kept so the files can be
   * put back to the point it was sent; without one the message cannot be
   * rewound to.
   */
  send: (text: string, messageId?: UUID) => void
  /**
   * What putting the files back to a message would do — or does, without
   * `dryRun`. Needs the checkpointing the session was started with.
   */
  rewindFiles: (messageId: string, dryRun: boolean) => Promise<FileRewind>
  interrupt: () => Promise<void>
  /** Stops one background task — a subagent, a command, a workflow — and nothing else. */
  stopTask: (taskId: string) => Promise<void>
  setPermissionMode: (mode: PermissionMode) => Promise<void>
  setEffort: (effort: EffortChoice) => Promise<void>
  /** Changes the model for what follows; null hands the choice back. */
  setModel: (model: string | null) => Promise<void>
  /** Tells this conversation what is on and off now, mid-turn. */
  setSkills: (skillOverrides: Readonly<Record<string, SkillOverride>>) => Promise<void>
  /**
   * Re-reads the skill directories and answers with everything the session has.
   *
   * The answer is the point as much as the re-read is. It is the only reading
   * of what the agent actually holds — Claude Code's bundled skills, the user's
   * `~/.claude/skills` and a plugin's are all in it, and none of them is in a
   * directory octopus looks at. Measured against a live session: standing in a
   * temporary directory with no project skills at all, it came back with
   * `dataviz`, `code-review`, `commit-commands:commit` and a dozen more.
   *
   * `supportedCommands()` is the wrong call for this and was the obvious one:
   * it mixes skills with built-in commands and `SlashCommand` says nothing
   * about which is which — 53 entries against this call's 25 in the same
   * checkout.
   */
  refreshSkills: () => Promise<AgentSkill[]>
  /**
   * Re-reads the installed plugins, for one installed, removed or switched
   * while this conversation was open.
   *
   * Nothing else would: no watcher picks a plugin change up, and without this
   * the session goes on with what it loaded at start. Measured on 2.1.299: the
   * plugin's commands and skills arrive, the session announces them itself with
   * `commands_changed`, and a plugin's MCP server connects — the docs say it
   * waits for a new session, and it did not.
   */
  reloadPlugins: () => Promise<void>
  /** What this account may use, as the agent reported when the session began. */
  models: () => Promise<AgentModel[]>
  /** The slash commands this session offers, agent's own and the project's. */
  /** How full this conversation's context window is, or null if it cannot say. */
  contextUsage: () => Promise<ContextUsage | null>
  /**
   * Everything `/usage` answers, or null if the session cannot say.
   *
   * `skipBehaviors` leaves out the scan of local transcripts that fills
   * `contributing`. The sidebar draws none of it and asks every few minutes, so
   * it says so; the card a typed `/usage` draws wants all of it.
   */
  usageReport: (options?: UsageReadOptions) => Promise<UsageReport | null>
  /** A `/btw` answered beside the conversation; see `askSideQuestion`. */
  sideQuestion: (
    question: string,
    history: readonly SideExchange[],
    signal?: AbortSignal
  ) => Promise<SideAnswer | null>
  /** Ends the session, killing the process the SDK spawned. */
  close: () => Promise<void>
}

/** What a usage read may leave out. */
export interface UsageReadOptions {
  readonly skipBehaviors?: boolean
}

/** How full a conversation's context window is, and what is filling it. */
export interface ContextUsage {
  /**
   * Whole percent of the way to `compactsAt`, so 100 means the next turn
   * compacts. Counted to the window only where the agent names no point, which
   * is when it will not compact at all or is too old to say where.
   */
  readonly percentage: number
  readonly usedTokens: number
  /** The window compaction is measured against, which is not where it fires. */
  readonly maxTokens: number
  /**
   * Where the agent compacts on its own, or null when it will not — switched
   * off, or a CLI that predates the field.
   *
   * Short of `maxTokens` by the room a summary needs (13 000 in 2.1.311), which
   * is why a conversation at 91% of its window had not compacted yet: the
   * agent's own reading counted to the window, and the gauge repeated it.
   */
  readonly compactsAt: number | null
  /** Whether the agent compacts on its own, or null when it did not say. */
  readonly autoCompactOn: boolean | null
  /**
   * The model the session is actually running, in full — `claude-haiku-4-5…`.
   *
   * The only reading of it that is both current and immediate, and it rides
   * along here because this is the one call that already asks. Measured: after
   * `/model haiku` the init of that same turn still names the old model — the
   * new one appears an init later — while this answers correctly the moment the
   * turn ends. Null on a CLI old enough not to say.
   */
  readonly model: string | null
  /**
   * How much the model itself can hold, or null until a turn has said.
   *
   * Not `maxTokens`, which is the window the threshold is taken from and
   * shrinks with it — nor `rawMaxTokens`, which measured the same. The model's
   * own limit is only in a turn's result (`modelUsage[model].contextWindow`):
   * 1M for Opus 5.5, 200k for Haiku 4.5. A window chosen above it is cut down
   * to it, so the menu needs it to say which choices would do nothing.
   */
  readonly modelWindow: number | null
  /** What fills the window, or null when the CLI did not say in a shape we read. */
  readonly breakdown: ContextBreakdown | null
}

/**
 * What a result says each model holds.
 *
 * Parsed rather than read off the type: the CLI binary is versioned apart from
 * this package, and a result from one that predates the field — or a field of
 * another shape — must cost the menu its hint, not the conversation its turn.
 */
const ModelWindowsSchema = z.record(z.string(), z.looseObject({ contextWindow: z.number() }))

function windowsIn(result: { readonly modelUsage?: unknown }): [string, number][] {
  const parsed = ModelWindowsSchema.safeParse(result.modelUsage)
  if (!parsed.success) return []

  return Object.entries(parsed.data).map(([model, usage]) => [model, usage.contextWindow])
}

/**
 * Control methods the CLI on the other end may not have.
 *
 * Two different failures, and this one line covers both — which is why it must
 * not be "simplified" to `any`:
 *
 * - if the SDK **renames** a method, `Pick` stops compiling and the build fails
 *   pointing here. The SDK asks for exactly that: it says of the usage call
 *   that "the method name will change when the API is stabilized".
 * - if the **CLI binary is a different version from the typed package** — and it
 *   is versioned separately, under `~/.local/share/claude/versions` — the
 *   property is simply absent at runtime, and the guard below returns null.
 */
type UsageCapable = Partial<
  Pick<Query, 'getContextUsage' | 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET'>
>

/**
 * How full the context window is, or null when the agent will not say.
 *
 * Null rather than a throw: this fills a gauge, and a reading that failed is
 * not a reason to fail whatever asked for it.
 *
 * Measured against a live session rather than assumed: the response is far
 * wider than the type declares — a hundred grid squares for the CLI's own bar
 * chart, a category breakdown, memory files, MCP tools. The rest stops here.
 *
 * The share is counted to where the agent compacts, not to the window it
 * reports: `percentage` in the response is the latter, and a conversation
 * shown at 91% that then sat there was read as an agent that had stopped
 * compacting.
 */
export async function readContextUsage(
  conversation: Query,
  // What the turns so far said each model holds; nothing by default, since a
  // reading taken before any turn has nothing to go on.
  windowOf: (model: string) => number | undefined = () => undefined
): Promise<ContextUsage | null> {
  const ask = (conversation as UsageCapable).getContextUsage
  if (typeof ask !== 'function') return null

  try {
    const usage = await ask.call(conversation)
    const model = typeof usage.model === 'string' && usage.model !== '' ? usage.model : null
    // Defended like `model`: the CLI is versioned apart from this package. An
    // agent that is off sends no threshold, and one that is on but too old to
    // send it leaves the window as the only point there is.
    const autoCompactOn =
      typeof usage.isAutoCompactEnabled === 'boolean' ? usage.isAutoCompactEnabled : null
    const compactsAt =
      autoCompactOn !== false &&
      typeof usage.autoCompactThreshold === 'number' &&
      usage.autoCompactThreshold > 0
        ? usage.autoCompactThreshold
        : null
    return {
      percentage:
        compactsAt === null ? usage.percentage : contextShare(usage.totalTokens, compactsAt),
      usedTokens: usage.totalTokens,
      maxTokens: usage.maxTokens,
      compactsAt,
      autoCompactOn,
      // Defended rather than taken: this arrived later than the rest of the
      // response, so a CLI a few versions back answers without it.
      model,
      modelWindow: (model === null ? undefined : windowOf(model)) ?? null,
      breakdown: breakdownFrom(usage)
    }
  } catch {
    return null
  }
}

/**
 * Everything `/usage` answers, or null when the session will not say.
 *
 * The one way this response is read. There were two for a while — this and a
 * narrower `readSubscriptionUsage` for the sidebar's two windows — on the
 * argument that the strip wanted two numbers often and the card wanted
 * everything rarely. Measured, the ask is the same control request either way
 * (250ms the first time, under 40ms after) and the narrowing is free, so the
 * second reader bought nothing and cost the sidebar every window it dropped.
 *
 * Null covers every ordinary failure: an older CLI without the method, a
 * refused control request, and one more — a response whose shape
 * `toUsageReport` does not recognise. The API is marked experimental and says
 * its own shape may change without notice, so that is a case to expect rather
 * than one to be surprised by.
 */
export async function readUsageReport(
  conversation: Query,
  options?: UsageReadOptions
): Promise<UsageReport | null> {
  const ask = (conversation as UsageCapable)
    .usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET
  if (typeof ask !== 'function') return null

  try {
    return toUsageReport(await ask.call(conversation, options))
  } catch {
    return null
  }
}

/**
 * `askSideQuestion` is in the SDK's runtime (VS Code's `/btw` calls it) but not
 * in `sdk.d.ts`, so it is declared here and its reply is schema-checked.
 */
interface SideQuestionCapable {
  askSideQuestion?: (
    question: string,
    options?: { history?: SideExchange[]; signal?: AbortSignal }
  ) => Promise<unknown>
}

const SideReplySchema = z.object({ response: z.string(), synthetic: z.boolean().optional() })

/** The agent has no side-question call to make: an older CLI, or a newer SDK that moved it. */
export class SideQuestionUnsupportedError extends Error {
  override readonly name = 'SideQuestionUnsupportedError'
}

/**
 * Asks a `/btw` of a live conversation; see docs/core/conversations.md for what the CLI does.
 *
 * Null when the CLI had no answer. A refused or aborted request is rethrown.
 */
export async function askSideQuestion(
  conversation: Query,
  question: string,
  history: readonly SideExchange[],
  signal?: AbortSignal
): Promise<SideAnswer | null> {
  const ask = (conversation as SideQuestionCapable).askSideQuestion
  if (typeof ask !== 'function') {
    throw new SideQuestionUnsupportedError('This agent cannot answer side questions.')
  }

  const reply = await ask.call(conversation, question, {
    history: [...history],
    ...(signal && { signal })
  })
  const parsed = SideReplySchema.safeParse(reply)
  if (!parsed.success) return null

  return { text: parsed.data.response, synthetic: parsed.data.synthetic ?? false }
}

/**
 * The SDK's model descriptions, narrowed to what a picker needs.
 *
 * Pure, so it is testable against literals — the same reasoning as
 * `mapMessage`, and the same job: an SDK shape stops here.
 *
 * `description` may be absent in practice even though the type says otherwise,
 * which is why the schema defaults it; the effort fields are genuinely optional
 * and become null rather than false, because "did not say" and "says no" lead
 * to different pickers.
 */
export function toAgentModels(models: readonly ModelInfo[]): AgentModel[] {
  return models.map((model) => ({
    value: model.value,
    // Kept, unlike the rest of what the SDK reports about a model: a session
    // names itself in full while the catalogue may offer a short name, and
    // without this the two read as different models.
    resolvedModel: model.resolvedModel ?? null,
    displayName: model.displayName,
    description: model.description,
    supportedEffortLevels: model.supportedEffortLevels ? [...model.supportedEffortLevels] : null,
    supportsEffort: model.supportsEffort ?? null
  }))
}

/** The SDK's subagents, narrowed to what the `@` list shows. */
export function toAgentEntries(agents: readonly AgentInfo[]): AgentEntry[] {
  return agents.map((agent) => ({ name: agent.name, description: agent.description }))
}

/** What a message is read against before the session has said which skills it has. */
const NO_SKILLS: ReadonlySet<string> = new Set()

/**
 * The SDK's command descriptions, narrowed to what a suggestion list needs.
 *
 * Pure, so it is testable against literals — the same job as `toAgentModels`:
 * an SDK shape stops here.
 *
 * `aliases` becomes a list rather than staying absent, because the schema
 * stores it and a suggestion list searches it: `/reset` and `/new` both reach
 * `/clear`, and a missing array would have every caller guard for it. The two
 * required strings are taken at their word, exactly as `toAgentModels` does —
 * and the stored schema defaults them anyway, so a CLI that omits one loads
 * back as empty rather than as a record that will not parse.
 *
 * `skills` is the session's `init` list, which is the only place that says
 * which commands are skills. Matched on aliases too: a skill synced from
 * claude.ai is listed by the name it is typed as and may carry its qualified
 * name as an alias.
 */
export function toAgentCommands(
  commands: readonly SlashCommand[],
  skills: ReadonlySet<string> = NO_SKILLS
): AgentCommand[] {
  return commands.map((command) => {
    const aliases = command.aliases ? [...command.aliases] : []

    return {
      name: command.name,
      description: command.description,
      argumentHint: command.argumentHint,
      aliases,
      skill: [command.name, ...aliases].some((name) => skills.has(name))
    }
  })
}

/**
 * What a refusal says when the user gave no words of their own.
 *
 * Exported because the answer is now composed where it is decided rather than
 * here: a refusal may carry the user's own note instead, and this is the
 * fallback for when it does not.
 */
export const DENIED = 'The user declined this action in octopus.'

/** The tools that run a shell command, each carrying it in `tool_input.command`. */
const SHELL_TOOLS = 'Bash|Monitor|PowerShell'

const ShellCallSchema = z.object({
  tool_name: z.string(),
  tool_input: z.object({ command: z.string() })
})
const McpCallSchema = z.object({ tool_name: z.string() })
const AgentCallSchema = z.object({ tool_input: z.object({ isolation: z.string().optional() }) })

/** What the agent is told when a guard itself failed, so nothing it was asked to check ran. */
export const GUARD_FAILED = 'Octopus could not check this call, so it was not run.'

/**
 * A hook that denies when `guard` names a reason — and when `guard` throws.
 *
 * An exception escaping a hook is not a decision the SDK promises to treat as a
 * refusal, and a guard that fails open is not a guard.
 */
function denying(guard: (input: unknown) => string | null): HookCallback {
  return (input) => {
    let reason: string | null
    try {
      reason = guard(input)
    } catch {
      reason = GUARD_FAILED
    }
    return Promise.resolve(
      reason === null
        ? {}
        : {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse' as const,
              permissionDecision: 'deny' as const,
              permissionDecisionReason: reason
            }
          }
    )
  }
}

/**
 * The SDK hooks that keep the agent from publishing, and put `refuseCommand`
 * in front of every shell command as well.
 *
 * A hook rather than a check in `canUseTool`, which is consulted last: a
 * command the user's own allow rules cover, or one `auto` mode approves, never
 * reaches it. A `PreToolUse` refusal holds in every mode, and inside subagents.
 */
export function toolGuards(
  refuseCommand?: (command: string) => string | null
): NonNullable<Options['hooks']> {
  return {
    PreToolUse: [
      {
        matcher: SHELL_TOOLS,
        hooks: [
          denying((input) => {
            const call = ShellCallSchema.safeParse(input)
            if (!call.success) return null
            const { command } = call.data.tool_input
            // PowerShell escapes with a backtick: ``g`h`` runs gh.
            const read =
              call.data.tool_name === 'PowerShell' ? command.replaceAll('`', '') : command
            return refusesPublish(read) ?? refuseCommand?.(command) ?? null
          })
        ]
      },
      {
        matcher: '^mcp__',
        hooks: [
          denying((input) => {
            const call = McpCallSchema.safeParse(input)
            return call.success ? refusesPublishTool(call.data.tool_name) : null
          })
        ]
      },
      {
        // A subagent in the cloud runs where none of these layers reach.
        matcher: 'Agent',
        hooks: [
          denying((input) => {
            const call = AgentCallSchema.safeParse(input)
            return call.success && call.data.tool_input.isolation === 'remote'
              ? PUBLISH_REFUSAL
              : null
          })
        ]
      }
    ]
  }
}

const CwdChangedSchema = z.object({
  old_cwd: z.string(),
  new_cwd: z.string(),
  // Present only inside a subagent, the SDK says; the main thread has none.
  agent_id: z.string().optional()
})

/**
 * The SDK hook that says where a shell command left the session.
 *
 * The CLI keeps the directory a Bash command ends in as the session's working
 * directory, so a `cd` into another worktree moves every call after it while
 * nothing in the call says so. Its `CwdChanged` hook fires after each shell
 * command that moved it — measured on SDK 0.3.307: on `cd` into, back out of
 * and away from the worktree, and not on `EnterWorktree` or `ExitWorktree`,
 * which the log draws from the call. A subagent's move is left out: it moves
 * the subagent, which ends with its task, and the conversation not at all.
 *
 * On its own the callback never runs; `CWD_WATCH_SETTINGS` is its other half.
 */
export function cwdWatch(onMove: (event: AgentEvent) => void): NonNullable<Options['hooks']> {
  return {
    CwdChanged: [
      {
        hooks: [
          (input) => {
            const moved = CwdChangedSchema.safeParse(input)
            if (moved.success && moved.data.agent_id === undefined) {
              onMove({ type: 'cwd_changed', from: moved.data.old_cwd, to: moved.data.new_cwd })
            }
            return Promise.resolve({})
          }
        ]
      }
    ]
  }
}

/**
 * The settings side of `cwdWatch`, without which it never fires.
 *
 * Measured on SDK 0.3.307: the `CwdChanged` callback runs only when a command
 * hook for the same event is also configured — here, in the flag-settings
 * layer. The callback alone, with `includeHookEvents`, in every permission
 * mode, ran not once across a dozen moves; with this beside it, on every one.
 * The command is `true`, so the shell's part is nothing. The CLI merges hooks
 * across its sources, so a user's own hook for the event keeps running too.
 */
export const CWD_WATCH_SETTINGS: NonNullable<Settings['hooks']> = {
  CwdChanged: [{ hooks: [{ type: 'command', command: 'true' }] }]
}

const PostCompactSchema = z.object({
  compact_summary: z.string(),
  // Present only inside a subagent, the SDK says; the main thread has none.
  agent_id: z.string().optional()
})

/**
 * The part of what the compaction wrote that the agent keeps.
 *
 * Measured on CLI 2.1.311 (`npm run probe:compaction`): the hook gets the
 * model's working in `<analysis>`, then the summary in `<summary>`. The summary
 * is what the conversation goes on from; the analysis is scratch work. Text
 * with neither tag is taken whole, less any analysis, so a CLI that stops
 * tagging still shows its summary.
 */
function keptSummary(written: string): string {
  // The whole match rather than its group: it is always there when the match
  // is, so there is no absent case to invent a fallback for.
  const tagged = /<summary>[\s\S]*?<\/summary>/.exec(written)
  if (tagged !== null) return tagged[0].slice('<summary>'.length, -'</summary>'.length).trim()

  return written.replace(/<analysis>[\s\S]*?<\/analysis>/g, '').trim()
}

/**
 * What the agent kept when the conversation was compacted, as an event.
 *
 * The CLI hands the summary it wrote to its `PostCompact` hook and nowhere
 * else the SDK streams, so this is the only way the log can show it. A
 * subagent's compaction is left out, and so is an empty summary: a fold with
 * nothing in it is a row that promises something it does not hold.
 */
export function compactionWatch(
  onEvent: (event: AgentEvent) => void
): NonNullable<Options['hooks']> {
  return {
    PostCompact: [
      {
        hooks: [
          (input) => {
            const compacted = PostCompactSchema.safeParse(input)
            if (compacted.success && compacted.data.agent_id === undefined) {
              const summary = keptSummary(compacted.data.compact_summary)
              if (summary !== '') onEvent({ type: 'compaction_summary', summary })
            }
            return Promise.resolve({})
          }
        ]
      }
    ]
  }
}

/**
 * The settings side of `compactionWatch`, on the ground `CWD_WATCH_SETTINGS`
 * was measured on: there, the callback alone never fired. Whether
 * `PostCompact` needs it too is unmeasured, and the `true` command costs
 * nothing.
 */
export const COMPACTION_WATCH_SETTINGS: NonNullable<Settings['hooks']> = {
  PostCompact: [{ hooks: [{ type: 'command', command: 'true' }] }]
}

/**
 * What every session the app starts carries so its agent cannot publish: the
 * hooks, the CLI's own deny rules, and an environment where a push to any of
 * `pushTargets` fails. Three layers because none is a boundary on its own —
 * `publishGuard.ts`.
 *
 * `base` is the app's own environment: the SDK replaces the environment
 * outright when given one, and without it the agent would lose PATH and HOME.
 *
 * `watching` is what else the session listens to through hooks — `cwdWatch`
 * — merged under the guards, which own `PreToolUse` and cannot be displaced.
 */
export function publishLocked(
  refuseCommand: ((command: string) => string | null) | undefined,
  pushTargets: readonly string[],
  base: Readonly<Record<string, string | undefined>> = process.env,
  watching: NonNullable<Options['hooks']> = {}
): Pick<Options, 'hooks' | 'disallowedTools' | 'env'> {
  return {
    hooks: { ...watching, ...toolGuards(refuseCommand) },
    disallowedTools: [...PUBLISH_DENY_RULES],
    env: agentEnv(base, pushTargets)
  }
}

/**
 * What a question withdrawn rather than answered says.
 *
 * Not `DENIED`: the agent reads a refusal's message as instruction, and here
 * nobody declined anything — the turn the question belonged to ended first, so
 * saying "the user declined" would teach it something untrue about the user.
 */
export const ABANDONED = 'The turn this question belonged to ended before it was answered.'

/**
 * Starts a session and streams its events.
 *
 * The prompt is a stream rather than a string: that is what allows follow-up
 * messages without tearing the session down and paying for the context again
 * (§12.3).
 */
export function startSession(options: SessionOptions, hooks: SessionHooks): AgentSession {
  const input = new InputQueue()
  const { effort, ultracode } = sessionEffort(options.effort)

  /*
   * The flag layer's two moving parts, held here because both are changed on a
   * running session through one call.
   *
   * `applyFlagSettings` replaces a top-level key outright rather than merging
   * into it, so a call carrying only the skills would leave the effort at
   * whatever the last one said and a call carrying only the effort would put
   * back every skill withheld since the start (one withheld *at* the start
   * stays withheld until an explicit `'on'` — `skillOverridesFor`). One function that always sends both is the only
   * arrangement where neither can happen, and it is cheaper than reasoning
   * about the merge twice.
   */
  let effortChoice = options.effort
  /** What each model holds, as the turns' results said — see `ContextUsage.modelWindow`. */
  const modelWindows = new Map<string, number>()
  let skills: Readonly<Record<string, SkillVisibility>> = options.skillOverrides

  /** The skill push in flight, so the next one waits for it — `setSkills`. */
  let skillTurn: Promise<void> = Promise.resolve()

  async function moveSkills(
    skillOverrides: Readonly<Record<string, SkillOverride>>
  ): Promise<void> {
    // The whole map every time, never a difference: `applyFlags` sends every
    // flag together, and the map is the record's whole answer. A key left
    // out does not undo a withhold the session started with, so every key
    // this session was told before and the new map no longer names is said
    // explicitly — and said as the user's own settings files say it, `'on'`
    // only where they are silent. Measured (SDK 0.3.299): the flag layer
    // outranks the files, so `'on'` brought back a skill the user had
    // switched off there, for the rest of the session. A key once dropped
    // stays in the map, so every later push reads the files again — a few
    // small reads, and the files may have changed in between.
    const next: Record<string, SkillVisibility> = { ...skillOverrides }
    // `hasOwn` rather than `in` or `??=`: a skill may be called `constructor`.
    const dropped = Object.keys(skills).filter((key) => !Object.hasOwn(next, key))
    if (dropped.length > 0) {
      const files = (await hooks.skillsInFiles?.()) ?? new Map<string, SkillVisibility>()
      for (const key of dropped) next[key] = files.get(key) ?? 'on'
    }

    // Nothing moved, nothing sent: `applyFlags` carries the effort too, and
    // a push that changes no skill would undo an `/effort` given in the
    // session — which `pushEffort`'s guard exists to keep.
    // Every key of the old map is in `next` by now, so one comparison covers
    // a value that moved and a key that is new.
    if (Object.keys(next).every((key) => next[key] === skills[key])) return

    skills = next
    await applyFlags()
  }

  async function applyFlags(): Promise<void> {
    const current = sessionEffort(effortChoice)

    await conversation.applyFlagSettings({
      effortLevel: current.effort,
      ultracode: current.ultracode,
      enableWorkflows: current.ultracode,
      skillOverrides: skills
    })
  }

  const conversation = hooks.query({
    prompt: input.stream(),
    options: {
      cwd: options.cwd,
      // Spread rather than passed as null: `exactOptionalPropertyTypes` draws
      // a line between "no override" and "an override that is nothing", and
      // the SDK reads a present `resume` as a session to look for.
      ...(options.resume !== null && { resume: options.resume }),
      // Only beside `resume`: the CLI refuses the flag on its own.
      ...(options.resume !== null &&
        options.resumeAt !== null && { resumeSessionAt: options.resumeAt }),
      ...(options.model !== null && { model: options.model }),
      effort,
      // The flag-settings layer, which is where `ultracode` lives: it is not an
      // option of its own, and asking for it is asking for two things at once —
      // the orchestration, and the feature it orchestrates with. Both are said
      // explicitly, `false` included: a session that quietly kept the last
      // one's workflows would be a state nobody chose, and leaving one unsaid
      // hands the answer to whichever settings file happens to mention it.
      settings: {
        ultracode,
        enableWorkflows: ultracode,
        skillOverrides: options.skillOverrides,
        // What lets the `CwdChanged` callback below fire at all.
        hooks: { ...CWD_WATCH_SETTINGS, ...COMPACTION_WATCH_SETTINGS },
        // Left out rather than sent as null for "the agent's own": the flag
        // layer outranks the user's files, so a null here would still be a
        // claim, and `/autocompact` saved there is what null should defer to.
        ...(options.autoCompactWindow !== null && { autoCompactWindow: options.autoCompactWindow })
      },
      settingSources: [...options.settingSources],
      // Omitted when there are none rather than passed empty: a root widens
      // what the session may reach, and an empty list is a claim about that
      // which is better left unmade.
      ...(options.additionalDirectories.length > 0 && {
        additionalDirectories: [...options.additionalDirectories]
      }),
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      permissionMode: options.permissionMode,
      allowedTools: [...options.allowedTools],
      // These own `hooks`, `disallowedTools` and `env`: a key of the same name
      // later in this object would take the guard away.
      ...publishLocked(
        hooks.refuseCommand,
        options.pushTargets,
        { ...process.env, ...options.env },
        { ...cwdWatch(hooks.onEvent), ...compactionWatch(hooks.onEvent) }
      ),
      // What makes text appear while it is being written rather than in one
      // block at the end of a turn.
      includePartialMessages: true,
      // Backs a file up before the agent first changes it in a turn, which is
      // what makes "put the files back to this message" possible at all. Not
      // optional afterwards: a checkpoint cannot be taken for work already done.
      enableFileCheckpointing: true,
      /*
       * A sentence about what each running subagent is doing, written every
       * thirty seconds or so from a fork of its own context — what the agent
       * map shows under a row. The fork reuses the subagent's cache, so it is
       * cheap, but it is not free, which is why it is a setting.
       */
      agentProgressSummaries: options.agentProgressSummaries,
      /*
       * The map has a Stop for each task, so the conversation's own Stop ends
       * the turn and nothing else. Without this the CLI kills every background
       * agent on an interrupt — it fails closed, since a task nobody can stop
       * one by one would otherwise run until the session ended.
       */
      perTaskStopAffordance: true,
      /*
       * An MCP server asking the user something, mid-call.
       *
       * Declared at all because the SDK **declines automatically** when it is
       * not: the server is refused, the agent carries on as though an answer
       * had been given, and nobody sees anything — the same failure the agent's
       * own questions had before they had a card.
       *
       * Two things are refused here rather than shown, and both are refusals
       * this application would otherwise have to pretend about. A `url` mode
       * asks the host to send somebody to an address a repository chose; that
       * is an outward-facing act and is not taken on a server's say-so. And a
       * form whose schema `readForm` cannot draw is declined with a reason,
       * because a half-drawn form collects an answer the server then refuses
       * and the user has typed it for nothing.
       */
      onElicitation: async (request) => {
        if (request.mode === 'url') {
          return {
            action: 'decline',
            content: { reason: 'octopus does not open addresses on a server’s behalf.' }
          }
        }

        const fields = readForm(request.requestedSchema)
        if (fields === null) {
          return {
            action: 'decline',
            content: { reason: 'octopus could not draw the form this server asked for.' }
          }
        }

        return hooks.askElicitation({
          serverName: request.serverName,
          message: request.message,
          title: request.title ?? '',
          fields
        })
      },

      canUseTool: async (
        toolName,
        toolInput,
        { decisionReason, suggestions, suppressAlwaysAllowRule, signal, agentID }
      ) => {
        const outcome = await hooks.askPermission({
          toolName,
          input: toolInput,
          signal,
          // Spread rather than assigned: `exactOptionalPropertyTypes` tells an
          // absent field apart from one set to `undefined`, and the SDK sends
          // no reason for most requests.
          ...(decisionReason !== undefined && { reason: decisionReason }),
          ...(suggestions !== undefined && { suggestions }),
          ...(suppressAlwaysAllowRule === true && { suppressAlways: true }),
          // A subagent's id is its task's id, which is how the window finds the
          // row to turn amber.
          ...(agentID !== undefined && { taskId: agentID })
        })
        if (!outcome.allow) return { behavior: 'deny', message: outcome.message }

        return {
          behavior: 'allow',
          // The answer's own version of the arguments when it has one — this is
          // the only way a tool that asked a question gets to hear it — and the
          // untouched ones otherwise, which is what approving a tool means.
          updatedInput: asToolInput(outcome.updatedInput) ?? toolInput,
          // The SDK's own way to change mode on an approval, and the reason it
          // is done here rather than by a control request afterwards: this
          // reply is what releases the tool call, so anything sent separately
          // races the work it was meant to govern. Verified against a live
          // session — without this the very next edit asks again.
          /*
           * Both, and they are not alternatives: approving a plan changes the
           * mode, answering "always" adds a rule, and a turn can do one or the
           * other. Sent on this reply for the reason the mode is — it is what
           * releases the tool call, so anything sent separately races the work
           * it was meant to govern.
           *
           * The rule goes to the **session** as well as to our config: without
           * it the very next call asks again, since the SDK knows nothing about
           * a list we keep ourselves.
           */
          ...(updates(outcome).length > 0 && { updatedPermissions: updates(outcome) })
        }
      }
    }
  })

  // Aborted by `close`. The process it ends goes down with SIGTERM, which the
  // SDK reports as a failure like any other.
  const closing = new AbortController()

  /*
   * The skills this session holds, as its latest `init` listed them — nothing
   * else says which commands are skills.
   */
  let heldSkills: ReadonlySet<string> = NO_SKILLS
  let announced = false

  /*
   * The two lists the composer suggests from, announced by the session itself
   * once its first `init` has said which commands are skills.
   *
   * Announced rather than waited to be asked: a list asked for when the session
   * starts was answered before the `init` — every command read as no skill —
   * and one asked for on the `init` raced the window re-reading it. Each list
   * on its own, so one that cannot be read does not take the other with it; a
   * list missing is a convenience missing, and the stream reports real trouble.
   */
  const announceLists = (): void => {
    conversation.supportedCommands().then(
      (commands) => {
        hooks.onEvent({ type: 'commands_changed', commands: toAgentCommands(commands, heldSkills) })
      },
      () => undefined
    )
    conversation.supportedAgents().then(
      (agents) => {
        hooks.onEvent({ type: 'agents_changed', agents: toAgentEntries(agents) })
      },
      () => undefined
    )
  }

  // Started and never awaited. `close` is what actually ends the session —
  // it kills the process the SDK spawned, and the loop then falls out on its
  // own. Waiting for it there would make closing depend on a stream ending,
  // and a stream that does not would hang removing a workspace.
  void (async () => {
    try {
      // Runs to the end of the stream, and must keep doing so. Leaving this
      // loop early — after a `result`, say, which looks like the end of the
      // work — ends the generator and closes the transport underneath it, and
      // from then on every control request fails with "ProcessTransport is not
      // ready for writing": no model change, no context reading, no usage.
      // Measured by walking into it while probing the usage calls.
      for await (const message of conversation) {
        if (message.type === 'result') {
          for (const [model, window] of windowsIn(message)) modelWindows.set(model, window)
        }
        if (message.type === 'system' && message.subtype === 'init') {
          heldSkills = new Set(message.skills)
          if (!announced) {
            announced = true
            announceLists()
          }
        }
        for (const event of mapMessage(message, heldSkills)) hooks.onEvent(event)
      }
    } catch (error) {
      // The SDK throws for a failed spawn, a lost subscription or an aborted
      // process. Whatever it was, the chat is the only place the user is
      // looking, so it has to be said there — unless we ended it ourselves:
      // a session started again for a new compaction window showed "exited
      // with code 143" above an answer from its successor.
      if (closing.signal.aborted) return
      hooks.onEvent({ type: 'error', message: describeError(error) })
    }
  })()

  return {
    send(text, messageId) {
      input.push(userMessage(text, messageId))
    },

    async rewindFiles(messageId, dryRun) {
      const result = await conversation.rewindFiles(messageId, { dryRun })

      return {
        canRewind: result.canRewind,
        error: result.error ?? null,
        filesChanged: result.filesChanged ?? [],
        insertions: result.insertions ?? 0,
        deletions: result.deletions ?? 0,
        skippedLinks: result.skippedLinks ?? 0
      }
    },

    async interrupt() {
      await conversation.interrupt()
    },

    async stopTask(taskId) {
      await conversation.stopTask(taskId)
    },

    async setPermissionMode(mode) {
      await conversation.setPermissionMode(mode)
    },

    async setModel(model) {
      // `undefined` is how the SDK is told to go back to its own default;
      // passing null would be asking for a model called null.
      await conversation.setModel(model ?? undefined)
    },

    async models() {
      return toAgentModels(await conversation.supportedModels())
    },

    contextUsage() {
      return readContextUsage(conversation, (model) => modelWindows.get(model))
    },

    usageReport(options) {
      return readUsageReport(conversation, options)
    },

    sideQuestion(question, history, signal) {
      return askSideQuestion(conversation, question, history, signal)
    },

    async setEffort(choice) {
      // There is no `setEffort`; `effort` is a start-time option, and the flag
      // layer is the only way to move it on a running session.
      //
      // The persisted `effortLevel` excludes `max` while this parameter allows
      // it, because `max` lasts for the session and the CLI never writes it to
      // a settings file; we keep it on the chat instead, and the next session
      // asks for it at start-up.
      effortChoice = choice
      await applyFlags()
    },

    setSkills(skillOverrides) {
      // One at a time: a push may wait on the settings files, and two
      // overlapping ones — a default list changed, then a chat's own switch —
      // would both start from the same map, the slower read sending the older
      // record last.
      const turn = skillTurn.then(() => moveSkills(skillOverrides))
      skillTurn = turn.catch(() => undefined)
      return turn
    },

    async refreshSkills() {
      // For a skill written while this conversation was open. Without it the
      // session goes on listing what the directories held when it started, and
      // the panel would show a skill the agent cannot see.
      const { skills } = await conversation.reloadSkills()

      return skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        builtin: skill.builtin === true
      }))
    },

    async reloadPlugins() {
      // No \`holdOnCacheImpact\`: the decision was to reload at once even when
      // it costs the next turn its prompt cache. The answer — commands, the
      // plugins loaded, \`error_count\` — is dropped; the window reads a
      // plugin's errors from the CLI's listing, and the session announces its
      // new commands itself.
      await conversation.reloadPlugins()
    },

    close() {
      closing.abort()
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
/**
 * What a compaction says about itself, read rather than trusted.
 *
 * `sdk.d.ts` declares `compact_metadata` with `pre_tokens` and `post_tokens`.
 * A live session sends `compactMetadata` with `preTokens` and `postTokens`, and
 * four fields the type does not mention — so reading the declared shape yields
 * `undefined` and an event of nulls that looks like it worked. Measured against
 * CLI 2.1.224; both spellings are accepted because either could be the one that
 * survives.
 *
 * Nulls rather than nothing when neither fits. The boundary is worth drawing on
 * its own: the reader's question is whether this conversation was compacted,
 * not by how much.
 */
const CompactMetadataSchema = z
  .object({
    trigger: z.enum(['manual', 'auto']).nullish(),
    preTokens: z.number().nullish(),
    postTokens: z.number().nullish(),
    pre_tokens: z.number().nullish(),
    post_tokens: z.number().nullish()
  })
  .partial()

function compactionFrom(message: object): AgentEvent {
  const held = 'compactMetadata' in message ? message.compactMetadata : undefined
  const declared = 'compact_metadata' in message ? message.compact_metadata : undefined
  const parsed = CompactMetadataSchema.safeParse(held ?? declared)

  if (!parsed.success) {
    return { type: 'conversation_compacted', trigger: null, preTokens: null, postTokens: null }
  }

  return {
    type: 'conversation_compacted',
    trigger: parsed.data.trigger ?? null,
    preTokens: parsed.data.preTokens ?? parsed.data.pre_tokens ?? null,
    postTokens: parsed.data.postTokens ?? parsed.data.post_tokens ?? null
  }
}

/**
 * A message's place in the CLI's queue, as the frame says it.
 *
 * Not in the SDK's typed union — the CLI sends it when it advertises
 * `msg_lifecycle_v1` — so it is recognised by its shape rather than by a case,
 * and a frame that does not match says nothing. `command_uuid` is the uuid the
 * message was sent with (`userMessage`).
 */
const LifecycleSchema = z.object({
  type: z.literal('command_lifecycle'),
  command_uuid: z.string(),
  state: z.enum(['queued', 'started', 'completed', 'cancelled'])
})

function fromLifecycle(message: unknown): AgentEvent[] {
  const lifecycle = LifecycleSchema.safeParse(message)
  if (!lifecycle.success) return []

  const { command_uuid: messageId, state } = lifecycle.data
  return [
    {
      type: 'message_queue',
      messageId,
      state: state === 'completed' || state === 'cancelled' ? 'finished' : state
    }
  ]
}

export function mapMessage(
  message: SDKMessage,
  skills: ReadonlySet<string> = NO_SKILLS
): AgentEvent[] {
  switch (message.type) {
    case 'system':
      switch (message.subtype) {
        // The init message is where the session id first appears, and that id
        // is the whole basis of resuming after a restart. It arrives more than
        // once: every slash command produces a fresh one, so whoever records it
        // has to tolerate being told the same id repeatedly.
        //
        // It also names the mode the session actually started in, which is
        // how a request for `auto` that the CLI turned down becomes visible.
        case 'init':
          return [
            { type: 'session_started', sessionId: message.session_id },
            { type: 'mode_reported', mode: message.permissionMode }
          ]

        // Sent when the session's state moves, and carrying the mode when that
        // is what moved — the CLI's own fall back out of auto mode among them.
        case 'status':
          return message.permissionMode === undefined
            ? []
            : [{ type: 'mode_reported', mode: message.permissionMode }]

        /* A call refused without a prompt. Under auto mode that is the
           classifier's verdict, and without this line it would show only as a
           tool that failed. */
        case 'permission_denied':
          return [
            {
              type: 'permission_denied',
              toolName: message.tool_name,
              byClassifier: message.decision_reason_type === 'classifier',
              reason: message.decision_reason ?? null
            }
          ]

        case 'commands_changed':
          return [{ type: 'commands_changed', commands: toAgentCommands(message.commands, skills) }]

        case 'compact_boundary':
          return [compactionFrom(message)]

        /* The one change of model nobody chose. `scope` is absent from older
           CLIs and means `session` there, which is the reading that says the
           chip has moved — the conservative one to assume, since the other
           would leave a swap that outlives the turn described as local. */
        case 'model_refusal_fallback':
          return [
            /* The same retraction the replacement already named, said again at
               the end of the turn. The SDK calls the two idempotent and keeps
               this one as the complete audit record — it also carries tool
               results that no replacement frame was attached to. */
            ...retraction(message.retracted_message_uuids, message.uuid),
            {
              type: 'model_refusal_fallback',
              originalModel: message.original_model,
              fallbackModel: message.fallback_model,
              scope: message.scope ?? 'session',
              category: message.api_refusal_category ?? null,
              explanation: message.api_refusal_explanation ?? null
            }
          ]

        /* And the refusal nothing was retried after. The SDK sends exactly
           one of these two and never both, so this is the case where the turn
           ends with no answer at all — which without a line is silence the
           reader is left to interpret. Its message carries the same `why` as
           the one above and none of the five fields that describe a retry. */
        case 'model_refusal_no_fallback':
          return [
            {
              type: 'model_refusal_no_fallback',
              originalModel: message.original_model,
              category: message.api_refusal_category ?? null,
              explanation: message.api_refusal_explanation ?? null
            }
          ]

        case 'task_started':
          return [taskStarted(message)]

        case 'task_progress':
          return [taskProgress(message)]

        case 'task_notification':
          return [taskNotification(message)]

        case 'task_updated':
          return taskUpdated(message)

        case 'background_tasks_changed':
          return [backgroundTasks(message)]

        // Every other system subtype, of which there are dozens and counting.
        default:
          return []
      }

    // The conversation was replaced by an empty one. A newer CLI says what did
    // it, and only `/clear` is the user asking. An older one, or a cause this
    // build does not know, maps to the "nobody asked" form, and the service,
    // which knows what was sent, decides.
    case 'conversation_reset': {
      const trigger = ResetTriggerSchema.safeParse(message.trigger)
      if (!trigger.success) return [{ type: 'conversation_reset', cleared: false }]
      return [
        { type: 'conversation_reset', cleared: trigger.data === 'clear', trigger: trigger.data }
      ]
    }

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
      return fromLifecycle(message)
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

  /* What this message replaces, said on arrival rather than at end of turn.
     `supersedes` rides on the replacement itself, so the retraction is settled
     while the event that caused it is in hand — the end-of-turn notice says the
     same thing again, and the SDK calls the two idempotent. */
  events.push(...retraction(message.supersedes, message.uuid))

  // Whose words these are. A subagent's messages arrive on the same stream as
  // the conversation's own, told apart only by this, and without it a long
  // delegated task is a scatter of tool rows nothing says belong together.
  const parent =
    message.parent_tool_use_id === null ? {} : { parentToolUseId: message.parent_tool_use_id }

  for (const block of message.message.content) {
    // A block with nothing in it is not an event. Reasoning arrives that way
    // routinely — the SDK can be asked to summarise it or omit it, and an
    // omitted one still sends the block for signature continuity, empty. Left
    // through, each drew a disclosure with nothing behind it and left a record
    // in the transcript that remembers nothing.
    if (block.type === 'text' && block.text.trim() !== '') {
      events.push({ type: 'text', text: block.text, uuid: message.uuid, ...parent })
    }
    if (block.type === 'thinking' && block.thinking.trim() !== '') {
      events.push({ type: 'thinking', text: block.thinking, uuid: message.uuid, ...parent })
    }
    if (block.type === 'tool_use') {
      events.push({
        type: 'tool_use',
        toolUseId: block.id,
        name: block.name,
        input: block.input,
        uuid: message.uuid,
        ...parent
      })
    }
  }

  return events
}

/**
 * What a message says it takes back, as none or one event.
 *
 * An array rather than a nullable, because both callers splice it into a list
 * they are already building — and one of them does so inside a `return`.
 *
 * The carrier's own id is dropped: a message naming itself would strike out the
 * replacement, and the SDK's own reader drops it for the same reason. Ids are
 * kept opaque and matched by equality — an unmatched one is a no-op.
 */
function retraction(uuids: readonly string[] | undefined, carrier: string): AgentEvent[] {
  const taken = (uuids ?? []).filter((uuid) => uuid !== carrier)

  return taken.length === 0 ? [] : [{ type: 'retracted', uuids: taken }]
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
  const parent =
    message.parent_tool_use_id === null ? {} : { parentToolUseId: message.parent_tool_use_id }

  const results = content.filter((block) => block.type === 'tool_result')
  // The structured output is one per message, so it can only be told apart
  // from its neighbours' when the message carries a single result.
  const output = results.length === 1 ? readToolOutput(message.tool_use_result) : {}

  for (const block of results) {
    events.push({
      type: 'tool_result',
      toolUseId: block.tool_use_id,
      ok: block.is_error !== true,
      content: describeToolResult(block.content),
      ...output,
      // Optional on this message where it is required on an assistant one, so
      // a result that arrives without one simply cannot be retracted.
      ...(message.uuid === undefined ? {} : { uuid: message.uuid }),
      ...parent
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

export function userMessage(text: string, uuid?: UUID): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    session_id: '',
    // Stamped by us rather than left for the agent to assign, because the id is
    // the only handle there is on this point in the conversation: it is what
    // the files are rewound to, and nothing in the stream says it back.
    ...(uuid !== undefined && { uuid })
  }
}

/**
 * The stream of messages the session reads from.
 *
 * A queue rather than a plain generator because the two ends run on different
 * clocks: the UI pushes whenever someone presses enter, and the SDK pulls when
 * it is ready for the next turn. Whichever arrives first waits for the other.
 *
 * Exported for the one-shot in `pullRequestDraft.ts`, which pushes a single
 * message and closes: `stream` then ends by itself, which is the whole of what
 * a question with no conversation after it needs.
 */
export class InputQueue {
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
