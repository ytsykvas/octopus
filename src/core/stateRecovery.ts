/**
 * Offering `state.json` back from its backup when it cannot be read (§13).
 *
 * Reading the state fails loudly on a damaged file rather than starting empty, and
 * that is right — but it left the app unable to start with nothing to offer except
 * editing JSON by hand. `saveState` keeps the version before each save as
 * `state.json.bak`; this decides whether that copy can be offered, and restores it.
 *
 * Never silently. `main` asks, and only an explicit yes restores — a backup is a
 * save behind, so whatever the last save recorded is lost with the damaged file.
 * The decisions live here rather than in `main/index.ts`, which tests cannot reach.
 */

import { constants, copyFile, readFile, stat } from 'node:fs/promises'

import { backupFileOf, stateFile } from './paths.js'
import { InvalidFileError, readJsonFile, writeTextFile } from './persist.js'
import { StateSchema } from './store.js'

/** What can be offered when the state cannot be read. */
export type StateRecovery =
  | { readonly kind: 'none' }
  | { readonly kind: 'backup'; readonly savedAt: Date; readonly projects: number }

const NONE: StateRecovery = { kind: 'none' }

/** Whether the backup reads as a state, with what the question needs to say about it. */
export async function inspectStateBackup(backupPath: string): Promise<StateRecovery> {
  try {
    const stored = await readJsonFile(backupPath, StateSchema.nullable(), null)
    if (stored === null) return NONE
    const { mtime } = await stat(backupPath)
    return { kind: 'backup', savedAt: mtime, projects: stored.projects.length }
  } catch {
    // Damaged too, or unreadable: nothing worth offering, and the start fails as before.
    return NONE
  }
}

/** What to offer for a failure to start: only a damaged state, and only with a good backup. */
export async function recoveryFor(
  error: unknown,
  statePath: string = stateFile(),
  backupPath: string = backupFileOf(statePath)
): Promise<StateRecovery> {
  if (!(error instanceof InvalidFileError) || error.filePath !== statePath) return NONE
  return inspectStateBackup(backupPath)
}

/**
 * Puts the backup in place of the state, keeping the damaged file beside it.
 *
 * Copied aside rather than renamed: until the backup has landed, `state.json` stays
 * where it is, damaged. A rename first would leave a moment with no file at all,
 * and a start in that moment reads "first run" — the silent reset this exists to
 * avoid. Answers where the damaged file was kept.
 */
export async function restoreStateBackup(
  statePath: string,
  backupPath: string,
  now: () => Date = () => new Date()
): Promise<string> {
  const contents = await readFile(backupPath, 'utf8')
  const kept = `${statePath}.broken-${now().toISOString().replaceAll(':', '-')}`
  await copyFile(statePath, kept, constants.COPYFILE_EXCL)
  await writeTextFile(statePath, contents)
  return kept
}
