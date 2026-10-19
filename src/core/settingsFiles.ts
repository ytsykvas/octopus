/**
 * The Claude Code settings files a session reads, and reading one safely.
 *
 * Octopus speaks to a session through the flag layer, which outranks every
 * file, yet three things depend on what the files say: the permission rules
 * shown beside octopus's own (`cliPermissions.ts`), a variable in an `env`
 * block that outranks the flag layer in turn (`autoCompact.ts`), and a skill
 * octopus stops withholding, which goes back to what the files say about it
 * since the flag layer cannot unset a key (`skillsInFiles`).
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { z } from 'zod'

import type { SettingSourceName } from './config.js'
import { type SkillVisibility, SkillVisibilitySchema } from './skills.js'

/** One settings file, and how to name it to the person who has to open it. */
export interface SettingsFile {
  readonly source: SettingSourceName
  readonly path: string
  /** Relative to the checkout, or as the user's own is named. */
  readonly name: string
}

/**
 * The files a session started with these sources reads, most authoritative
 * first.
 *
 * Only those: a checkout that is not trusted contributes nothing to the
 * session, so its files cannot be what is deciding anything. The narrower file
 * wins over the wider one, as the CLI merges them.
 */
export function settingsFilesFor(
  cwd: string,
  sources: readonly SettingSourceName[],
  environment: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): SettingsFile[] {
  const files: SettingsFile[] = []
  const inCheckout = (source: SettingSourceName, relative: string): SettingsFile => ({
    source,
    path: join(cwd, relative),
    name: relative
  })

  if (sources.includes('local')) {
    files.push(inCheckout('local', join('.claude', 'settings.local.json')))
  }
  if (sources.includes('project')) {
    files.push(inCheckout('project', join('.claude', 'settings.json')))
  }
  if (sources.includes('user')) {
    files.push(userFile(environment, home))
  }

  return files
}

/**
 * Where the user's own file is.
 *
 * `CLAUDE_CONFIG_DIR` moves the whole of `~/.claude`, settings included, so a
 * file looked for under the home directory would be the wrong one — and the
 * reader is told the path they have to open.
 */
function userFile(environment: NodeJS.ProcessEnv, home: string): SettingsFile {
  const configured = environment.CLAUDE_CONFIG_DIR
  if (configured !== undefined && configured !== '') {
    const path = join(configured, 'settings.json')
    return { source: 'user', path, name: path }
  }

  const relative = join('.claude', 'settings.json')
  return { source: 'user', path: join(home, relative), name: `~/${relative}` }
}

/** How much of one file is read, so a large one cannot hold anything up. */
const MAX_BYTES = 256 * 1024

/**
 * One settings file as JSON, or null when it says nothing.
 *
 * A file that is missing, unreadable, too large or not JSON says nothing —
 * half-written JSON in a checkout is ordinary. Each reader checks the part it
 * wants with a schema of its own, `looseObject` because these files are
 * somebody else's and carry many keys octopus has no business with.
 */
export async function readSettingsFile(path: string): Promise<unknown> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return null
  }

  if (raw.length > MAX_BYTES) return null

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const SkillsSchema = z.looseObject({
  skillOverrides: z.record(z.string(), z.unknown()).optional()
})

/**
 * What the files a session reads say about each skill they name.
 *
 * Merged key by key, the narrower file winning, as the CLI merges them. A
 * value that is not one of the four is passed over, so the wider file's
 * answer for that key stands.
 */
export async function skillsInFiles(
  cwd: string,
  sources: readonly SettingSourceName[],
  environment: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): Promise<Map<string, SkillVisibility>> {
  // A map rather than an object: a skill may be called `constructor`.
  const answer = new Map<string, SkillVisibility>()

  for (const file of settingsFilesFor(cwd, sources, environment, home)) {
    const settings = SkillsSchema.safeParse(await readSettingsFile(file.path))
    const overrides = settings.success ? (settings.data.skillOverrides ?? {}) : {}
    for (const [key, value] of Object.entries(overrides)) {
      const visibility = SkillVisibilitySchema.safeParse(value)
      if (visibility.success && !answer.has(key)) answer.set(key, visibility.data)
    }
  }

  return answer
}
