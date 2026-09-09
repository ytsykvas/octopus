/**
 * How far a workspace's changes have travelled towards GitHub.
 *
 * `diff.ts` answers what changed against the branch this workspace grew out of.
 * That is one comparison, and it folds committed, staged and unstaged work into
 * a single pile — which is exactly the question a reviewer does *not* have when
 * a pull request is open. The one they have is: has the request seen this yet?
 *
 * Two facts per file answer it, and they are independent, so neither is allowed
 * to hide the other: how far the change got, and whether the request is already
 * showing an older version of that same file.
 *
 * Built on `GitExec` like every other git module, so nothing here spawns
 * anything itself (§11.2). Nothing here writes either — `diff.ts` makes that
 * promise about the read this joins, and a `fetch` would break it, refs being
 * writes.
 */

import { countAhead, currentBranch, type GitExec, resolveRef } from './git.js'
import { allOf } from './parallel.js'
import { listRemotes } from './remotes.js'

/**
 * How far one file's change has travelled.
 *
 * A ladder rather than a set of flags: the rungs are ordered, every change is
 * on exactly one of them, and the furthest-behind rung is the one worth naming.
 * A file committed once and edited again reads `uncommitted`, because
 * committing it again is the work still to do.
 */
export type PublishState = 'uncommitted' | 'committed' | 'pushed'

/** The reads the classification is made from, kept together so it stays pure. */
export interface PublishStatus {
  /**
   * The tip of this branch's copy on the remote, or null where it has none.
   *
   * Null is the ordinary state of a workspace nobody has pushed yet, not a
   * failure: the branch is created with `--no-track` (`worktree.ts`), so it has
   * no upstream until the first `git push -u`.
   */
  readonly remoteCommit: string | null
  /**
   * Whether this repository has an `origin` at all.
   *
   * Apart from `remoteCommit`, because the two nulls mean opposite things and
   * the pane says opposite things about them. A project needs a git repository,
   * a commit and a base branch (`projects.ts`) — never a remote — so a
   * local-only repository is supported, and a permanent band about GitHub over
   * one is a band that can never become true or be dismissed.
   */
  readonly hasRemote: boolean
  /**
   * Whether the branch this is about is the one the worktree has checked out.
   *
   * Every read here is anchored on `HEAD` while the branch arrives as a name,
   * and the workspace's terminal is a shipped tab with `git checkout` one
   * command away. Apart, the copy of `work` on the remote is compared against a
   * `side` that never had one, and the answer is reported as where this
   * workspace stands.
   *
   * A boolean rather than the name of wherever HEAD went: "on another branch"
   * and "on no branch" are one fact to the reader and one thing to do about it,
   * and `currentBranch` answering null for a detached HEAD falls out of the
   * comparison with no arm of its own.
   */
  readonly headOnBranch: boolean
  /** Commits here the remote's copy does not have. */
  readonly unpushedCommits: number
  /** Paths the remote's copy of the branch changed, measured from its fork. */
  readonly onRemote: ReadonlySet<string>
  /** Paths differing between the remote's copy and the working tree. */
  readonly beyondRemote: ReadonlySet<string>
  /** Paths differing between HEAD and the working tree, untracked ones too. */
  readonly beyondHead: ReadonlySet<string>
}

export interface ReadPublishOptions {
  /** The workspace's own branch, which is what has a copy on the remote. */
  readonly branch: string
  /** Where the branch began — the left-hand side `diff.ts` already resolved. */
  readonly baseCommit: string
  /**
   * Untracked paths, which no `git diff` will ever list.
   *
   * Passed in rather than read again: `readWorkspaceDiff` has already asked
   * `ls-files --others`, and asking twice would let the two answers disagree
   * about a file created between them.
   */
  readonly untracked: readonly string[]
}

/**
 * Paths arrive raw rather than octal-escaped.
 *
 * The same setting `diff.ts` pins, and for a sharper reason here: these names
 * are compared against the ones that module produced, and `\320\243` matches
 * nothing.
 */
