/**
 * When the CLI last fetched the account's usage, as it wrote it down.
 *
 * The CLI keeps a copy of its last successful answer in its own config file and
 * falls back to it when the account's endpoint refuses a request — silently, so
 * the answer the SDK hands back can be an hour old and says nothing of it. This
 * is the one place that moment can be read, and it is read, never written: the
 * file belongs to the CLI.
 *
 * Undocumented, and treated as such. A file that is missing, unreadable or
 * shaped differently answers `null`, which the caller reads as "cannot say" and
 * draws nothing for. Nothing here is allowed to fail a usage read: a gauge's
 * footnote is not a reason to lose the gauge.
 *
 * `CLAUDE_CONFIG_DIR` moves the file, as it moves everything else of the CLI's,
 * so it is honoured; the directory is a parameter for the reason `paths.ts`
 * gives, and the default is only ever reached outside a test.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { z } from 'zod'

const ConfigSchema = z.looseObject({
  cachedUsageUtilization: z.looseObject({ fetchedAtMs: z.number() }).optional()
})

export function cliConfigDir(
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir()
): string {
  const configured = env.CLAUDE_CONFIG_DIR
  return configured !== undefined && configured !== '' ? configured : home
}

/** The moment, in epoch milliseconds, or null when the file cannot say. */
export async function readCachedUsageAt(dir: string = cliConfigDir()): Promise<number | null> {
  try {
    const parsed = ConfigSchema.safeParse(
      JSON.parse(await readFile(join(dir, '.claude.json'), 'utf8')) as unknown
    )
    return parsed.success ? (parsed.data.cachedUsageUtilization?.fetchedAtMs ?? null) : null
  } catch {
    return null
  }
}
