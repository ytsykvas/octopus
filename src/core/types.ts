/**
 * Core domain types.
 *
 * This module deliberately has no imports — neither Electron nor Node.
 * Both the main process and the renderer are free to import it (§11.1).
 */

/** Active colour theme (§10.6). */
export type ThemeName = 'light' | 'dark'

/** Project slug, derived from the repository name. */
export type ProjectId = string

/** Workspace identifier, stable for the workspace's whole lifetime. */
export type WorkspaceId = string

/** Where a workspace sits in its lifecycle. */
export type WorkspaceStatus = 'idle' | 'running' | 'waiting_permission' | 'error' | 'archived'

export interface Project {
  readonly id: ProjectId
  readonly name: string
  /** Absolute path to the main repository. */
  readonly repoPath: string
  /** Branch workspaces branch off from, and diffs are measured against. */
  readonly baseBranch: string
  /** Branch prefix, e.g. a GitHub username. */
  readonly branchPrefix: string
}

export interface Workspace {
  readonly id: WorkspaceId
  readonly projectId: ProjectId
  readonly name: string
  readonly branch: string
  /** Absolute path to the git worktree. */
  readonly path: string
  readonly status: WorkspaceStatus
  /** Claude Code session id; null until a session has started. */
  readonly sessionId: string | null
  /** Dev server port, derived deterministically from the id. */
  readonly port: number
  readonly createdAt: string
  /**
   * Reserved for future multi-user support (§15.3).
   * Always null for now — the shape simply does not assume a single user.
   */
  readonly ownerId: string | null
}

/**
 * A normalised agent event.
 *
 * This is the isolation layer around the Agent SDK: the UI only ever sees
 * this type, so changes to the SDK's message shapes do not leak into the
 * renderer (§11.2).
 */
export type AgentEvent =
  | { readonly type: 'session_started'; readonly sessionId: string }
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'thinking'; readonly text: string }
  | {
      readonly type: 'tool_use'
      readonly toolUseId: string
      readonly name: string
      readonly input: unknown
    }
  | {
      readonly type: 'tool_result'
      readonly toolUseId: string
      readonly ok: boolean
      readonly content: string
    }
  | {
      readonly type: 'permission_request'
      readonly requestId: string
      readonly toolName: string
      readonly input: unknown
    }
  | {
      readonly type: 'result'
      readonly ok: boolean
      readonly costUsd: number | null
      readonly durationMs: number | null
    }
  | { readonly type: 'error'; readonly message: string }
