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

/** Creates a worktree on a new branch started from `base`. */
export async function addWorktree(
  exec: GitExec,
  path: string,
  branch: string,
  base: string
): Promise<void> {
  await exec(['worktree', 'add', '-b', branch, path, base])
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
 * Paths reported by `git status --porcelain`.
 *
 * Both staged and unstaged changes count, as do untracked files: all of them
 * are work that would be lost with the worktree.
 */
export async function changedFiles(exec: GitExec): Promise<string[]> {
  const output = await exec(['status', '--porcelain'])
  return output.split('\n').filter((line) => line.trim() !== '')
}

export async function hasUncommittedChanges(exec: GitExec): Promise<boolean> {
  return (await changedFiles(exec)).length > 0
}
