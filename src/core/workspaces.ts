/**
 * Workspace lifecycle: create, rename, remove.
 *
 * A layer over `worktree.ts` and `store.ts`, shaped like `projects.ts` —
 * typed errors carrying a code the UI localises, and no knowledge of Electron.
 *
 * One directory per workspace, one branch per workspace, both named after the
 * workspace, and everything under a single root (§12.5).
 */

import { access, readdir, realpath, rm } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import { z } from 'zod'

import type { AgentKind, Chat, ChatStatus } from './chats.js'
import { DEFAULT_REMOTE, remoteBranchName, shortBranchName } from './branches.js'
import { CodedError } from './codedError.js'
import {
  anyBranchExists,
  branchBlocker,
  countAhead,
  type GitExec,
  type IndexCopyReader,
  hasLeftMachine,
  type MakeExec,
  reasonFrom,
  refExists,
  toSlug
} from './git.js'
import { fetchRemote, pruneGoneBranches, resolveBase } from './remotes.js'
import { nextWorkspaceName, type Random } from './names.js'
import { workspacePath } from './paths.js'
import { workspaceSlug } from './scriptEnv.js'
import { firstFreeBlock, POOL_START, type PortProbe } from './ports.js'
import type { Project, State, Workspace } from './store.js'
import { allOf } from './parallel.js'
import { DEFAULT_WORKSPACE_KIND, isWorkspaceKind, type WorkspaceKind } from './workspaceKinds.js'
import {
  addWorktree,
  changedFiles,
  listBranches,
  listRemoteBranches,
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
  /** Another workspace of this project already names the same database. */
  | 'slugTaken'
  /** A branch at, above or below this name exists, so git cannot create it. */
  | 'branchBlocked'
  /** As above, but the branch in the way is a copy on `origin`. */
  | 'branchBlockedRemote'
  /** The branch has left this machine; moving it would leave its pull request behind. */
  | 'branchPublished'

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
   * Whether the worktree still has this workspace's own branch checked out.
   *
   * The workspace terminal is a shipped tab and `git checkout` is one command
   * in it. The Changes tab already notices and the pull request pane already
   * refuses to commit — the list is the thing always on screen, and it was the
   * one place that said nothing.
   *
   * Free: `git worktree list --porcelain` reports the branch of every worktree
   * and `parseWorktrees` already keeps it, so this is a comparison in the same
   * pass that decides `missing` rather than a read of its own.
   *
   * True where git could not be asked at all. An unreadable repository knows
   * nothing about where HEAD is, and "we cannot say" must not draw a warning on
   * every row — the same choice `missing` makes two lines above.
   */
  readonly headOnBranch: boolean
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
  /** Whether its last turn was cut off by the application exiting — `Chat['interrupted']`. */
  readonly interrupted: boolean
  /**
   * When the turn under way began, or null between turns.
   *
   * Live, like the rest of the view: it is kept in memory by the service and
   * never stored, so a restart forgets a turn that the restart ended anyway.
   */
  readonly turnStartedAt: string | null
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

/**
 * Full branch name for a workspace: `<prefix>/<kind>/<name>`.
 *
 * The kind sits in the branch so the answer to "what is this" reaches git and
 * GitHub, not only the card. Branches made before kinds are `<prefix>/<name>`
 * and stay that way until a rename or a new kind moves them.
 */
export function branchFor(project: Project, kind: WorkspaceKind, name: string): string {
  return `${project.branchPrefix}/${kind}/${toSlug(name)}`
}

/**
 * A branch named after a workspace's kind — `<prefix>/feature`, left by a
 * workspace from before kinds — that kept the workspace's branch out of the
 * kind's folder, and the branch the workspace has instead.
 *
 * git keeps branches as files, so `octopus/feature` and `octopus/feature/anna`
 * cannot both exist. Refusing made every creation in such a project fail, and a
 * kind unusable across it; going round costs only the folder, and the window
 * says why.
 */
export interface KindDetour {
  readonly blocker: string
  readonly branch: string
}

/**
 * A workspace as its creation answers it: the record, and the detour its
 * branch took when there was one — for the window, never for the state.
 */
export type CreatedWorkspace = Workspace & { readonly detour?: KindDetour }

interface CreateOptions {
  readonly root?: string
  readonly exists?: (path: string) => Promise<boolean>
  /** Injectable so tests get a fixed name instead of a random one. */
  readonly random?: Random
  /**
   * Whether something answers on a port. Required so a test states its own and
   * never opens a socket to find a free one.
   */
  readonly answers: PortProbe
  /**
   * The executor the fetch runs through, when it must differ from the rest.
   *
   * The fetch is the only command here that leaves the machine, so it is the
   * only one wanting a deadline and a refusal to prompt for credentials.
   * Defaults to `exec`, which is what a test driving a bare repository on disk
   * wants — there is nothing there to hang on.
   */
  readonly fetchExec?: GitExec
  /** Told when the branch had to go round one named after its kind (`KindDetour`). */
  readonly onDetour?: (detour: KindDetour) => void
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
  options: CreateOptions
): Promise<Workspace> {
  const exists = options.exists ?? pathExists
  const fetchExec = options.fetchExec ?? exec

  /*
   * Names are picked per project, so every project starts from the top of the
   * pool: two projects may both have an `anna`.
   *
   * Three things per workspace, not one, and each is here for its own reason.
   *
   * The **current name** is the obvious one. The **creation name** is the
   * directory: a rename moves the label and the branch and deliberately leaves
   * the directory where it is, so without this the pool handed back a name
   * whose folder still held a live worktree — one press in 256, and worse with
   * every renamed workspace a project accumulates. It needs no field of its
   * own: an id is `<project>/<creation name>` and a rename never changes one.
   *
   * Both go in as written. `nextWorkspaceName` is what compares them by slug,
   * because that is the third thing a name has to be unique in and deciding it
   * in two places is how the two halves would drift apart.
   */
  const fromState = state.workspaces
    .filter((workspace) => workspace.projectId === project.id)
    .flatMap((workspace) => [workspace.name, workspace.id.slice(project.id.length + 1)])

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
  // Always the default: the kind is chosen from the card once the workspace
  // exists, while the branch is still only here and renaming it costs nothing.
  const kind = DEFAULT_WORKSPACE_KIND
  const path = workspacePath(project.id, name, options.root)

  if (await exists(path)) {
    throw new WorkspaceError('pathExists', { path }, `${path} already exists.`)
  }

  const { branch, blocker } = await routeBranch(exec, project, kind, name, null)

  // Last of the local checks rather than first: the refusals above are instant,
  // and putting a network call in front of them would make a cheap "that name
  // is taken" cost half a minute.
  const base = await freshBase(project.baseBranch, exec, fetchExec)

  // Frees the names GitHub's deleted branches held, for the next creation:
  // this one's was drawn already. Only `origin`'s copies hold names
  // (`takenByBranches`). Housekeeping, so a failure costs a name, never the
  // workspace — and the network has just answered the fetch, so it is rare.
  await pruneGoneBranches(exec, fetchExec, DEFAULT_REMOTE, project.branchPrefix).catch(() => [])

  await addWorktree(exec, path, branch, base)
  if (blocker !== null) options.onDetour?.({ blocker, branch })

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
    branchSince: null,
    // Following the project, which is what a workspace nobody has moved does.
    envProfile: null,
    notes: '',
    envFileApplied: null,
    // Nobody has written anything here yet.
    writers: {},
    kind,
    ownerId: null
  }
}

