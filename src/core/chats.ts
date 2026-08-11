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
 * `bypassPermissions` is absent on purpose — §4 puts transparency above
 * convenience, and a mode where nothing is ever shown is the one setting that
 * cannot be undone by reading the screen.
 */
export const PERMISSION_MODES = ['default', 'plan', 'acceptEdits'] as const
export const PermissionModeSchema = z.enum(PERMISSION_MODES)
export type PermissionMode = z.infer<typeof PermissionModeSchema>

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
  permissionMode: PermissionModeSchema,
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

export interface NewChatOptions {
  readonly id: string
  readonly agent: AgentKind
  readonly permissionMode: PermissionMode
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
    permissionMode: options.permissionMode,
    createdAt: options.createdAt
  }
}
