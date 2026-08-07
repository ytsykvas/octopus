/**
 * git worktree operations.
 *
 * Builds on the `GitExec` from `git.ts` rather than introducing its own
 * runner, so every command still goes through `execFile` (§11.2).
 */

import type { GitExec } from './git.js'

const BRANCH_REF_PREFIX = 'refs/heads/'

export interface Worktree {
  readonly path: string
  /** Branch name without the `refs/heads/` prefix; null when HEAD is detached. */
  readonly branch: string | null
  readonly head: string
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

  const flush = (): void => {
    if (path !== null) worktrees.push({ path, head, branch })
    path = null
    head = ''
    branch = null
  }

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      path = line.slice('worktree '.length)
    } else if (line.startsWith('HEAD ')) {
      head = line.slice('HEAD '.length)
    } else if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length)
      branch = ref.startsWith(BRANCH_REF_PREFIX) ? ref.slice(BRANCH_REF_PREFIX.length) : ref
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
 * Branch names.
 *
 * Needed twice over: picking a workspace name, where a branch outliving its
 * worktree means the store alone cannot tell which names are taken, and
 * choosing a project's base branch.
 *
 * `includeRemote` adds tracking branches, because a freshly cloned repository
 * often has only `main` locally while `develop` or `staging` exist solely on
 * the remote — and git will happily branch a worktree from either.
 */
export async function listBranches(exec: GitExec, includeRemote = false): Promise<string[]> {
  const output = await exec([
    'branch',
    ...(includeRemote ? ['--all'] : []),
    '--format=%(refname:short)'
  ])

  return (
    output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      // `origin/HEAD` is a pointer at the remote's default branch, not a branch
      // of its own; offering it would mean picking a name that moves.
      .filter((line) => !line.endsWith('/HEAD'))
  )
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
