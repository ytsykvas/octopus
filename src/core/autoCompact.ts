/**
 * Where a conversation compacts itself, and who else has a say in it.
 *
 * The window a chat chooses travels in the session's flag layer, which beats
 * every settings file — `/autocompact` saved in `~/.claude/settings.json`
 * included, measured. One thing beats the flag layer:
 * `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, whether it is in the environment the
 * agent inherits or in the `env` block of a settings file the session reads.
 * Both measured too: 400k from the environment and 450k from an `env` block
 * each won over a chosen 300k.
 *
 * Nothing octopus does can outrank it, so the honest answer is to say so —
 * which variable, set where, and what it holds — rather than to let a menu
 * show a choice the agent is ignoring.
 */

import { z } from 'zod'

import { AUTO_COMPACT_VARIABLE, type AutoCompactWindow } from './chats.js'
import type { SettingSourceName } from './config.js'
import { readSettingsFile, settingsFilesFor } from './settingsFiles.js'

/** Who set the variable, so the reader knows where to take it out. */
export interface WindowOverride {
  /** The value as written: the agent reads it, not octopus, so it is not interpreted here. */
  readonly value: string
  /** The settings file whose `env` block holds it, or null for the environment itself. */
  readonly from: string | null
}

/** Only the part that sets variables. */
const EnvSchema = z.looseObject({
  env: z.record(z.string(), z.unknown()).optional()
})

/**
 * Who forces the window on a session started with these sources, or null.
 *
 * The CLI applies a file's `env` over the environment it was started with —
 * measured: 450k in an `env` block beat 400k in the environment — and the
 * narrower file over the wider one. So the first file that names the variable
 * is the one in force, and the environment speaks only when none does.
 */
export async function findWindowOverride(
  cwd: string,
  sources: readonly SettingSourceName[],
  environment: NodeJS.ProcessEnv = process.env,
  home?: string
): Promise<WindowOverride | null> {
  for (const { path, name } of settingsFilesFor(cwd, sources, environment, home)) {
    const settings = EnvSchema.safeParse(await readSettingsFile(path))
    const value = settings.success ? variableIn(settings.data.env?.[AUTO_COMPACT_VARIABLE]) : null
    if (value !== null) return { value, from: name }
  }

  const value = environment[AUTO_COMPACT_VARIABLE]
  return value === undefined || value === '' ? null : { value, from: null }
}

/**
 * The variable as one `env` block sets it, or null.
 *
 * A number is accepted as the CLI would take it; anything else is not a
 * setting the agent would act on.
 */
function variableIn(value: unknown): string | null {
  if (typeof value === 'number') return String(value)
  return typeof value === 'string' && value !== '' ? value : null
}

/** Where a conversation compacts, as the menu draws it. */
export interface AutoCompactView {
  /** What this conversation asked for; null for the agent's own. */
  readonly chosen: AutoCompactWindow | null
  /** The window the running session measures against, in tokens. */
  readonly effective: number
  /** How much the model holds, or null until a turn has said. */
  readonly modelWindow: number | null
  /** The variable outranking the choice, when one does. */
  readonly override: WindowOverride | null
  /**
   * The choice has not reached the session yet: it was made while the agent
   * was working, and the session starts again once the turn ends.
   */
  readonly pending: boolean
}
