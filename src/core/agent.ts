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
  ModelInfo,
  Options,
  PermissionUpdate,
  Query,
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKUserMessage,
  SettingSource,
  SlashCommand
} from '@anthropic-ai/claude-agent-sdk'

import type { AgentCommand, AgentModel, EffortChoice, PermissionMode } from './chats.js'
import { sessionEffort } from './chats.js'
import { type AnswerValue, type ElicitationField, readForm } from './elicitation.js'
import type { AgentEvent } from './events.js'
import { describeError } from './persist.js'
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
  /**
   * Skills this conversation is not to be offered, by the name the agent knows.
   *
   * A deny-list, because an allow-list would silently hide everything octopus
   * failed to enumerate — Claude Code's own bundled skills first among them.
   * Naming only what is off leaves a conversation with nothing switched off
   * behaving exactly as it did before any of this existed.
   */
  readonly skillOverrides: Readonly<Record<string, 'off'>>
}

/** What the agent wants to do, as handed to whoever decides. */
/**
 * One skill a running session holds, as it names it.
 *
 * Ours rather than the SDK's `SlashCommand`, and narrower: the two fields the
 * panel draws. The SDK's own doc calls `name` "Skill name (without the leading
 * slash)", which is the key `skillOverrides` is written under — a bare name for
 * an ordinary skill, `plugin:skill` for a plugin's.
 */
export interface AgentSkill {
  readonly name: string
  readonly description: string
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
  /** Queues a message. Returns immediately — the answer arrives as events. */
  send: (text: string) => void
  interrupt: () => Promise<void>
  setPermissionMode: (mode: PermissionMode) => Promise<void>
  setEffort: (effort: EffortChoice) => Promise<void>
  /** Changes the model for what follows; null hands the choice back. */
  setModel: (model: string | null) => Promise<void>
  /** Replaces the set of skills withheld from this conversation, mid-turn. */
  setSkills: (skillOverrides: Readonly<Record<string, 'off'>>) => Promise<void>
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
  /** What this account may use, as the agent reported when the session began. */
  models: () => Promise<AgentModel[]>
  /** The slash commands this session offers, agent's own and the project's. */
  commands: () => Promise<AgentCommand[]>
  /** How full this conversation's context window is, or null if it cannot say. */
  contextUsage: () => Promise<ContextUsage | null>
  /** Everything `/usage` answers, or null if the session cannot say. */
  usageReport: () => Promise<UsageReport | null>
  /** Ends the session, killing the process the SDK spawned. */
  close: () => Promise<void>
}

