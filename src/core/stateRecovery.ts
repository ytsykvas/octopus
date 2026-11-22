/**
 * Offering `state.json` back from its backup when it cannot be read (§13).
 *
 * A damaged state fails the start loudly rather than starting empty; without a
 * backup the only way on is editing JSON by hand. `saveState` keeps the version
 * before each save as `state.json.bak`, and this offers it — never silently, since a
 * backup is a save behind. The decisions live here rather than in `main/index.ts`,
 * which tests cannot reach.
 */

import { constants, copyFile, readFile, stat } from 'node:fs/promises'

import { backupFileOf, fileStamp } from './paths.js'
import { describeError, InvalidFileError, readJsonFile, writeTextFile } from './persist.js'
import { StateSchema } from './store.js'

/** A backup worth offering, with what the question needs to say about it. */
export interface BackupRecovery {
  readonly savedAt: Date
  readonly projects: number
}

/** Whether the backup reads as a state; null when there is nothing worth offering. */
export async function inspectStateBackup(backupPath: string): Promise<BackupRecovery | null> {
  try {
    const stored = await readJsonFile(backupPath, StateSchema.nullable(), null)
    if (stored === null) return null
    const { mtime } = await stat(backupPath)
    return { savedAt: mtime, projects: stored.projects.length }
  } catch {
    // Damaged too, or unreadable: the start fails with the original error.
    return null
  }
}

/** What to offer for a failure to start: only a damaged state, and only with a good backup. */
export async function recoveryFor(
  error: unknown,
  statePath: string
): Promise<BackupRecovery | null> {
  if (!(error instanceof InvalidFileError) || error.filePath !== statePath) return null
  return inspectStateBackup(backupFileOf(statePath))
}

/**
 * Puts the backup in place of the state, keeping the damaged file beside it.
 *
 * Copied aside rather than renamed: until the backup has landed, `state.json` stays
 * where it is, damaged. A rename first would leave a moment with no file at all,
 * and a start in that moment reads "first run" — the silent reset this exists to
 * avoid.
 */
export async function restoreStateBackup(
  statePath: string,
  now: () => Date = () => new Date()
): Promise<void> {
  const contents = await readFile(backupFileOf(statePath), 'utf8')
  const kept = `${statePath}.broken-${fileStamp(now())}`
  await copyFile(statePath, kept, constants.COPYFILE_EXCL)
  await writeTextFile(statePath, contents)
}

/** Opens with `open`; a damaged state with a good backup is restored only if `ask` says yes. Null when it says no. */
export async function openWithRecovery<T>(
  open: () => Promise<T>,
  ask: (recovery: BackupRecovery, error: unknown) => boolean,
  statePath: string
): Promise<T | null> {
  try {
    return await open()
  } catch (error) {
    const recovery = await recoveryFor(error, statePath)
    if (recovery === null) throw error
    if (!ask(recovery, error)) return null
    try {
      await restoreStateBackup(statePath)
    } catch (restoreError) {
      throw new Error(
        `${describeError(error)}\n\nRestoring the backup failed as well: ${describeError(restoreError)}`,
        { cause: restoreError }
      )
    }
    return await open()
  }
}
