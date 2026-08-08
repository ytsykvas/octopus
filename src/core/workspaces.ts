/**
 * Workspace lifecycle: create, rename, remove.
 *
 * A layer over `worktree.ts` and `store.ts`, shaped like `projects.ts` —
 * typed errors carrying a code the UI localises, and no knowledge of Electron.
 *
 * The layout follows Conductor's: one directory per workspace, one branch per
 * workspace, both named after the workspace. Unlike Conductor, everything
 * lives under a single root (§12.4).
 */

import { access } from 'node:fs/promises'

import { type GitExec, toSlug } from './git.js'
import { nextWorkspaceName, type Random } from './names.js'
import { workspacePath } from './paths.js'
import { assignPort, type Project, type State, type Workspace } from './store.js'
import {
  addWorktree,
  changedFiles,
  listBranches,
  listWorktrees,
  deleteBranch,
  hasUncommittedChanges,
  isBranchMerged,
  removeWorktree,
  renameBranch,
  type Worktree
} from './worktree.js'

/** Machine-readable reason an operation was refused; the UI localises these. */
export type WorkspaceErrorCode =
  | 'branchExists'
  | 'pathExists'
  | 'uncommittedChanges'
  /** The branch holds commits the base branch does not. */
  | 'branchUnmerged'
  | 'nameEmpty'
  | 'worktreeMissing'

export class WorkspaceError extends Error {
  constructor(
    readonly code: WorkspaceErrorCode,
    readonly params: Readonly<Record<string, string>>,
    message: string
  ) {
    super(message)
    this.name = 'WorkspaceError'
  }
}

/**
 * A workspace as the UI sees it: the stored record plus what only git knows.
 *
 * Deliberately not persisted — `changedFiles` and `missing` are facts about
 * the working tree right now, and a stale copy on disk would be worse than
 * no copy at all.
 */
