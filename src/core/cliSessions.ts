/**
 * The agent CLI's own record of a workspace's conversations.
 *
 * The CLI keeps every session under `~/.claude/projects` (or
 * `$CLAUDE_CONFIG_DIR`), filed by the directory it ran in, and nothing took
 * them back: a removed workspace left its sessions for ever, and the next
 * workspace given the same name inherited them in `/resume`.
 *
 * The SDK finds and deletes them, so the CLI's naming of that folder — hashed
 * when long, overridable from the environment — stays the CLI's business.
 */

import { realpath } from 'node:fs/promises'

/**
 * The SDK's `listSessions`, narrowed. The two literals pin the flags:
 * `includeWorktrees: true`, the SDK's default, answers every worktree of the
 * repository — the other workspaces' sessions.
 */
export type ListSessionsFn = (options: {
  readonly dir: string
  readonly includeWorktrees: false
  readonly includeProgrammatic: true
}) => Promise<readonly { readonly sessionId: string; readonly cwd?: string }[]>

/** The SDK's `deleteSession`, narrowed. */
export type DeleteSessionFn = (
  sessionId: string,
  options: { readonly dir: string }
) => Promise<void>

/**
 * The sessions started in a worktree, read while it still exists.
 *
 * Only those whose `cwd` is the worktree: with CLAUDE_CODE_PROJECT_DIR_NAME set
 * the CLI files every directory's sessions in one place, and the listing then
 * answers all of them. An unreadable listing is no reason to keep a workspace,
 * so it answers none.
 */
export async function cliSessionsOf(
  path: string,
  list: ListSessionsFn,
  resolve: (path: string) => Promise<string> = realpath
): Promise<string[]> {
  try {
    const here = new Set([path, await resolve(path).catch(() => path)])
    const sessions = await list({ dir: path, includeWorktrees: false, includeProgrammatic: true })
    return sessions
      .filter((session) => session.cwd !== undefined && here.has(session.cwd))
      .map((session) => session.sessionId)
  } catch {
    return []
  }
}

/** Best-effort, like the transcripts: by now the workspace is already gone. */
export async function discardCliSessions(
  path: string,
  ids: readonly string[],
  remove: DeleteSessionFn
): Promise<void> {
  for (const id of ids) {
    await remove(id, { dir: path }).catch(() => undefined)
  }
}
