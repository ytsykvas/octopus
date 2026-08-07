/**
 * Low-level git operations.
 *
 * Every call goes through `execFile` — **never** `exec`. Branch names and
 * paths come from the user, and `exec` would hand them to a shell, which is
 * command injection by construction (§11.2 docs/PROJECT.md).
 */

import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'

import { describeError } from './persist.js'

const run = promisify(execFile)

/**
 * Runs git commands.
 *
 * Passed as a parameter to every function so logic can be tested without
 * spawning git, while the commands themselves are verified against a real
 * repository.
 */
export type GitExec = (args: readonly string[]) => Promise<string>

/** A git command failed — carries stderr rather than swallowing it (§13). */
export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly stderr: string
  ) {
    super(`git ${args.join(' ')} failed: ${stderr}`)
    this.name = 'GitError'
  }
}

/**
 * Extracts the most meaningful explanation from a spawn failure.
 *
 * `execFile` usually puts output in `stderr`, but not always: on ENOENT the
 * field is absent, and some failures leave it empty. Extracted so this
 * inconsistency can be covered by a test directly.
 */
export function extractStderr(error: unknown): string {
  const fromField =
    typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : ''

  return fromField.trim() || describeError(error)
}

/** Creates an executor bound to a repository directory. */
export function gitIn(cwd: string): GitExec {
  return async (args) => {
    try {
      const { stdout } = await run('git', [...args], { cwd, maxBuffer: 32 * 1024 * 1024 })
      return stdout
    } catch (error) {
      throw new GitError(args, extractStderr(error))
    }
  }
}

/**
 * The working tree root, or null when the directory is not in a repository.
 *
 * Returns the root rather than the given path: the user may pick a
 * subdirectory, and the project should bind to the repository itself.
 */
export async function findRepositoryRoot(exec: GitExec): Promise<string | null> {
  try {
    const out = await exec(['rev-parse', '--show-toplevel'])
    return out.trim() || null
  } catch {
    return null
  }
}

/** Whether the repository has at least one commit — an empty one cannot host a worktree. */
export async function hasCommits(exec: GitExec): Promise<boolean> {
  try {
    await exec(['rev-parse', '--verify', 'HEAD'])
    return true
  } catch {
    return false
  }
}

/** The current branch, or null when HEAD is detached. */
export async function currentBranch(exec: GitExec): Promise<string | null> {
  const out = (await exec(['branch', '--show-current'])).trim()
  return out || null
}

/** Whether a local branch with this name exists. */
export async function branchExists(exec: GitExec, branch: string): Promise<boolean> {
  try {
    await exec(['rev-parse', '--verify', `refs/heads/${branch}`])
    return true
  } catch {
    return false
  }
}

/**
 * Determines the repository's base branch.
 *
 * Order: origin's default branch → common names → current branch. The last
 * step matters for repositories with unconventional naming.
 */
export async function detectBaseBranch(exec: GitExec): Promise<string | null> {
  try {
    const out = (await exec(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim()
    const name = out.replace(/^origin\//, '')
    if (name) return name
  } catch {
    // origin/HEAD is not configured — normal for local-only repositories.
  }

  for (const candidate of ['main', 'master', 'develop']) {
    if (await branchExists(exec, candidate)) return candidate
  }

  return currentBranch(exec)
}

/** Repository name — the last segment of its root path. */
export function repositoryName(repoRoot: string): string {
  return basename(repoRoot)
}

/**
 * Turns an arbitrary string into a slug safe for directories and branches.
 *
 * Unicode is deliberately preserved: git accepts UTF-8 in branch names, and
 * non-Latin names should stay readable. Only what git actually rejects is
 * stripped (`git check-ref-format`): whitespace, `~^:?*[\`, control
 * characters, double dots, leading/trailing dots and dashes, `.lock` suffix.
 */
export function toSlug(value: string): string {
  const slug = value
    .toLowerCase()
    // eslint-disable-next-line no-control-regex -- control characters are exactly what git rejects
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .replace(/[\s~^:?*[\]\\@{}]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .replace(/\.lock$/, '')

  return slug || 'project'
}