const RAW_PATHS = ['-c', 'core.quotePath=false'] as const

/**
 * The flags a name listing needs, which is fewer than a diff needs.
 *
 * `--find-renames` so a move is one destination path rather than a deletion
 * beside an addition — the same pairing `diff.ts` asks for, so the two listings
 * describe the same set of files. The prefix and colour settings that module
 * pins have nothing to act on here: `--name-only` prints no diff body.
 *
 * Not imported from `diff.ts`, which imports this module: a cycle between two
 * modules over a constant array is a worse trade than five lines repeated.
 */
const NAME_FLAGS = ['--no-ext-diff', '--find-renames'] as const

/** The remote a workspace branch is pushed to, and the only one asked about. */
const ORIGIN = 'origin'

/**
 * Where this branch's copy on the remote is, or null where it has none.
 *
 * The upstream first, because that is what the branch was actually pushed to,
 * and it is set by the `push -u` in `pullRequests.ts`. Then `origin/<branch>`,
 * which answers for a branch pushed by hand from the workspace's own terminal
 * to a remote whose ref never became an upstream.
 *
 * A cache, and worth saying so: this is what the last fetch or push left in
 * this clone, not what GitHub holds this second. Every push of a workspace
 * branch goes through this app or that terminal, and both update the ref — so
 * it is current by construction, and would only drift for a branch pushed from
 * another machine.
 */
async function remoteCopy(
  exec: GitExec,
  branch: string,
  baseCommit: string
): Promise<string | null> {
  return (
    (await resolveRef(exec, `${branch}@{upstream}`)) ??
    (await trackingCopy(exec, branch, baseCommit))
  )
}

/**
 * The remote-tracking ref, but only where it could be this branch's own copy.
 *
 * Workspace names are recycled. `takenByBranches` in `workspaces.ts` excludes
 * only names held by *local* branches, removing a workspace deletes the local
 * branch, and octopus fetches without `--prune` — so
 * `refs/remotes/origin/<prefix>/<name>` outlives the workspace that pushed it,
 * and the next workspace to draw that name inherits a dead ref as its "copy on
 * the remote". Measured: the strip claimed three commits to push where there
 * was one, files from somebody else's branch carried the stale warning, and
 * pressing Push revived a merged branch behind a closed request.
 *
 * The base being an ancestor is what tells the two apart: a genuine copy of
 * this branch was pushed from a commit that has this branch's fork point behind
 * it, and a leftover from a different piece of work does not.
 *
 * Only the fallback is guarded. An upstream is configuration this branch
 * carries, so it names this branch's copy by construction — and a rebase moves
 * the fork point past the pushed tip, which would make this test refuse a copy
 * that plainly exists.
 */
async function trackingCopy(
  exec: GitExec,
  branch: string,
  baseCommit: string
): Promise<string | null> {
  const ref = await resolveRef(exec, `refs/remotes/${ORIGIN}/${branch}`)
  if (ref === null) return null

  return (await isAncestor(exec, baseCommit, ref)) ? ref : null
}

/** Whether one commit is reachable from another. Exit status is the answer. */
async function isAncestor(exec: GitExec, commit: string, of: string): Promise<boolean> {
  try {
    await exec(['merge-base', '--is-ancestor', commit, of])
    return true
  } catch {
    // Exit 1 is "no", and anything else — a missing object in a partial clone,
    // a ref that has been garbage-collected — is not a "yes" either.
    return false
  }
}

/** Where two commits parted, or null where they share no history. */
async function forkOf(exec: GitExec, revision: string, of: string): Promise<string | null> {
  try {
    const out = (await exec(['merge-base', revision, of])).trim()
    return out === '' ? null : out
  } catch {
    return null
  }
}

