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
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** One file a repository can grant itself something with. */
export interface CapabilityFile {
  /** Relative to the worktree, so the reader can find it. */
  readonly path: string
  readonly contents: string
}

/**
 * The files read, in a fixed order.
 *
 * `hooks/` is in here because settings only **name** the script. Digesting the
 * settings alone would let a repository change what actually runs while the
 * line that runs it stays put.
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

  let hooks: string[] = []
  try {
    const entries = await readdir(join(cwd, HOOKS), { withFileTypes: true })
    hooks = entries.filter((entry) => entry.isFile()).map((entry) => `${HOOKS}/${entry.name}`)
  } catch {
    // No hooks directory, which is most repositories.
  }

  const scripts = await Promise.all(hooks.map((path) => read(cwd, path)))

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
