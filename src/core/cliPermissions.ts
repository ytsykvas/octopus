/**
 * What Claude Code's own settings say a session may and may not do.
 *
 * octopus keeps its "always allow" answers in its own config, where they can be
 * shown and taken back (`standingPermissions.ts`). The CLI keeps its answers
 * somewhere else entirely, and the flow between the two runs one way: a rule in
 * these files is honoured — the SDK approves a matching call before
 * `canUseTool` is consulted — while octopus could neither see it nor say it was
 * there. So a question that stopped being asked had no explanation anywhere in
 * the interface.
 *
 * **Read, never written.** Two of these three files are inside the checkout,
 * and `.claude/settings.local.json` is one of `repoTrust.ts`'s own list: writing
 * to it changes the worktree's trust digest and puts the project back to
 * unapproved, which narrows `settingSources` and empties the skill listing with
 * it. Showing what is there is the honest half; editing it belongs to the
 * editor that owns the file.
 *
 * Measured rather than assumed. On this machine `~/.claude/settings.json`
 * carries only a `defaultMode`, `.claude/settings.local.json` carries no
 * permissions at all, and the substantial lists — thirteen allows and four
 * denies — are in the checkout's **committed** `.claude/settings.json`. The
 * note that asked for this expected them in the local file, so all three are
 * read and each rule says which one it came from.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { z } from 'zod'

import { parseStandingRule, type StandingPermission } from './standingPermissions.js'

/**
 * Where the CLI keeps them, least specific first.
 *
 * The order is the CLI's own: the user's file is the base, the checkout's
 * committed settings are the project's word, and the local file is this
 * machine's. Nothing here merges them — a reader wants to know **which** file
 * says a thing, and the merged answer hides exactly that.
 */
const FILES = [
  { scope: 'user' as const, relative: join('.claude', 'settings.json') },
  { scope: 'project' as const, relative: join('.claude', 'settings.json') },
  { scope: 'local' as const, relative: join('.claude', 'settings.local.json') }
]

/** Which file a rule came from, so the reader knows where to change it. */
export type PermissionScope = 'user' | 'project' | 'local'

/** How a rule was answered before anybody was asked. */
export type PermissionVerdict = 'allow' | 'deny' | 'ask'

export interface CliPermission {
  readonly scope: PermissionScope
  readonly verdict: PermissionVerdict
  readonly rule: StandingPermission
  /** The file it came from, relative to the checkout or `~` for the user's. */
  readonly from: string
}

/**
 * Only the part that answers questions.
 *
 * `looseObject` for the same reason the usage reader uses one: these files are
 * somebody else's, they carry a dozen keys octopus has no business knowing
 * about, and a key added upstream must not stop the rest being read.
 */
const SettingsSchema = z.looseObject({
  permissions: z
    .looseObject({
      allow: z.array(z.string()).default([]),
      deny: z.array(z.string()).default([]),
      ask: z.array(z.string()).default([])
    })
    .optional()
})

/** How much of one file is read, so a large one cannot hold a dialog up. */
const MAX_BYTES = 256 * 1024

/**
 * Every permission rule the three files hold, in the order they are read.
 *
 * A file that is missing, unreadable, too large or not the shape it should be
 * contributes nothing: this is a courtesy beside an interface that works
 * without it, and half-written JSON in a checkout is ordinary rather than
 * exotic — the same reasoning `cleanupFor` gives for swallowing the same
 * failure.
 */
export async function readCliPermissions(
  repoPath: string,
  // A parameter so the suite can put a home somewhere it owns, the way the
  // account checks take their executor.
  home: string = homedir()
): Promise<CliPermission[]> {
  const found: CliPermission[] = []

  for (const file of FILES) {
    const user = file.scope === 'user'
    const permissions = await settingsIn(join(user ? home : repoPath, file.relative))
    if (permissions === null) continue

    // Relative to the checkout, or under `~`, because that is where the reader
    // has to go to change it.
    const from = user ? `~/${file.relative}` : file.relative

    for (const verdict of ['deny', 'ask', 'allow'] as const) {
      for (const text of permissions[verdict]) {
        const rule = parseStandingRule(text)
        if (rule) found.push({ scope: file.scope, verdict, rule, from })
      }
    }
  }

  return found
}

/** What one file lists, or null for anything short of a clear answer. */
interface Listed {
  readonly allow: readonly string[]
  readonly deny: readonly string[]
  readonly ask: readonly string[]
}

/** The permissions of one file, or null for anything short of a clear answer. */
async function settingsIn(path: string): Promise<Listed | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return null
  }

  if (raw.length > MAX_BYTES) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const result = SettingsSchema.safeParse(parsed)
  return result.success ? (result.data.permissions ?? null) : null
}