/** How full a conversation's context window is, and what is filling it. */
export interface ContextUsage {
  /** Whole percent, as the agent itself rounds it. */
  readonly percentage: number
  readonly usedTokens: number
  readonly maxTokens: number
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
 * chart, a category breakdown, memory files, MCP tools. Four fields are taken
 * and the rest deliberately stops here.
 */
export async function readContextUsage(conversation: Query): Promise<ContextUsage | null> {
  const ask = (conversation as UsageCapable).getContextUsage
  if (typeof ask !== 'function') return null

  try {
    const usage = await ask.call(conversation)
    return {
      percentage: usage.percentage,
      usedTokens: usage.totalTokens,
      maxTokens: usage.maxTokens,
      // Defended rather than taken: this arrived later than the rest of the
      // response, so a CLI a few versions back answers without it.
      model: typeof usage.model === 'string' && usage.model !== '' ? usage.model : null
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
export async function readUsageReport(conversation: Query): Promise<UsageReport | null> {
  const ask = (conversation as UsageCapable)
    .usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET
  if (typeof ask !== 'function') return null

  try {
    return toUsageReport(await ask.call(conversation))
  } catch {
    return null
  }
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
 */
export function toAgentCommands(commands: readonly SlashCommand[]): AgentCommand[] {
  return commands.map((command) => ({
    name: command.name,
    description: command.description,
    argumentHint: command.argumentHint,
    aliases: command.aliases ? [...command.aliases] : []
  }))
}

/**
 * What a refusal says when the user gave no words of their own.
 *
 * Exported because the answer is now composed where it is decided rather than
 * here: a refusal may carry the user's own note instead, and this is the
 * fallback for when it does not.
 */
export const DENIED = 'The user declined this action in octopus.'

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
   * every withheld skill back. One function that always sends both is the only
   * arrangement where neither can happen, and it is cheaper than reasoning
   * about the merge twice.
   */
  let effortChoice = options.effort
  let withheld: Readonly<Record<string, 'off'>> = options.skillOverrides

  async function applyFlags(): Promise<void> {
    const current = sessionEffort(effortChoice)

    await conversation.applyFlagSettings({
      effortLevel: current.effort,
      ultracode: current.ultracode,
      enableWorkflows: current.ultracode,
      skillOverrides: withheld
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
      ...(options.model !== null && { model: options.model }),
      effort,
      // The flag-settings layer, which is where `ultracode` lives: it is not an
      // option of its own, and asking for it is asking for two things at once —
      // the orchestration, and the feature it orchestrates with. Both are said
      // explicitly, `false` included: a session that quietly kept the last
      // one's workflows would be a state nobody chose, and leaving one unsaid
      // hands the answer to whichever settings file happens to mention it.
      settings: { ultracode, enableWorkflows: ultracode, skillOverrides: options.skillOverrides },
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
      // What makes text appear while it is being written rather than in one
      // block at the end of a turn.
      includePartialMessages: true,
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

      canUseTool: async (toolName, toolInput, { decisionReason, suggestions }) => {
        const outcome = await hooks.askPermission({
          toolName,
          input: toolInput,
          // Spread rather than assigned: `exactOptionalPropertyTypes` tells an
          // absent field apart from one set to `undefined`, and the SDK sends
          // no reason for most requests.
          ...(decisionReason !== undefined && { reason: decisionReason }),
          ...(suggestions !== undefined && { suggestions })
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

    async setModel(model) {
      // `undefined` is how the SDK is told to go back to its own default;
      // passing null would be asking for a model called null.
      await conversation.setModel(model ?? undefined)
    },

    async models() {
      return toAgentModels(await conversation.supportedModels())
    },

    async commands() {
      return toAgentCommands(await conversation.supportedCommands())
    },

    contextUsage() {
      return readContextUsage(conversation)
    },

    usageReport() {
      return readUsageReport(conversation)
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

    async setSkills(skillOverrides) {
      // The whole map every time, never a difference: turning a skill back on
      // is saying its key is no longer there, and there is no way to say that
      // one key at a time.
      withheld = skillOverrides
      await applyFlags()
    },

    async refreshSkills() {
      // For a skill written while this conversation was open. Without it the
      // session goes on listing what the directories held when it started, and
      // the panel would show a skill the agent cannot see.
      const { skills } = await conversation.reloadSkills()

      return skills.map((skill) => ({ name: skill.name, description: skill.description }))
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

export function mapMessage(message: SDKMessage): AgentEvent[] {
  switch (message.type) {
    case 'system':
      switch (message.subtype) {
        // The init message is where the session id first appears, and that id
        // is the whole basis of resuming after a restart. It arrives more than
        // once: every slash command produces a fresh one, so whoever records it
        // has to tolerate being told the same id repeatedly.
        case 'init':
          return [{ type: 'session_started', sessionId: message.session_id }]

        case 'commands_changed':
          return [{ type: 'commands_changed', commands: toAgentCommands(message.commands) }]

        case 'compact_boundary':
          return [compactionFrom(message)]

        /* The one change of model nobody chose. `scope` is absent from older
           CLIs and means `session` there, which is the reading that says the
           chip has moved — the conservative one to assume, since the other
           would leave a swap that outlives the turn described as local. */
        case 'model_refusal_fallback':
          return [
            {
              type: 'model_refusal_fallback',
              originalModel: message.original_model,
              fallbackModel: message.fallback_model,
              scope: message.scope ?? 'session',
              category: message.api_refusal_category ?? null,
              explanation: message.api_refusal_explanation ?? null
            }
          ]

        // Every other system subtype, of which there are dozens and counting.
        default:
          return []
      }

    // The conversation was replaced by an empty one. Whether the user asked for
    // that is not knowable here — the SDK sends the same message for leaving
    // plan mode — so it maps to the "nobody asked" form and the service, which
    // knows what was sent, decides.
    case 'conversation_reset':
      return [{ type: 'conversation_reset', cleared: false }]

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

export function userMessage(text: string): SDKUserMessage {
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