/**
 * Commits on this branch the remote's copy lacks, or null where it has no copy.
 *
 * Null rather than a number, because the two callers want different fallbacks:
 * the diff pane counts from the merge base, and the pull request pane already
 * has that number under another name. Answering zero here would be a lie in
 * both — a branch that has never been pushed has everything left to push.
 *
 * Takes the base as a revision rather than a commit, because its caller has the
 * branch name and this has to resolve the fork point anyway to tell a real copy
 * from a leftover ref.
 */
export async function countUnpushed(
  exec: GitExec,
  branch: string,
  base: string
): Promise<number | null> {
  /* The count below is `HEAD` against this branch's copy on the remote, so with
     HEAD standing somewhere else the two ends are different branches. Null
     already means "cannot say", and the caller's fallback is measured on the
     branch itself. */
  if ((await currentBranch(exec)) !== branch) return null

  const baseCommit = await forkOf(exec, base, 'HEAD')
  if (baseCommit === null) return null

  const remoteCommit = await remoteCopy(exec, branch, baseCommit)
  return remoteCommit === null ? null : countAhead(exec, remoteCommit, 'HEAD')
}

/**
 * Everything the classification below needs, in as few reads as it takes.
 *
 * `allOf` rather than `Promise.all`, for the reason `pullRequests.ts` records:
 * these run against a worktree the caller may stop holding, and rejecting on
 * the first would leave the rest writing into a directory that is going away.
 */
export async function readPublishStatus(
  exec: GitExec,
  options: ReadPublishOptions
): Promise<PublishStatus> {
  /* Asked before anything is compared, because everything below is anchored on
     `HEAD`: the listings, the count, and the copy on the remote that they are
     measured against. With HEAD on another branch the comparison is between two
     different pieces of work, and the answer would be reported as where this
     workspace stands. Skipping `remoteCopy` puts the read on the arm it already
     has for a branch nobody has pushed — no file can reach `pushed`,
     `nothingToSend` cannot come out true, and the commit count becomes what is
     actually checked out since it left the base. */
  const headOnBranch = (await currentBranch(exec)) === options.branch

  const remoteCommit = headOnBranch
    ? await remoteCopy(exec, options.branch, options.baseCommit)
    : null

  const beyondHeadRead = names(exec, ['HEAD'])
  const remotesRead = listRemotes(exec)

  if (remoteCommit === null) {
    const [beyondHead, unpushedCommits, remotes] = await allOf([
      beyondHeadRead,
      countAhead(exec, options.baseCommit, 'HEAD'),
      remotesRead
    ])

    return {
      remoteCommit,
      hasRemote: remotes.includes(ORIGIN),
      headOnBranch,
      unpushedCommits,
      onRemote: new Set(),
      beyondRemote: new Set(),
      beyondHead: withUntracked(beyondHead, options.untracked)
    }
  }

  /* What the *request* shows, which is the three-dot range GitHub builds it
     from — not the two-dot one. Once the base moves under the branch, a merge
     of `main` or a rebase, everything the base gained meanwhile differs from
     the older pushed copy purely because that copy is older, and a two-dot
     listing calls all of it "changed on the remote". The reviewer then gets a
     red warning about a file the pull request does not contain.

     Resolved explicitly rather than written as `base...remote`: the three-dot
     form is fatal where two commits share no history, and this read is inside
     the `allOf` below with nothing to catch it — which would take the whole
     diff down instead of leaving one warning unsaid. */
  const fork = await forkOf(exec, options.baseCommit, remoteCommit)

  const [onRemote, beyondRemote, beyondHead, unpushedCommits, remotes] = await allOf([
    fork === null ? emptyNames() : names(exec, [fork, remoteCommit]),
    names(exec, [remoteCommit]),
    beyondHeadRead,
    countAhead(exec, remoteCommit, 'HEAD'),
    remotesRead
  ])

  return {
    remoteCommit,
    hasRemote: remotes.includes(ORIGIN),
    // True by construction: there is no remote copy to compare against unless
    // HEAD is on the branch that has one.
    headOnBranch,
    unpushedCommits,
    onRemote,
    beyondRemote,
    beyondHead: withUntracked(beyondHead, options.untracked)
  }
}

