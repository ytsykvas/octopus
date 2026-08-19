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
    readonly stderr: string,
    /**
     * What Node called the failure: an exit status, or a name when the command
     * never got that far.
     *
     * Carried so a caller can tell git refusing from git answering with more
     * than the buffer holds. Those are different situations with different
     * answers, and without this the only way to tell them apart is by reading
     * a message written for a human.
     */
    readonly code = ''
  ) {
    super(`git ${args.join(' ')} failed: ${stderr}`)
    this.name = 'GitError'
  }
}

/** What Node calls a command whose output did not fit in the buffer. */
export const OUTPUT_TOO_LARGE = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'

/**
 * How much output a git command may produce.
 *
 * Generous, because a diff of a large change is legitimately big; the callers
 * that can produce more than this bound themselves rather than raising it.
 */
export const MAX_OUTPUT_BYTES = 32 * 1024 * 1024

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

/**
 * The name Node gave a spawn failure, when it gave one.
 *
 * A refusal carries the exit status, a command that never ran carries a name
 * like `ENOENT`, and both are stringified so the caller compares one kind of
 * value rather than two.
 */
export function extractCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
}

/**
 * Creates an executor bound to a repository directory.
 *
 * `maxBuffer` is an option so a test can put a real command past the ceiling
 * instead of faking the failure — the interesting case is what a caller does
 * with an overflow, and a fake would only assert that the fake was believed.
 */
export function gitIn(cwd: string, options: { readonly maxBuffer?: number } = {}): GitExec {
  const maxBuffer = options.maxBuffer ?? MAX_OUTPUT_BYTES

  return async (args) => {
    try {
      const { stdout } = await run('git', [...args], { cwd, maxBuffer })
      return stdout
    } catch (error) {
      throw new GitError(args, extractStderr(error), extractCode(error))
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

/**
 * Whether git would keep this path out of a commit.
 *
 * Asked about the env file, which octopus writes into every worktree: a project
 * whose `.gitignore` does not cover it gets a file full of credentials sitting
 * in `git status`, where the agent is as free to commit it as anything else.
 *
 * `check-ignore` answers by exit status — 0 ignored, 1 not — so a rejection
 * cannot simply be read as "no". Anything other than 1 is a real failure and
 * stays one. The index is consulted, which is what makes a **tracked** env file
 * answer "no" as well; that is the worse case of the two and deserves the same
 * warning.
 */
export async function isIgnored(exec: GitExec, path: string): Promise<boolean> {
  try {
    await exec(['check-ignore', '-q', '--', path])
    return true
  } catch (error) {
    if (error instanceof GitError && error.code === '1') return false
    throw error
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
 * Whether a name resolves to a branch at all — local or remote-tracking.
 *
 * A project's base branch may be either: `git worktree add` is happy to start
 * from `origin/develop`, and a fresh clone often has nothing else. The two
 * namespaces are checked explicitly rather than letting git resolve a bare
 * name, which would also match a tag.
 */
export async function anyBranchExists(exec: GitExec, branch: string): Promise<boolean> {
  if (await branchExists(exec, branch)) return true

  try {
    await exec(['rev-parse', '--verify', `refs/remotes/${branch}`])
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