/**
 * Workspace names that existing branches already claim.
 *
 * Only branches under the project's prefix count; anything else in the
 * repository is the user's own and none of our business. Both shapes are read:
 * `<prefix>/<kind>/<name>`, and `<prefix>/<name>` from before kinds. The
 * segment after the prefix is a kind only when it is one, since a name may
 * hold a slash of its own.
 *
 * `origin`'s count too: removal deletes the local branch but not the copy
 * there, and a name drawn onto it inherits that branch's history. The copy
 * holds the name until `origin` loses the branch and a creation prunes it.
 */
async function takenByBranches(project: Project, exec: GitExec): Promise<string[]> {
  const prefix = `${project.branchPrefix}/`
  const [local, remote] = await allOf([listBranches(exec), listRemoteBranches(exec)])

  return [...local, ...remote.map(shortBranchName)]
    .filter((branch) => branch.startsWith(prefix))
    .map((branch) => nameIn(branch.slice(prefix.length)))
}

/** The workspace name in what follows the prefix, with the kind taken off. */
function nameIn(rest: string): string {
  const slash = rest.indexOf('/')
  if (slash === -1) return rest

  return isWorkspaceKind(rest.slice(0, slash)) ? rest.slice(slash + 1) : rest
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
 *
 * `siblings` are the project's other workspaces, and they are here for the one
 * collision a branch cannot catch. `toSlug` keeps `_` and `-` apart, so
 * `fix-login` and `fix_login` are two branches — but `workspaceSlug` turns both
 * into `fix_login`, and that is what names a database. Two workspaces sharing
 * it write over each other's data with nothing failing anywhere.
 */
export async function renameWorkspace(
  workspace: Workspace,
  project: Project,
  name: string,
  exec: GitExec,
  siblings: readonly Workspace[] = [],
  onDetour: (detour: KindDetour) => void = () => undefined
): Promise<Pick<Workspace, 'name' | 'branch' | 'branchSince'>> {
  const trimmed = name.trim()
  if (trimmed === '') {
    throw new WorkspaceError('nameEmpty', {}, 'A workspace name cannot be empty.')
  }

  // Named rather than counted: "fix_login is taken" is confusing when the
  // sidebar shows `fix-login`, which is the whole reason the two collide.
  const slug = workspaceSlug(trimmed)
  const clash = siblings.find(
    (other) => other.id !== workspace.id && workspaceSlug(other.name) === slug
  )
  if (clash) {
    throw new WorkspaceError(
      'slugTaken',
      { name: clash.name, slug },
      `${clash.name} already names ${slug}.`
    )
  }

  // A label in other letters asks nothing of the branch. Building it afresh
  // would bring a branch from before kinds onto the new shape, and carry a
  // pushed one whose kind has since changed onto that kind — the lost pull
  // request `rekindWorkspace` refused to cause.
  if (toSlug(trimmed) === toSlug(workspace.name)) {
    return { name: trimmed, branch: workspace.branch, branchSince: workspace.branchSince }
  }

  // GitHub keeps a pull request on the branch it was opened from, so moving a
  // pushed branch leaves the workspace without its own request — the reason
  // `rekindWorkspace` leaves one where it is. A new name would mean a new
  // branch, so it is refused, and said, rather than half done.
  if (await hasLeftMachine(exec, workspace.branch)) {
    throw new WorkspaceError(
      'branchPublished',
      { branch: workspace.branch },
      `${workspace.branch} has been pushed; renaming would leave its pull request behind.`
    )
  }

  const { branch, blocker } = await routeBranch(
    exec,
    project,
    workspace.kind,
    trimmed,
    workspace.branch
  )
  const moved = await moveWorkspaceBranch(workspace, branch, exec)
  if (blocker !== null) onDetour({ blocker, branch })
  return { name: trimmed, ...moved }
}

/**
 * Gives a workspace another kind, and its branch the kind's name while that
 * costs nothing.
 *
 * The branch moves only while it has never left this machine. GitHub keeps a
 * pull request on the branch it was opened from, so a workspace that moved off
 * a pushed one would lose its own request; after the push the kind is the
 * card's label and the branch stays as it was.
 *
 * The same where a branch named after the kind holds its folder (`KindDetour`):
 * there is no other shape the branch could take that says the kind, so it stays,
 * and `onDetour` hears why.
 */
export async function rekindWorkspace(
  workspace: Workspace,
  project: Project,
  kind: WorkspaceKind,
  exec: GitExec,
  onDetour: (detour: KindDetour) => void = () => undefined
): Promise<Partial<Pick<Workspace, 'kind' | 'branch' | 'branchSince'>>> {
  if (kind === workspace.kind) return {}
  if (await hasLeftMachine(exec, workspace.branch)) return { kind }

  const branch = branchFor(project, kind, workspace.name)
  // Back to the kind its branch is named for: nothing moves, so nothing can be
  // in the way of a move.
  if (branch === workspace.branch) {
    return { kind, branch, branchSince: workspace.branchSince }
  }

  const blocker = await kindBlocker(exec, project, kind, branch, workspace.branch)
  if (blocker !== null) {
    onDetour({ blocker, branch: workspace.branch })
    return { kind }
  }

  return { kind, ...(await moveWorkspaceBranch(workspace, branch, exec)) }
}

/**
 * Where a workspace's branch goes for this kind and name: `<prefix>/<kind>/<name>`,
 * or round a branch named after the kind onto `<prefix>/<name>`, the shape from
 * before kinds — with the branch that was in the way, or null.
 *
 * `own` is the branch being moved onto the name, if any (`branchBlocker`).
 */
async function routeBranch(
  exec: GitExec,
  project: Project,
  kind: WorkspaceKind,
  name: string,
  own: string | null
): Promise<{ branch: string; blocker: string | null }> {
  const branch = branchFor(project, kind, name)
  const blocker = await kindBlocker(exec, project, kind, branch, own)
  if (blocker === null) return { branch, blocker }

  // Not onto a branch named after a kind: that would stand in that kind's way
  // for the whole project, the very thing being gone round.
  const slug = toSlug(name)
  if (isWorkspaceKind(slug)) throw blockedBy(branch, blocker)

  const around = `${project.branchPrefix}/${slug}`
  await refuseBlocked(exec, around, own)
  return { branch: around, blocker }
}

/**
 * The branch named after `kind` that stands where `branch` needs a folder, or
 * null where nothing does. Anything else in the way is refused: only the kind's
 * own folder has a way round.
 */
async function kindBlocker(
  exec: GitExec,
  project: Project,
  kind: WorkspaceKind,
  branch: string,
  own: string | null
): Promise<string | null> {
  const blocker = await branchBlocker(exec, branch, own)
  if (blocker === null) return null

  const folder = `${project.branchPrefix}/${kind}`
  if (blocker === folder || blocker === `${DEFAULT_REMOTE}/${folder}`) return blocker
  throw blockedBy(branch, blocker)
}

/**
 * Moves a workspace's branch to a name already routed (`routeBranch`), refusing
 * first a name that is taken.
 *
 * Shared by a rename and a new kind, the two things a branch name follows.
 * Never asked to move a branch onto itself: a rename keeping the branch slug
 * and a new kind its branch is already named for both return before this.
 */
async function moveWorkspaceBranch(
  workspace: Workspace,
  branch: string,
  exec: GitExec
): Promise<Pick<Workspace, 'branch' | 'branchSince'>> {
  // Asked before the attempt, so a failure can be named. Mapping every
  // rejection to "already exists" blamed the new name for whatever went wrong —
  // including the branch being renamed from a terminal, where the truth is that
  // the old one is gone. `origin`'s copy counts as in `takenByBranches`, and
  // always: a branch that has been pushed never gets this far, so the copy can
  // never be the workspace's own.
  const onRemote = remoteBranchName(branch)
  const [local, remote] = await allOf([
    anyBranchExists(exec, branch),
    refExists(exec, `refs/remotes/${onRemote}`)
  ])
  if (local || remote) {
    const taken = local ? branch : onRemote
    throw new WorkspaceError('branchExists', { branch: taken }, `Branch ${taken} already exists.`)
  }

  // Anything else propagates with git's own stderr, which says more than a
  // guess would.
  await renameBranch(exec, workspace.branch, branch)

  return { branch, branchSince: new Date().toISOString() }
}

/**
 * Refuses a branch another one stands in the way of (`branchBlocker`), where
 * `own` is the branch being moved onto it, if any.
 */
async function refuseBlocked(exec: GitExec, branch: string, own: string | null): Promise<void> {
  const blocker = await branchBlocker(exec, branch, own)
  if (blocker !== null) throw blockedBy(branch, blocker)
}

/** The refusal of `branch`, which `blocker` stands in the way of. */
function blockedBy(branch: string, blocker: string): WorkspaceError {
  // Told apart because the advice differs: a copy on origin is not renamed or
  // deleted from here, and nothing local is in the way at all.
  return new WorkspaceError(
    blocker.startsWith(`${DEFAULT_REMOTE}/`) ? 'branchBlockedRemote' : 'branchBlocked',
    { branch, blocker },
    `${blocker} stops ${branch} from being created.`
  )
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
 * What the window may ask of a removal: the two choices its dialog offers.
 *
 * Strict, and narrower than `RemoveOptions`. `force` decides whether
 * uncommitted work is thrown away, so only a boolean will do; the base branch
 * and the GitHub check are the service's to supply, never the window's.
 */
export const RemovalRequestSchema = z.strictObject({
  force: z.boolean().default(false),
  deleteBranch: z.boolean().default(false)
})
/** As the window sends it: either choice may be left out, and reads as no. */
export type RemovalRequest = z.input<typeof RemovalRequestSchema>

/** A new name as it arrives; trimming and the clash checks are `renameWorkspace`'s. */
export const WorkspaceNameSchema = z.string()

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

  if (!force && (await holdsUncommittedWork(exec, workspace.path))) {
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
 * A directory that is still there but that git no longer lists is the same
 * state half done: a removal that stopped while something kept writing into
 * the tree has already dropped git's part and left the files. Nothing is left
 * for git to refuse, so the directory goes by hand — but only when it is empty
 * or the caller has agreed to lose what it holds, because those files were
 * never under git's care and `ensureRemovable` is what told the user so.
 *
 * Any other failure with the directory on disk is a real one — a tree holding
 * changes and refusing to go without `force`, a locked worktree — and is left
 * to the caller.
 */
async function discardWorktree(exec: GitExec, path: string, force: boolean): Promise<void> {
  try {
    await removeWorktree(exec, path, force)
  } catch (error) {
    if (!(await pathExists(path))) {
      await pruneWorktrees(exec)
      return
    }

    if (!(await isOrphaned(exec, path))) throw error
    if (!force && (await holdsLeftovers(path))) throw error

    await rm(path, { recursive: true, force: true })
    await pruneWorktrees(exec)
  }
}

/**
 * Whether a directory is standing where git no longer knows of a worktree.
 *
 * Both sides go through `realpath`: git reports the resolved path, and the one
 * stored for a workspace is not always resolved (`/var` against `/private/var`
 * on macOS). A repository git cannot be asked about answers no — it says
 * nothing about the directory, and the caller treats a no as "leave it alone".
 */
export async function isOrphaned(repository: GitExec, path: string): Promise<boolean> {
  if (!(await pathExists(path))) return false

  try {
    const known = await Promise.all(
      (await listWorktrees(repository)).map((worktree) => resolveOrSelf(worktree.path))
    )
    return !known.includes(await resolveOrSelf(path))
  } catch {
    return false
  }
}

/** Whether a directory holds anything at all. */
export async function holdsLeftovers(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length > 0
  } catch {
    return false
  }
}

async function resolveOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

/**
 * Whether a workspace holds uncommitted work.
 *
 * A directory that is already gone counts as clean: there is nothing left to
 * lose, and refusing to tidy up the record would leave the user stuck with an
 * entry they cannot remove.
 *
 * A directory git has let go of is asked differently. `git status` there would
 * answer for whatever repository lies above it, or fail and read as clean, and
 * either way say nothing of the files that are about to be deleted — so any
 * file in it counts.
 */
async function holdsUncommittedWork(exec: WorkspaceExec, path: string): Promise<boolean> {
  if (await isOrphaned(exec.repository, path)) return holdsLeftovers(path)

  try {
    return await hasUncommittedChanges(exec.workspace)
  } catch {
    return false
  }
}

/**
 * Undoes a branch move whose record could not be stored.
 *
 * Without it the branch has its new name and the record its old one, and the
 * workspace reads as standing on some other branch. Best-effort for the same
 * reason as `rollbackWorkspace`: it runs while the failure that called for it
 * is still being handled.
 */
export async function restoreBranch(exec: GitExec, moved: string, original: string): Promise<void> {
  try {
    await renameBranch(exec, moved, original)
  } catch {
    // The branch may have been moved again by hand; the original failure is
    // the one worth reporting.
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
 * Where each worktree git knows of is standing, by path — or null when git
 * could not be asked at all.
 *
 * `null` means the repository was moved, renamed or is otherwise unreadable.
 * That says nothing about whether the worktrees are still there, so nothing is
 * marked missing from it: the alternative is claiming every workspace has been
 * removed, and the UI acts on that by closing their terminals.
 *
 * A prunable entry is one git still lists but whose directory is gone, so it
 * counts as missing rather than as present. The branch rides along: `--porcelain`
 * reports it per worktree — null for a detached HEAD, which falls out of the
 * comparison in `viewOf` with no arm of its own — so knowing where each
 * worktree is standing costs the allocation and not one more git process.
 */
export function checkedOutBranches(
  worktrees: readonly Worktree[] | null
): ReadonlyMap<string, string | null> | null {
  if (worktrees === null) return null

  return new Map(
    worktrees
      .filter((worktree) => !worktree.prunable)
      .map((worktree) => [worktree.path, worktree.branch] as const)
  )
}

/**
 * One stored workspace as the list draws it.
 *
 * A row is worked out from its own record and the shared readings alone, so
 * one workspace can be read again — when its turn ends — without the rest.
 */
export function viewOf(
  workspace: Workspace,
  checkedOut: ReadonlyMap<string, string | null> | null,
  counts: ReadonlyMap<string, WorkspaceCounts> = new Map(),
  /**
   * Every chat in the state, not one workspace's.
   *
   * Filtered here rather than grouped by the caller: the caller has the flat
   * list, and pre-grouping it would be a second shape to keep in step for a
   * handful of records.
   */
  chats: readonly Chat[] = [],
  /** When each conversation's turn under way began, which only the service knows. */
  turnStarts: ReadonlyMap<string, string> = new Map()
): WorkspaceView {
  const conversations = chats
    .filter((chat) => chat.workspaceId === workspace.id)
    .map((chat) => ({
      id: chat.id,
      agent: chat.agent,
      title: chat.title,
      status: chat.status,
      started: chat.sessionId !== null,
      interrupted: chat.interrupted,
      turnStartedAt: turnStarts.get(chat.id) ?? null
    }))

  if (checkedOut === null) {
    return {
      ...workspace,
      missing: false,
      // Nothing was read, so nothing is claimed. A warning glyph on every row
      // because the repository moved would say the wrong thing loudly.
      headOnBranch: true,
      ...(counts.get(workspace.id) ?? NOTHING),
      chats: conversations
    }
  }

  return {
    ...workspace,
    missing: !checkedOut.has(workspace.path),
    // A worktree git has never heard of is not standing anywhere, and the row
    // already says its directory is gone.
    headOnBranch:
      !checkedOut.has(workspace.path) || checkedOut.get(workspace.path) === workspace.branch,
    ...(counts.get(workspace.id) ?? NOTHING),
    chats: conversations
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
  chats: readonly Chat[] = [],
  turnStarts: ReadonlyMap<string, string> = new Map()
): WorkspaceView[] {
  const checkedOut = checkedOutBranches(worktrees)
  return workspaces.map((workspace) => viewOf(workspace, checkedOut, counts, chats, turnStarts))
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
  makeExec: MakeExec,
  readIndex: IndexCopyReader
): Promise<number> {
  try {
    return (await readIndex(workspace.path, makeExec, changedFiles)).length
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
 * than sixteen in a row. The status runs against the worktree's kept index
 * copy (`readIndex`): on the index itself it hashed every file of a fresh
 * checkout on every turn end, and with `--no-optional-locks` never wrote the
 * answer down.
 */
export async function countChanges(
  workspaces: readonly Workspace[],
  baseBranch: string,
  makeExec: MakeExec,
  readIndex: IndexCopyReader
): Promise<Map<string, WorkspaceCounts>> {
  const counts = new Map<string, WorkspaceCounts>()

  await Promise.all(
    workspaces.map(async (workspace) => {
      const [changedFiles, ahead] = await allOf([
        changeCount(workspace, makeExec, readIndex),
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
