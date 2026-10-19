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

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { z } from 'zod'

import { AUTO_COMPACT_VARIABLE, type AutoCompactWindow } from './chats.js'
import type { SettingSourceName } from './config.js'

/** Who set the variable, so the reader knows where to take it out. */
export interface WindowOverride {
  /** The value as written: the agent reads it, not octopus, so it is not interpreted here. */
  readonly value: string
  /** The settings file whose `env` block holds it, or null for the environment itself. */
  readonly from: string | null
}

/**
 * The files that can carry an `env` block, most authoritative first.
 *
 * The CLI applies a file's `env` over the environment it was started with —
 * measured: 450k in an `env` block beat 400k in the environment — and the
 * narrower file over the wider one. So the first that names the variable is
 * the one in force, and the environment speaks only when none does.
 */
const FILES: readonly { readonly source: SettingSourceName; readonly relative: string }[] = [
  { source: 'local', relative: join('.claude', 'settings.local.json') },
  { source: 'project', relative: join('.claude', 'settings.json') },
  { source: 'user', relative: join('.claude', 'settings.json') }
]

/**
 * Where the user's own file is, and how to name it to its reader.
 *
 * `CLAUDE_CONFIG_DIR` moves the whole of `~/.claude`, settings included, so a
 * file looked for under the home directory would be the wrong one — and the
 * reader is told the path they have to open.
 */
function userFile(
  environment: NodeJS.ProcessEnv,
  home: string
): { readonly path: string; readonly name: string } {
  const configured = environment.CLAUDE_CONFIG_DIR
  if (configured !== undefined && configured !== '') {
    const path = join(configured, 'settings.json')
    return { path, name: path }
  }

  const relative = join('.claude', 'settings.json')
  return { path: join(home, relative), name: `~/${relative}` }
}

/**
 * Only the part that sets variables.
 *
 * `looseObject` because these files are somebody else's and carry many keys
 * octopus has no business with; one added upstream must not stop this read.
 */
const SettingsSchema = z.looseObject({
  env: z.record(z.string(), z.unknown()).optional()
})

/** How much of one file is read, so a large one cannot hold the menu up. */
const MAX_BYTES = 256 * 1024

/**
 * Who forces the window on a session started with these sources, or null.
 *
 * Only the files the session actually reads are asked: a checkout that is not
 * trusted contributes nothing to the session, so its `env` cannot be what is
 * overriding anything. A file that is missing, unreadable, too large or not
 * JSON says nothing — half-written JSON in a checkout is ordinary.
 */
export async function findWindowOverride(
  cwd: string,
  sources: readonly SettingSourceName[],
  environment: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): Promise<WindowOverride | null> {
  for (const file of FILES) {
    if (!sources.includes(file.source)) continue

    // Relative to the checkout, or as the user's own is named, because that is
    // where the reader has to go to take it out.
    const { path, name } =
      file.source === 'user'
        ? userFile(environment, home)
        : { path: join(cwd, file.relative), name: file.relative }
    const value = await variableIn(path)
    if (value !== null) return { value, from: name }
  }

  const value = environment[AUTO_COMPACT_VARIABLE]
  return value === undefined || value === '' ? null : { value, from: null }
}

/** The variable as one file's `env` block sets it, or null. */
async function variableIn(path: string): Promise<string | null> {
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

  const settings = SettingsSchema.safeParse(parsed)
  if (!settings.success) return null

  const value = settings.data.env?.[AUTO_COMPACT_VARIABLE]
  // A number is accepted as the CLI would take it; anything else is not a
  // setting the agent would act on.
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
  /**
   * A session started over to shed this very reading has read it again, so
   * choosing the same window once more would only do the same: the stray is
   * one no new session can clear.
   */
  readonly settled: boolean
}
