/**
 * git worktree operations.
 *
 * Builds on the `GitExec` from `git.ts` rather than introducing its own
 * runner, so every command still goes through `execFile` (§11.2).
 */

import type { GitExec } from './git.js'

const BRANCH_REF_PREFIX = 'refs/heads/'
const REMOTE_REF_PREFIX = 'refs/remotes/'

export interface Worktree {
  readonly path: string
  /** Branch name without the `refs/heads/` prefix; null when HEAD is detached. */
  readonly branch: string | null
  readonly head: string
  /**
   * git still lists this worktree, but its directory is gone.
   *
   * Deleting a worktree directory by hand does not remove git's record of it —
   * the entry stays, flagged `prunable`, until someone prunes. Without reading
   * that flag a workspace whose directory has been deleted looks perfectly
   * healthy.
   */
  readonly prunable: boolean
}

/**
 * Parses `git worktree list --porcelain`.
 *
 * Kept separate from the command so it can be tested on strings. The format is
 * blocks separated by blank lines:
 *
 *     worktree /path/to/tree
 *     HEAD 631b1f08…
 *     branch refs/heads/feature/one
 *
 * A detached worktree has a `detached` line instead of `branch`. Branch names
 * may contain slashes, which is exactly what our `<prefix>/<name>` scheme
 * produces — only the ref prefix is stripped.
 */
export function parseWorktrees(output: string): Worktree[] {
  const worktrees: Worktree[] = []

  let path: string | null = null
  let head = ''
  let branch: string | null = null
  let prunable = false

  const flush = (): void => {
    if (path !== null) worktrees.push({ path, head, branch, prunable })
    path = null
    head = ''
    branch = null
    prunable = false
  }

  for (const raw of output.split('\n')) {
    // Trailing \r: the format is line-based, and a stray carriage return would
    // otherwise end up inside a branch name.
    const line = raw.replace(/\r$/, '')

    if (line.startsWith('worktree ')) {
      flush()
      path = line.slice('worktree '.length)
    } else if (line.startsWith('HEAD ')) {
      head = line.slice('HEAD '.length)
    } else if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length)
      branch = ref.startsWith(BRANCH_REF_PREFIX) ? ref.slice(BRANCH_REF_PREFIX.length) : ref
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      prunable = true
    }
  }

  flush()
  return worktrees
}

/** Every worktree of a repository, including the main one. */
export async function listWorktrees(exec: GitExec): Promise<Worktree[]> {
  return parseWorktrees(await exec(['worktree', 'list', '--porcelain']))
}

/**
 * Creates a worktree on a new branch started from `base`.
 *
 * `--no-track`, and it is load-bearing. `base` is whatever `resolveBase`
 * answered, which for any repository with a remote is a remote-tracking ref —
 * and git's default `branch.autoSetupMerge` sets an upstream when a branch
 * starts from one of those. Every workspace branch was therefore born tracking
 * `origin/main`, which nothing here asked for and nothing here uses:
 * `pullRequests.push` passes `-u origin <branch>` itself, and both
 * `deleteBranch` call sites force, so `git branch -d`'s upstream-aware check is
 * never reached.
 *
 * What it costs is worse than untidiness. Under stock `push.default=simple` a
 * bare `git push` in the worktree is refused, and the **first** of the three
 * things git then suggests is `git push origin HEAD:main` — which puts the
 * workspace's work directly onto the project's base branch, the one outcome a
 * worktree per task exists to prevent. A machine with `push.default=current`
 * sees none of this, so it is easy to look for and conclude there is nothing
 * here.
 *
 * One flag rather than `branch.autoSetupMerge=false`: teaching the app to write
 * git config would be the first such write in `src/core`, and it would leak
 * into the user's own work in that checkout.
 */
export async function addWorktree(
  exec: GitExec,
  path: string,
  branch: string,
  base: string
): Promise<void> {
  await exec(['worktree', 'add', '--no-track', '-b', branch, path, base])
}

/**
 * Removes a worktree.
 *
 * Without `force` git refuses when the tree holds modified or untracked
 * files — that refusal is the safety net, so `force` is only ever passed
 * after the user has been told what will be lost.
 */
export async function removeWorktree(exec: GitExec, path: string, force = false): Promise<void> {
  await exec(['worktree', 'remove', ...(force ? ['--force'] : []), path])
}

/** Clears records of worktrees whose directories are gone. */
export async function pruneWorktrees(exec: GitExec): Promise<void> {
  await exec(['worktree', 'prune'])
}

/**
 * Whether every commit on `branch` is already in `base`.
 *
 * Asked before a worktree is destroyed, not after: `git branch -d` refuses an
 * unmerged branch, and by then the directory is gone and the refusal is a
 * failure in the middle of an operation rather than instead of one.
 */
