/**
 * Workspace lifecycle: create, rename, remove.
 *
 * A layer over `worktree.ts` and `store.ts`, shaped like `projects.ts` —
 * typed errors carrying a code the UI localises, and no knowledge of Electron.
 *
 * The layout follows Conductor's: one directory per workspace, one branch per
 * workspace, both named after the workspace. Unlike Conductor, everything
 * lives under a single root (§12.5).
 */

import { access, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import type { AgentKind, Chat, ChatStatus } from './chats.js'
import { CodedError } from './codedError.js'
import { anyBranchExists, countAhead, type GitExec, reasonFrom, toSlug } from './git.js'
import { fetchRemote, resolveBase } from './remotes.js'
import { nextWorkspaceName, type Random } from './names.js'
import { workspacePath } from './paths.js'
import { firstFreeBlock, POOL_START } from './ports.js'
import type { Project, State, Workspace } from './store.js'
import {
  addWorktree,
  changedFiles,
  listBranches,
  listWorktrees,
  deleteBranch,
  hasUncommittedChanges,
  isBranchMerged,
  pruneWorktrees,
  removeWorktree,
  renameBranch,
  type Worktree,
  isReachableElsewhere
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
  /** The base branch's remote refused, or could not be reached. */
  | 'fetchFailed'
  /** The env file resolves outside the worktree, through a symbolic link. */
  | 'envPathEscapes'

export class WorkspaceError extends CodedError<WorkspaceErrorCode> {
  override readonly name = 'WorkspaceError'
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
  /**
   * Commits this branch has that its project's base does not.
   *
   * Beside the count of uncommitted files rather than folded into it, because
   * the two answer different halves of one question — is there anything here a
   * pull request could carry. A workspace that has committed everything is the
   * state most ready for one and has no changed files at all, so the count
   * above on its own hid the button exactly when it was most wanted.
   */
  readonly ahead: number
  /** The directory is gone — removed outside the app. */
  readonly missing: boolean
  /**
   * The workspace's conversations, in the order they were opened.
   *
   * The list draws one dot per conversation, so it needs each one's state
   * rather than only the workspace's summary of them: three agents at work,
   * one of them waiting for an answer, is what the row has to be able to say.
   *
   * The id comes too, because the status arrives afterwards on `chats:status`
   * and has to find the entry it belongs to.
   */
  readonly chats: readonly WorkspaceChat[]
}

/** One conversation of a workspace, as the list draws it. */
export interface WorkspaceChat {
  readonly id: string
  /** Which agent runs it — the row names a conversation by it, as the strip does. */
  readonly agent: AgentKind
  /** A name the user gave it, or null for the one it is given. */
  readonly title: string | null
  readonly status: ChatStatus
  /**
   * Whether a session has ever run here.
   *
   * What tells a conversation that finished cleanly from one nobody has written
   * in yet: both are `idle`, and the dot in the list draws them differently.
   * The same fact the tab strip calls `started`, and read the same way — a
   * session id is written the moment the agent answers and kept afterwards.
   */
  readonly started: boolean
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
  /** Injectable so a test never opens a socket to find a free port. */
  readonly answers?: (port: number) => Promise<boolean>
  /**
   * The executor the fetch runs through, when it must differ from the rest.
   *
   * The fetch is the only command here that leaves the machine, so it is the
   * only one wanting a deadline and a refusal to prompt for credentials.
   * Defaults to `exec`, which is what a test driving a bare repository on disk
   * wants — there is nothing there to hang on.
   */
  readonly fetchExec?: GitExec
}

/**
 * The ref to branch from, brought up to date first.
 *
 * A stale base is the whole failure this exists to prevent, so a remote that
 * refuses or cannot be reached stops the creation rather than quietly handing
 * back a workspace a fortnight behind. It runs before anything is created, so
 * there is nothing to roll back when it throws.
 *
 * A repository with no remote — a project added from a local folder that was
 * never pushed — has nothing to fetch and nothing that could be stale. That is
 * not a failure of any kind, and `resolveBase` says so in one command.
 */
export async function freshBase(base: string, exec: GitExec, fetchExec: GitExec): Promise<string> {
  const { remote, ref } = await resolveBase(exec, base)
  if (remote === null) return ref

  try {
    await fetchRemote(fetchExec, remote)
  } catch (error) {
    throw new WorkspaceError(
      'fetchFailed',
      { remote, reason: reasonFrom(error) },
      `Could not fetch ${remote}.`
    )
  }

  return ref
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
  const fetchExec = options.fetchExec ?? exec

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

  // Last of the local checks rather than first: the refusals above are instant,
  // and putting a network call in front of them would make a cheap "that name
  // is taken" cost half a minute.
  await addWorktree(exec, path, branch, await freshBase(project.baseBranch, exec, fetchExec))

  return {
    id,
    projectId: project.id,
    name,
    branch,
    path: await canonicalPath(exec, branch, path),
    status: 'idle',
    /*
     * The lowest block nothing is using. A pool that is entirely spoken for
     * falls back to its first block rather than refusing to make the
     * workspace: everything else about it works, and a port that clashes says
     * so the moment a server binds — which is the script's own words rather
     * than an invented failure from us.
     */
    port:
      (await firstFreeBlock(
        state.workspaces.map((workspace) => workspace.port),
        options.answers
      )) ?? POOL_START,
    createdAt: new Date().toISOString(),
    // Following the project, which is what a workspace nobody has moved does.
    envProfile: null,
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

  // Asked before the attempt, so a failure can be named. Mapping every
  // rejection to "already exists" blamed the new name for whatever went wrong —
  // including the branch being renamed from a terminal, where the truth is that
  // the old one is gone.
  if (await anyBranchExists(exec, branch)) {
    throw new WorkspaceError('branchExists', { branch }, `Branch ${branch} already exists.`)
  }

  // Anything else propagates with git's own stderr, which says more than a
  // guess would.
  await renameBranch(exec, workspace.branch, branch)

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
  /**
   * A second opinion on "merged", asked only when git says no.
   *
   * git answers whether these commits are literally ancestors of the base,
   * which is false after a squash or a rebase — and those are two of the three
   * ways this app's own merge button offers to land a branch. So a request
   * merged through octopus would leave a branch octopus then refused to delete.
   *
   * Optional: without it the git answer stands, which is what removing a
   * project does and what a repository with no remote gets.
   */
  readonly mergedRemotely?: () => Promise<boolean>
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
 * Answers whether a workspace may be removed, and throws saying why if not.
 *
 * Separate from the removal itself because the caller destroys things this
 * function knows nothing about — a workspace's conversations, and the cleanup
 * script that drops its database. Those go first, so that a live session is
 * not left pointed at a directory about to vanish; and a refusal after them is
 * a refusal that has already cost the user their history. So the question is
 * asked on its own, before any of it.
 *
 * Uncommitted work blocks the removal unless forced: git refuses on its own,
 * but checking first lets the UI explain what is at stake instead of showing
 * a failed command.
 */
export async function ensureRemovable(
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
    /*
     * Three questions, cheapest first, and none of them is "is it merged".
     *
     * What deleting a branch risks is losing a commit for good, so that is
     * what is asked. An ordinary merge answers the first. Work that lives on
     * another branch — a workspace cut from `main` while the project measures
     * against `develop`, say — answers the second, and used to be refused over
     * commits that were never in danger. A squash or rebase merge, which
     * rewrites the commits and so satisfies neither, answers the third.
     *
     * The first two are local. Only the last one reaches the network, and only
     * when the other two have already said no.
     */
    const safe =
      (await isBranchMerged(exec.repository, workspace.branch, options.baseBranch)) ||
      (await isReachableElsewhere(exec.repository, workspace.branch)) ||
      (await (options.mergedRemotely?.() ?? Promise.resolve(false)))

    if (!safe) {
      throw new WorkspaceError(
        'branchUnmerged',
        { name: workspace.name, branch: workspace.branch },
        `${workspace.branch} has commits that are not in ${options.baseBranch}.`
      )
    }
  }
}

/**
 * Discards a workspace's worktree, and optionally its branch.
 *
 * Asks nothing: `ensureRemovable` is what refuses, and by here the caller has
 * already been told yes and acted on it. Calling this without having asked
 * removes a workspace holding work nobody agreed to lose.
 */
export async function discardWorkspace(
  workspace: Workspace,
  exec: WorkspaceExec,
  options: RemoveOptions = {}
): Promise<void> {
  await discardWorktree(exec.repository, workspace.path, options.force ?? false)

  if (options.deleteBranch === true) {
    // Forced by this point: either the caller asked for force, or the branch
    // was shown to be merged above. Anything else has already thrown.
    await deleteBranch(exec.repository, workspace.branch, true)
  }
}

/**
 * Removes a workspace's worktree, and optionally its branch.
 *
 * The two halves in the order they belong in, for a caller with nothing of its
 * own to destroy in between. `removeWorkspaceById` in `service.ts` is the one
 * that has, and it calls them separately.
 */
export async function removeWorkspace(
  workspace: Workspace,
  exec: WorkspaceExec,
  options: RemoveOptions = {}
): Promise<void> {
  await ensureRemovable(workspace, exec, options)
  await discardWorkspace(workspace, exec, options)
}

/**
 * Removes the worktree, counting one that is already gone as removed.
 *
 * `git worktree remove` fails on a path it does not recognise, and that turned
 * a workspace whose directory had been deleted into a record nothing could
 * clear: the very operation meant to tidy it up was the one that failed, with
 * "is not a working tree" shown to someone who was asking for exactly that.
 *
 * Pruning afterwards clears the entry git keeps inside the repository, which
 * `git worktree remove` would have cleared and did not.
 *
 * A failure with the directory still on disk is a real one — a tree holding
 * changes and refusing to go without `force`, a locked worktree — and is left
 * to the caller. Only absence is forgiven.
 */
async function discardWorktree(exec: GitExec, path: string, force: boolean): Promise<void> {
  try {
    await removeWorktree(exec, path, force)
  } catch (error) {
    if (await pathExists(path)) throw error
    await pruneWorktrees(exec)
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
  counts: ReadonlyMap<string, WorkspaceCounts> = new Map(),
  /**
   * Every chat in the state, not one workspace's.
   *
   * Filtered here rather than grouped by the caller: the caller has the flat
   * list, and pre-grouping it would be a second shape to keep in step for a
   * handful of records.
   */
  chats: readonly Chat[] = []
): WorkspaceView[] {
  const conversations = (workspace: Workspace): WorkspaceChat[] =>
    chats
      .filter((chat) => chat.workspaceId === workspace.id)
      .map((chat) => ({
        id: chat.id,
        agent: chat.agent,
        title: chat.title,
        status: chat.status,
        started: chat.sessionId !== null
      }))

  // `null` means git could not be asked — the repository was moved, renamed or
  // is otherwise unreadable. That says nothing about whether the worktrees are
  // still there, so nothing is marked missing: the alternative is claiming
  // every workspace has been removed, and the UI acts on that by closing their
  // terminals.
  if (worktrees === null) {
    return workspaces.map((workspace) => ({
      ...workspace,
      missing: false,
      ...(counts.get(workspace.id) ?? NOTHING),
      chats: conversations(workspace)
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
    ...(counts.get(workspace.id) ?? NOTHING),
    chats: conversations(workspace)
  }))
}

/**
 * What git says about a workspace's work, in the two numbers the list draws.
 *
 * One record rather than two maps threaded side by side: they are read in the
 * same pass, about the same worktree, and answer two halves of one question.
 */
export interface WorkspaceCounts {
  readonly changedFiles: number
  readonly ahead: number
}

/** What a workspace nothing could be read from reports. */
const NOTHING: WorkspaceCounts = { changedFiles: 0, ahead: 0 }

/**
 * Uncommitted files in one workspace.
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
 * Both counts per workspace.
 *
 * Failures are handled per workspace on purpose: one broken worktree should
 * not blank out the counts for every other one. Both reads are local — one
 * `status --porcelain` and one `rev-list --count` — and they run together
 * across every workspace, so a project of eight costs one round of git rather
 * than sixteen in a row.
 */
export async function countChanges(
  workspaces: readonly Workspace[],
  baseBranch: string,
  makeExec: (cwd: string) => GitExec
): Promise<Map<string, WorkspaceCounts>> {
  const counts = new Map<string, WorkspaceCounts>()

  await Promise.all(
    workspaces.map(async (workspace) => {
      const [changedFiles, ahead] = await Promise.all([
        changeCount(workspace, makeExec),
        countAhead(makeExec(workspace.path), baseBranch, workspace.branch)
      ])

      counts.set(workspace.id, { changedFiles, ahead })
    })
  )

  return counts
}

/**
 * An absolute path inside the worktree, or null when the request climbs out.
 *
 * The path comes from the renderer, which is drawing agent output — so it is
 * the agent's word for a file, arriving over a boundary where types have been
 * erased. Before it is handed to the operating system it has to be shown to be
 * inside the workspace it claims to belong to. `readChangeContext` asks the
 * same question of the same kind of value, privately.
 *
 * The family now lives in `paths.ts` — `insideWorktree` for the string and
 * `unlinkedInside` for the filesystem under it. This one stays here for the
 * moment because it answers with the resolved path rather than a yes or no, and
 * requires the file to exist; a third caller wanting *that* shape is when it
 * should join them.
 */
export async function fileInWorkspace(workspace: Workspace, path: string): Promise<string | null> {
  const lexical = resolve(workspace.path, path)
  const step = relative(resolve(workspace.path), lexical)
  if (step === '' || step.startsWith('..') || isAbsolute(step)) return null

  /*
   * Lexical containment is not containment.
   *
   * `resolve` does not follow symlinks, and a symlink is something an agent can
   * leave inside the worktree pointing anywhere — so a file listed in the diff
   * as `notes.txt` can be `~/.ssh/id_rsa`, and handing that to the system to
   * open is not what "open the file in this workspace" meant.
   *
   * Both sides are resolved for real, because the worktree's own path may run
   * through a symlink too: `/var` is one on macOS, which is the reason
   * `canonicalPath` above exists at all.
   */
  try {
    const root = await realpath(workspace.path)
    const real = await realpath(lexical)
    const inside = relative(root, real)

    return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside) ? real : null
  } catch {
    // Gone between the listing and the click, or unreadable. Either way there
    // is nothing to open, and nothing to be proved about where it points.
    return null
  }
}
