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

import { z } from 'zod'

import type { SettingSourceName } from './config.js'
import { readSettingsFile, settingsFilesFor } from './settingsFiles.js'
import { parseStandingRule, type StandingPermission } from './standingPermissions.js'

/** Which file a rule came from, so the reader knows where to change it. */
export type PermissionScope = SettingSourceName

/** How a rule was answered before anybody was asked. */
export type PermissionVerdict = 'allow' | 'deny' | 'ask'

export interface CliPermission {
  readonly scope: PermissionScope
  readonly verdict: PermissionVerdict
  readonly rule: StandingPermission
  /**
   * The file it came from: relative to the checkout, or as the user's own is
   * named — under `~`, or by its full path when `CLAUDE_CONFIG_DIR` moved it.
   */
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
  // Parameters so the suite can put a home and a config directory somewhere it
  // owns, the way the account checks take their executor.
  environment: NodeJS.ProcessEnv = process.env,
  home?: string
): Promise<CliPermission[]> {
  const found: CliPermission[] = []

  /*
   * All three, whether or not the checkout is trusted: these are shown, not
   * applied, and a rule the project commits is worth seeing before trusting
   * it. Least specific first, the CLI's own order — nothing here merges them,
   * because a reader wants to know **which** file says a thing. Named as the
   * reader has to open them: relative to the checkout, under `~`, or by the
   * full path when `CLAUDE_CONFIG_DIR` moved the user's.
   */
  const files = settingsFilesFor(repoPath, ['user', 'project', 'local'], environment, home)
  for (const { source: scope, path, name: from } of files.reverse()) {
    const permissions = await settingsIn(path)
    if (permissions === null) continue

    for (const verdict of ['deny', 'ask', 'allow'] as const) {
      for (const text of permissions[verdict]) {
        const rule = parseStandingRule(text)
        if (rule) found.push({ scope, verdict, rule, from })
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
  const result = SettingsSchema.safeParse(await readSettingsFile(path))
  return result.success ? (result.data.permissions ?? null) : null
}