export async function isBranchMerged(
  exec: GitExec,
  branch: string,
  base: string
): Promise<boolean> {
  try {
    await exec(['merge-base', '--is-ancestor', branch, base])
    return true
  } catch {
    // A non-zero exit means "not an ancestor". It also means base is unknown,
    // which is the same answer for our purposes: we cannot show it is merged.
    return false
  }
}

/**
 * Whether the branch's commits survive somewhere other than this branch.
 *
 * The question worth asking before deleting one. "Is it merged into the base"
 * answers something narrower, and answers it wrongly for a workspace cut from
 * one branch while the project measures against another: three commits that
 * sit on `main` read as unmerged work about to be lost, and the removal is
 * refused over commits nothing could lose.
 *
 * The branch's own refs do not count — neither `refs/heads/<branch>` nor the
 * remote copy of the same name. What is being asked is whether some other line
 * of development already holds this, not whether the branch is itself.
 *
 * A ref that merely ends in the same name is treated as the branch's own,
 * which can only make this answer "no" where a longer name happened to
 * collide — refusing a removal that was safe, rather than allowing one that
 * was not.
 */
export async function isReachableElsewhere(exec: GitExec, branch: string): Promise<boolean> {
  let raw: string
  try {
    raw = await exec([
      'for-each-ref',
      `--contains=${branch}`,
      '--format=%(refname)',
      'refs/heads',
      'refs/remotes'
    ])
  } catch {
    // An unknown branch, or a git too old for `--contains` here. Either way
    // this cannot show the commits are safe, which is the answer that refuses.
    return false
  }

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .some((ref) => !ref.endsWith(`/${branch}`))
}

/** Deletes a branch; `force` allows dropping one that was never merged. */
export async function deleteBranch(exec: GitExec, branch: string, force = false): Promise<void> {
  await exec(['branch', force ? '-D' : '-d', branch])
}

/**
 * Local branch names.
 *
 * Needed when picking a workspace name: a branch outlives the worktree it was
 * created for, so the store alone does not know which names are still taken.
 */
export async function listBranches(exec: GitExec): Promise<string[]> {
  return parseBranches(await exec(['branch', '--format=%(refname:short)']))
}

/**
 * Remote-tracking branch names, such as `origin/develop`.
 *
 * These are what a project's base branch is chosen from: they are the shared
 * history everyone works against, whereas a local branch is one person's copy
 * that may be behind, ahead, or long abandoned.
 */
export async function listRemoteBranches(exec: GitExec): Promise<string[]> {
  // The full refname, not the short one: `refs/remotes/origin/HEAD` shortens
  // to plain `origin`, which is indistinguishable from a branch by name alone
  // and would sit in the list looking like one.
  const refs = parseBranches(await exec(['branch', '--remotes', '--format=%(refname)']))

  return refs
    .filter((ref) => !ref.endsWith('/HEAD'))
    .map((ref) => ref.replace(REMOTE_REF_PREFIX, ''))
}

function parseBranches(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/** Renames a branch. Works from any worktree of the repository. */
export async function renameBranch(exec: GitExec, from: string, to: string): Promise<void> {
  await exec(['branch', '-m', from, to])
}

/**
 * Every path `git status` reports, one per line.
 *
 * Both staged and unstaged changes count, as do untracked files: all of them
 * are work that would be lost with the worktree.
 *
 * `-uall` because the default, `-unormal`, reports a directory git has never
 * seen as a single `?? dir/` entry however much is under it. The count this
 * feeds is what tells somebody which of eight parallel workspaces has done
 * work, and an agent that wrote thirty files into one new folder read as one
 * changed file.
 */
export async function changedFiles(exec: GitExec): Promise<string[]> {
  const output = await exec(['status', '--porcelain', '-uall'])
  return output.split('\n').filter((line) => line.trim() !== '')
}

export async function hasUncommittedChanges(exec: GitExec): Promise<boolean> {
  return (await changedFiles(exec)).length > 0
}

/**
 * Stages everything in the worktree and commits it.
 *
 * `add -A` rather than a list of paths: what the caller means is "this
 * workspace's work", and a list assembled from `status --porcelain` would have
 * to reproduce git's own quoting of unusual filenames to say the same thing.
 *
 * Deliberately holds no policy — not whether there is anything to commit, not
 * whether the message is worth having, not what to do when git refuses. Those
 * are questions about a pull request, and `pullRequests.ts` answers them where
 * it can throw the error the renderer knows how to say out loud. A `worktree.ts`
 * reaching for `GitHubError` would be a git module depending on a GitHub one,
 * which is an edge `src/core` does not otherwise have.
 *
 * The message goes as an argument and is never interpolated: it is typed by the
 * user, and one beginning with a dash is a message rather than a flag.
 */
export async function commitAll(exec: GitExec, message: string): Promise<void> {
  await exec(['add', '-A'])
  await exec(['commit', '-m', message])
}
