/**
 * The part of a carried `.claude/settings.local.json` the settings digest
 * leaves out: its allow rules.
 *
 * The file is gitignored, so carrying it is the only way a workspace gets it —
 * and the Claude CLI adds to its `permissions.allow` on every "always allow".
 * Each new worktree then had different contents, a different digest and the
 * trust banner again, for a file that is the user's own and not the
 * repository's.
 *
 * Only the allow rules, and only this file. Its hooks, MCP servers, the rest
 * of its permissions and every other key stay in the digest, so an agent
 * writing a hook or a `defaultMode` into the user's file is asked about like
 * anyone else; a carried `.mcp.json` or `settings.json` counts whole.
 *
 * Every condition below closes one way for the repository's own content to
 * escape the gate through this door, so the file is narrowed only when **all**
 * of them hold. Anything unknown — git failing in a way it does not normally
 * fail, contents that are not a JSON object — keeps it whole.
 */

import { basename, dirname, join } from 'node:path'

import { type CarriedFile, carrySource, sameFile } from './carry.js'
import { GitError, type GitExec, type GitOptions } from './git.js'
import { unlinkedInside } from './paths.js'
import type { CapabilityFile } from './repoTrust.js'

const LOCAL_SETTINGS = join('.claude', 'settings.local.json')

export interface CarriedCheck {
  /** The directory the digest is taken in — usually a worktree. */
  readonly cwd: string
  /** The project's checkout, where a carry line with no source reads from. */
  readonly repoPath: string
  /** What was carried into `cwd`, as `carriedIn` resolves it. */
  readonly carried: readonly CarriedFile[]
  readonly execIn: (cwd: string, options?: GitOptions) => GitExec
}

/**
 * Whether git tracks `path` in the repository `cwd` belongs to.
 *
 * `literal`, because a carried name with `*` in it must not match a tracked
 * file beside it; `icase`, because git compares pathspecs by case even where
 * the disk does not, and a committed `.Claude/settings.local.json` is the file
 * macOS reads for `.claude/settings.local.json`. The global
 * `--literal-pathspecs` cannot be combined with `--icase-pathspecs`, so the
 * two are magic on the one pathspec.
 *
 * Outside any repository nothing is tracked, which counts only where the
 * caller says it may: the worktree and the checkout always are repositories,
 * and one that is not has gone wrong. English, so the answer can be read.
 * Every other failure answers "tracked", which keeps the file in the digest.
 */
async function tracked(
  execIn: CarriedCheck['execIn'],
  cwd: string,
  path: string,
  outsideRepository: 'untracked' | 'unknown'
): Promise<boolean> {
  try {
    const exec = execIn(cwd, { env: { LC_ALL: 'C' } })
    return (await exec(['ls-files', '-z', '--', `:(literal,icase)${path}`])) !== ''
  } catch (error) {
    const loose = error instanceof GitError && error.stderr.includes('not a git repository')
    return !(loose && outsideRepository === 'untracked')
  }
}

async function isUsersOwn(file: CapabilityFile, check: CarriedCheck): Promise<boolean> {
  if (file.path !== LOCAL_SETTINGS) return false

  const line = check.carried.find(({ path }) => sameFile(path) === sameFile(file.path))
  if (line === undefined) return false

  // `carryInto` refuses to write under a link, so a file reached through one —
  // a committed `.claude -> vendor/c` included, which git does not list beyond
  // — was not carried.
  if (!(await unlinkedInside(check.cwd, file.path))) return false
  // Asked from the file's own folder, as the source is below: a `.claude` that
  // is a submodule answers in its own repository, which tracks the file, where
  // the outer one sees only the link to it.
  const own = join(check.cwd, file.path)
  if (await tracked(check.execIn, dirname(own), basename(own), 'unknown')) return false

  // A checkout on a branch that commits the file would otherwise hand it over
  // untracked — the repository's hooks, carried in as the user's. A source
  // named on the line may sit outside any repository.
  const source = carrySource(line, check.repoPath)
  const outside = line.from === null ? 'unknown' : 'untracked'
  return !(await tracked(check.execIn, dirname(source), basename(source), outside))
}

/** A JSON object, as opposed to an array, a string or nothing. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The file without `permissions.allow`: null when nothing else is in it, and
 * undefined when it is not an object to take the rules out of.
 *
 * `allow` alone, because that is what "always allow" writes. `defaultMode`,
 * `additionalDirectories`, `deny` and anything else under `permissions` are
 * not rewritten behind anybody's back, so a change to them is still asked
 * about. What is left is shown as well as digested, so the card says exactly
 * what is being approved.
 */
function withoutAllowRules(contents: string): string | null | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined

  const { permissions } = parsed
  const narrowed = Object.fromEntries(
    Object.entries(parsed).flatMap(([key, value]): [string, unknown][] => {
      if (key !== 'permissions' || !isRecord(permissions)) return [[key, value]]

      const kept = Object.entries(permissions).filter(([name]) => name !== 'allow')
      return kept.length === 0 ? [] : [[key, Object.fromEntries(kept)]]
    })
  )

  return Object.keys(narrowed).length === 0 ? null : JSON.stringify(narrowed, null, 2)
}

/** The capability files, the user's carried local settings narrowed. */
export async function narrowCarried(
  files: readonly CapabilityFile[],
  check: CarriedCheck
): Promise<CapabilityFile[]> {
  const narrowed = await Promise.all(
    files.map(async (file) => {
      if (!(await isUsersOwn(file, check))) return file

      const contents = withoutAllowRules(file.contents)
      if (contents === undefined) return file
      return contents === null ? null : { ...file, contents }
    })
  )

  return narrowed.filter((file): file is CapabilityFile => file !== null)
}