export interface WorkspaceView extends Workspace {
  /** Files with uncommitted changes, including untracked ones. */
  readonly changedFiles: number
  /** The directory is gone — removed outside the app. */
  readonly missing: boolean
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Globally unique key for a workspace.
 *
 * Names repeat across projects on purpose, so the key carries the project as
 * well. It never reaches the filesystem — the directory is named after the
 * workspace alone.
 */
export function workspaceId(projectId: string, name: string): string {
  return `${projectId}/${name}`
}

/** Full branch name for a workspace: `<prefix>/<name>`. */
export function branchFor(project: Project, name: string): string {
  return `${project.branchPrefix}/${toSlug(name)}`
}

interface CreateOptions {
  readonly root?: string
  readonly exists?: (path: string) => Promise<boolean>
  /** Injectable so tests get a fixed name instead of a random one. */
  readonly random?: Random
}

/**
 * Creates a workspace: a directory, a branch, and the record tying them
 * together.
 *
 * The generated name becomes the id, and the id fixes the directory for good.
 * Renaming later moves the branch but not the directory, because
 * `git worktree move` fails whenever something is running inside it.
 */
export async function createWorkspace(
  project: Project,
  state: State,
  exec: GitExec,
  options: CreateOptions = {}
): Promise<Workspace> {
  const exists = options.exists ?? pathExists

  // Names are picked per project, so every project starts from the top of the
  // pool: two projects may both have an `anna`.
  const fromState = state.workspaces
    .filter((workspace) => workspace.projectId === project.id)
    .map((workspace) => workspace.name)

  // A branch outlives the worktree it was made for — removal keeps it unless
  // asked otherwise — so the store alone would happily reuse a name git still
  // holds, and `worktree add` would then fail.
  const name = nextWorkspaceName(
    [...fromState, ...(await takenByBranches(project, exec))],
    options.random
  )

  // The id, by contrast, must be unique across the app: it is the key for
  // renaming, removal and the jump shortcuts, none of which carry a project.
  const id = workspaceId(project.id, name)
  const branch = branchFor(project, name)
  const path = workspacePath(project.id, name, options.root)

  if (await exists(path)) {
    throw new WorkspaceError('pathExists', { path }, `${path} already exists.`)
  }

  await addWorktree(exec, path, branch, project.baseBranch)

  return {
    id,
    projectId: project.id,
    name,
    branch,
    path: await canonicalPath(exec, branch, path),
    status: 'idle',
    sessionId: null,
    port: assignPort(
      id,
      state.workspaces.map((workspace) => workspace.port)
    ),
    createdAt: new Date().toISOString(),
    ownerId: null
  }
}

/**
 * Workspace names that existing branches already claim.
 *
 * Only branches under the project's prefix count; anything else in the
 * repository is the user's own and none of our business.
 */
async function takenByBranches(project: Project, exec: GitExec): Promise<string[]> {
  const prefix = `${project.branchPrefix}/`

  return (await listBranches(exec))
    .filter((branch) => branch.startsWith(prefix))
    .map((branch) => branch.slice(prefix.length))
}

/**
 * The path git reports for a freshly created worktree.
 *
 * git canonicalises paths — on macOS `/var` is a symlink to `/private/var`,
 * so the directory it reports differs from the one we asked for. Storing our
 * version would make every workspace look missing when the two are compared.
 */
async function canonicalPath(exec: GitExec, branch: string, fallback: string): Promise<string> {
  try {
    const created = (await listWorktrees(exec)).find((worktree) => worktree.branch === branch)
    return created?.path ?? fallback
  } catch {
    return fallback
  }
}

/**
 * Renames a workspace: the label and the branch, never the directory.
 *
 * The branch is what shows up in a pull request and in `git log`, so keeping
 * it aligned with the label is the point of the operation.
 */
export async function renameWorkspace(
  workspace: Workspace,
  project: Project,
  name: string,
  exec: GitExec
): Promise<{ name: string; branch: string }> {
  const trimmed = name.trim()
  if (trimmed === '') {
    throw new WorkspaceError('nameEmpty', {}, 'A workspace name cannot be empty.')
  }

  const branch = branchFor(project, trimmed)
  if (branch === workspace.branch) {
    // The slug did not change — nothing for git to do.
    return { name: trimmed, branch }
  }

  try {
    await renameBranch(exec, workspace.branch, branch)
  } catch {
    throw new WorkspaceError('branchExists', { branch }, `Branch ${branch} already exists.`)
  }

  return { name: trimmed, branch }
}

export interface RemoveOptions {
  /** Discard uncommitted work. Only ever true after the user was told. */
  readonly force?: boolean
  /** Also delete the branch, losing any commits that were never merged. */
  readonly deleteBranch?: boolean
  /**
   * The branch to measure "merged" against, when one is being deleted.
   *
   * Supplied so the check can happen before anything is destroyed. Without it
   * the branch is deleted with `-D`, which is what removing a whole project
   * does — there, the user has already agreed to lose the lot.
   */
  readonly baseBranch?: string
}

/**
 * The two git contexts an operation on a workspace needs.
 *
 * They are genuinely different directories: worktrees and branches are managed
 * from the repository, while the state of the work lives inside the workspace.
 * Passing one executor for both silently asks the wrong directory.
 */
export interface WorkspaceExec {
  readonly repository: GitExec
  readonly workspace: GitExec
}

/**
 * Removes a workspace's worktree, and optionally its branch.
 *
 * Uncommitted work blocks the removal unless forced: git refuses on its own,
 * but checking first lets the UI explain what is at stake instead of showing
 * a failed command.
 */
export async function removeWorkspace(
  workspace: Workspace,
  exec: WorkspaceExec,
  options: RemoveOptions = {}
): Promise<void> {
  const force = options.force ?? false

  if (!force && (await holdsUncommittedWork(exec.workspace))) {
    throw new WorkspaceError(
      'uncommittedChanges',
      { name: workspace.name },
      `${workspace.name} has uncommitted changes.`
    )
  }

  // Both checks happen before anything is destroyed. `git branch -d` refuses an
  // unmerged branch, and refusing after the worktree is gone leaves the caller
  // with half an operation: the directory deleted, the branch still there, and
  // an error about the branch.
  if (options.deleteBranch === true && !force && options.baseBranch !== undefined) {
    const merged = await isBranchMerged(exec.repository, workspace.branch, options.baseBranch)

    if (!merged) {
      throw new WorkspaceError(
        'branchUnmerged',
        { name: workspace.name, branch: workspace.branch },
        `${workspace.branch} has commits that are not in ${options.baseBranch}.`
      )
    }
  }

  await removeWorktree(exec.repository, workspace.path, force)

  if (options.deleteBranch === true) {
    // Forced by this point: either the caller asked for force, or the branch
    // was shown to be merged above. Anything else has already thrown.
    await deleteBranch(exec.repository, workspace.branch, true)
  }
}

/**
 * Whether a workspace holds uncommitted work.
 *
 * A directory that is already gone counts as clean: there is nothing left to
 * lose, and refusing to tidy up the record would leave the user stuck with an
 * entry they cannot remove.
 */
async function holdsUncommittedWork(exec: GitExec): Promise<boolean> {
  try {
    return await hasUncommittedChanges(exec)
  } catch {
    return false
  }
}

/**
 * Undoes a half-finished creation.
 *
 * A worktree without a record is invisible to the app yet blocks every later
 * attempt with "already exists". Best-effort by design: this runs while
 * another failure is already being handled, and a second one must not replace
 * the original.
 */
export async function rollbackWorkspace(workspace: Workspace, exec: GitExec): Promise<void> {
  try {
    await removeWorktree(exec, workspace.path, true)
  } catch {
    // Nothing better to do — the caller is already failing.
  }

  try {
    await deleteBranch(exec, workspace.branch, true)
  } catch {
    // Same.
  }
}

/**
 * Reconciles stored workspaces with what git actually has.
 *
 * git is the source of truth about worktrees; the store only holds what git
 * does not know. A workspace whose directory vanished is marked rather than
 * dropped: silently deleting records would hide the discrepancy instead of
 * surfacing it (§13).
 */
export function reconcile(
  workspaces: readonly Workspace[],
  worktrees: readonly Worktree[] | null,
  changes: ReadonlyMap<string, number> = new Map()
): WorkspaceView[] {
  // `null` means git could not be asked — the repository was moved, renamed or
  // is otherwise unreadable. That says nothing about whether the worktrees are
  // still there, so nothing is marked missing: the alternative is claiming
  // every workspace has been removed, and the UI acts on that by closing their
  // terminals.
  if (worktrees === null) {
    return workspaces.map((workspace) => ({
      ...workspace,
      missing: false,
      changedFiles: changes.get(workspace.id) ?? 0
    }))
  }

  // A prunable entry is one git still lists but whose directory is gone, so it
  // counts as missing rather than as present.
  const present = new Set(
    worktrees.filter((worktree) => !worktree.prunable).map((worktree) => worktree.path)
  )

  return workspaces.map((workspace) => ({
    ...workspace,
    missing: !present.has(workspace.path),
    changedFiles: changes.get(workspace.id) ?? 0
  }))
}

/**
 * Counts uncommitted files in one workspace.
 *
 * A worktree that cannot be read reports zero rather than failing: the count
 * is an indicator, and a broken one must not take the surrounding view with it.
 */
export async function changeCount(
  workspace: Workspace,
  makeExec: (cwd: string) => GitExec
): Promise<number> {
  try {
    return (await changedFiles(makeExec(workspace.path))).length
  } catch {
    return 0
  }
}

/**
 * Counts uncommitted files per workspace.
 *
 * Failures are handled per workspace on purpose: one broken worktree should
 * not blank out the counts for every other one.
 */
export async function countChanges(
  workspaces: readonly Workspace[],
  makeExec: (cwd: string) => GitExec
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()

  await Promise.all(
    workspaces.map(async (workspace) => {
      counts.set(workspace.id, await changeCount(workspace, makeExec))
    })
  )

  return counts
}
