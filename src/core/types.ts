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

/** Chat identifier. Also the name of the file its transcript lives in. */
export type ChatId = string

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
  /** Dev server port, derived deterministically from the id. */
  readonly port: number
  readonly createdAt: string
  /**
   * Reserved for future multi-user support (§15.3).
   * Always null for now — the shape simply does not assume a single user.
   */
  readonly ownerId: string | null
}