/** One `--name-only` listing, as a set to be asked about a path at a time. */
async function names(exec: GitExec, revisions: readonly string[]): Promise<Set<string>> {
  const out = await exec([...RAW_PATHS, 'diff', '--name-only', '-z', ...NAME_FLAGS, ...revisions])
  return new Set(out.split('\0').filter((value) => value !== ''))
}

/** What "we cannot say what the remote changed" looks like to the caller. */
function emptyNames(): Promise<Set<string>> {
  return Promise.resolve(new Set())
}

/**
 * A file git has never seen is not in any diff, and is certainly not committed.
 *
 * Folded in here rather than special-cased in the classification, so there is
 * one rule about untracked files instead of one in each of two places.
 */
function withUntracked(paths: Set<string>, untracked: readonly string[]): Set<string> {
  for (const path of untracked) paths.add(path)
  return paths
}

/**
 * Which rung a path is on.
 *
 * Two questions rather than three: asked the other way round there would be a
 * case nothing can reach, and a branch nothing reaches is a claim nothing tests.
 *
 * A branch with no copy on the remote makes every committed file `committed`
 * without a second read to prove it — there is nothing on the other end for a
 * file to match.
 *
 * `oldPath` as well as `path`, because the three listings pair renames against
 * different candidate pools: they have different left-hand sides, so a deletion
 * that the pane's own listing pairs into a rename can stay unpaired here and
 * appear under the **source** name alone. Asking only the destination let that
 * file fall through to `pushed` while an uncommitted deletion of its source sat
 * in the worktree — and with every file `pushed`, the pane said everything was
 * on GitHub.
 */
export function publishStateOf(
  path: string,
  oldPath: string | null,
  status: PublishStatus
): PublishState {
  if (either(status.beyondHead, path, oldPath)) return 'uncommitted'
  if (status.remoteCommit === null || either(status.beyondRemote, path, oldPath)) return 'committed'
  return 'pushed'
}

/** Either name of a file that may have moved, since only one may be listed. */
function either(paths: ReadonlySet<string>, path: string, oldPath: string | null): boolean {
  return paths.has(path) || (oldPath !== null && paths.has(oldPath))
}

/**
 * Whether the request is already showing an older version of this file.
 *
 * The fact the whole pane exists for: a reviewer reading the request is reading
 * something that is not what is here. It is only worth saying about a file with
 * newer work behind it — a `pushed` file is what the request shows, exactly.
 *
 * `oldPath` for the same reason as above, and it bites hardest here: rename
 * detection prints only the destination, so a file renamed after it was pushed
 * is on the remote under the name it used to have, and without this it reads as
 * brand new when it is the stalest thing in the diff.
 */
export function staleOnRemote(
  path: string,
  oldPath: string | null,
  status: PublishStatus
): boolean {
  if (publishStateOf(path, oldPath, status) === 'pushed') return false
  return either(status.onRemote, path, oldPath)
}

/**
 * Whether the branch has nothing left to send.
 *
 * Asked of the **branch** rather than of the rows on screen, which is the whole
 * point of it living here. The pane's file list holds what differs from the
 * merge base, so a working-tree change that nets out against the base is not in
 * it at all — reverting a pushed file is exactly that — while being precisely a
 * change the remote does not have. Counting `pushed` rows and comparing to the
 * length then said "everything here is on GitHub" over an unsent revert, and
 * hid every badge that might have hinted otherwise.
 *
 * All three reads have to be silent, not just the commit count: `beyondRemote`
 * for uncommitted work against the pushed copy, `beyondHead` because it carries
 * the untracked files no `git diff` lists, and the count for commits whose tree
 * happens to match — an amended commit changes nothing and still has to go.
 */
export function nothingToSend(status: PublishStatus): boolean {
  return (
    status.remoteCommit !== null &&
    status.unpushedCommits === 0 &&
    status.beyondRemote.size === 0 &&
    status.beyondHead.size === 0
  )
}
