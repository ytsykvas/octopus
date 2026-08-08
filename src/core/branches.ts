/**
 * Branch names as a person reads them.
 *
 * Kept free of Node dependencies so the renderer can import it as a value.
 * The obvious home would be `git.ts`, but that module reaches
 * `node:child_process`, and importing a value from it puts Node in the window.
 */

/** Remote every clone has; the only prefix worth hiding by default. */
const DEFAULT_REMOTE_PREFIX = 'origin/'

/**
 * Drops the remote prefix for display.
 *
 * Every entry in a branch list carries the same `origin/`, so it says nothing
 * while pushing the part that differs off the end of a narrow pane.
 *
 * Only `origin/` goes, not any first segment: a repository with no remote
 * falls back to local branches, and `feature/x` must not be shown as `x`.
 */
export function shortBranchName(branch: string): string {
  return branch.startsWith(DEFAULT_REMOTE_PREFIX)
    ? branch.slice(DEFAULT_REMOTE_PREFIX.length)
    : branch
}
