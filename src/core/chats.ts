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
  displayName: z.string().min(1),
  description: z.string().default(''),
  /** Null when the agent did not say, in which case every level is offered. */
  supportedEffortLevels: z.array(EffortSchema).nullable().default(null),
  supportsEffort: z.boolean().nullable().default(null)
})

export type AgentModel = z.infer<typeof AgentModelSchema>

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
    createdAt: options.createdAt
  }
}
