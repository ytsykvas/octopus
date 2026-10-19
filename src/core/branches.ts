/**
 * Branch names as a person reads them, and the prefix as git will take it.
 *
 * Kept free of Node dependencies so the renderer can import it as a value.
 * The obvious home would be `git.ts`, but that module reaches
 * `node:child_process`, and importing a value from it puts Node in the window.
 */

import { z } from 'zod'

/** Remote every clone has; the only prefix worth hiding by default. */
const DEFAULT_REMOTE_PREFIX = 'origin/'

/**
 * Drops the remote prefix.
 *
 * For display: every entry in a branch list carries the same `origin/`, so it
 * says nothing while pushing the part that differs off the end of a narrow
 * pane.
 *
 * And for `gh`, which is the same transformation for a different reason.
 * `origin/develop` is a local name for a remote-tracking ref; the branch on
 * GitHub is `develop`, and a request opened against the longer name is
 * refused with "Base ref must be a branch".
 *
 * Only `origin/` goes, not any first segment: a repository with no remote
 * falls back to local branches, and `feature/x` must not be shown — or sent —
 * as `x`.
 */
export function shortBranchName(branch: string): string {
  return branch.startsWith(DEFAULT_REMOTE_PREFIX)
    ? branch.slice(DEFAULT_REMOTE_PREFIX.length)
    : branch
}

/** What a new install names its branches after, and the fallback for a prefix with nothing usable in it. */
export const DEFAULT_BRANCH_PREFIX = 'octopus'

/**
 * A branch prefix as git will take it.
 *
 * Every workspace branch is `<prefix>/<name>`, and the prefix is typed by a
 * person — `ytsykvas/`, the way the branch reads on GitHub, gave
 * `ytsykvas//magda` and every "New workspace" failed with git's own words.
 * So the slashes around it and the empty parts inside go, each part is
 * trimmed, and each is made a component git accepts (`git check-ref-format`):
 * no control characters, spaces or `~^:?*[\`, no `@{`, no `..`, nothing
 * starting with `.` or `-`, nothing ending with `.lock`. Unlike a workspace
 * name it keeps its case — a username is spelled the way its owner spells it.
 * Empty when nothing usable was typed.
 *
 * A dot at the end of a part stays: git refuses one only at the end of the
 * whole name, and the prefix is always followed by `/<name>`. Stripping it
 * anyway turned `x.lock.` into `x.lock`, which git refuses.
 */
export function cleanBranchPrefix(value: string): string {
  return value
    .split('/')
    .map((part) => cleanComponent(part.trim()))
    .filter((part) => part !== '')
    .join('/')
}

function cleanComponent(part: string): string {
  return (
    part
      // eslint-disable-next-line no-control-regex -- control characters are exactly what git rejects
      .replace(/[\u0000-\u001f\u007f\s~^:?*[\\]+/g, '-')
      .replace(/@\{/g, '-')
      .replace(/\.{2,}/g, '.')
      .replace(/^[-.]+/, '')
      .replace(/(\.lock)+$/, '')
  )
}

/**
 * A stored branch prefix, cleaned on every read and write rather than refused.
 *
 * The config's and every project's: a file stored before the prefix was
 * checked must still open, and a project copies the prefix when it is added,
 * so one with a slash too many kept failing after the setting was put right.
 * An empty one is still refused, as it always was — so no file holds one, and
 * a write of nothing is a caller's mistake rather than something to forgive.
 */
export const BranchPrefixSchema = z
  .string()
  .min(1)
  .transform((value) => cleanBranchPrefix(value) || DEFAULT_BRANCH_PREFIX)
