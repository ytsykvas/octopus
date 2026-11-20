/**
 * Atomic reading and writing of validated JSON files.
 *
 * Shared by both the config and the state store, so the persistence mechanics
 * live in one place (§11.3 docs/PROJECT.md).
 *
 * The guarantee: the file on disk is either the old version or the new one,
 * never a truncated mix. Achieved by writing to a temporary file and renaming,
 * which is atomic on POSIX.
 */

import { randomBytes } from 'node:crypto'
import { copyFile, link, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { z } from 'zod'

import { CodedError } from './codedError.js'

/** The one code this class carries; its own union, like every other subclass. */
export type InvalidFileCode = 'fileUnreadable'

/**
 * A file failed validation — data on disk is corrupt or from another version.
 *
 * Coded, so the window can say it in the reader's language. It reached the
 * bridge as a bare `Error` and crossed with no code at all: the message is at
 * least a sentence, because the issues are flattened below rather than left as
 * zod's JSON, but a corrupt `state.json` still arrived as developer English
 * inside the generic frame.
 */
export class InvalidFileError extends CodedError<InvalidFileCode> {
  constructor(
    readonly filePath: string,
    readonly issues: string
  ) {
    super(
      'fileUnreadable',
      { path: filePath, issues },
      `File ${filePath} has an unexpected structure: ${issues}`
    )
    this.name = 'InvalidFileError'
  }
}

/**
 * Turns an arbitrary thrown value into a readable string.
 *
 * JavaScript allows throwing anything and `catch` yields `unknown`. This is
 * the single place that deals with that awkwardness; everything downstream
 * works with a plain string.
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Whether a filesystem failure found nothing at the path — narrowed, never cast. */
export function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/** Whether a filesystem failure ran out of room: the disk is full, or the user's quota is. */
export function isDiskFull(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOSPC' || error.code === 'EDQUOT')
  )
}

/**
 * Reads JSON and validates it against a schema.
 *
 * A missing file yields `fallback`: that is a normal first run, not an error.
 * A file that exists but is corrupt throws {@link InvalidFileError} instead of
 * silently resetting to defaults — losing state quietly is worse than failing
 * loudly (§13).
 */
export async function readJsonFile<T>(
  filePath: string,
  schema: z.ZodType<T>,
  fallback: T
): Promise<T> {
  let raw: string

  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return fallback
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new InvalidFileError(filePath, describeError(error))
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new InvalidFileError(
      filePath,
      result.error.issues.map((issue) => issue.message).join('; ')
    )
  }

  return result.data
}

function randomSuffix(): string {
  return randomBytes(6).toString('hex')
}

async function replaceThrough(
  tempPath: string,
  filePath: string,
  contents: string,
  mode?: number,
  beforeRename?: () => Promise<void>
): Promise<void> {
  // `wx` (O_EXCL) never follows a link planted at the name. Outside the try: when `open`
  // fails, EEXIST included, the path is not ours to remove.
  const handle = await open(tempPath, 'wx', mode)
  try {
    try {
      await handle.writeFile(contents, 'utf8')
      // A mode asked for goes through fchmod: the one given to open(2) is cut by the umask.
      if (mode !== undefined) await handle.chmod(mode)
      // macOS fsync(2) without F_FULLFSYNC does not flush the drive cache: accepted.
      await handle.sync()
    } finally {
      await handle.close()
    }
    await beforeRename?.()
    await rename(tempPath, filePath)
  } catch (error) {
    // Settled, not awaited bare: a cleanup that throws would replace the error reported.
    await Promise.allSettled([rm(tempPath, { force: true })])
    throw error
  }
}

// Atomic, with the mode asked for: `open(2)` ignores a mode unless it creates the file.
// `<target>.<random>.tmp` keeps the prefix `.env*` ignores, and is random because a
// repository can commit a link at any fixed name. `suffix` lets a test pick it.
export async function writeTextFile(
  filePath: string,
  contents: string,
  mode?: number,
  suffix: () => string = randomSuffix
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await replaceThrough(`${filePath}.${suffix()}.tmp`, filePath, contents, mode)
}

/**
 * Writes bytes to a path that must not exist yet — a fresh name, never a replacement.
 *
 * Nothing to make atomic: no reader knows the name before this returns. `wx` turns two
 * names colliding into a failure rather than one file silently replacing another.
 */
export async function writeNewFile(filePath: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, bytes, { flag: 'wx' })
}

/** The `code` a filesystem failure carries, narrowed — never cast. */
function codeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}

/**
 * Points `backupPath` at what `filePath` holds now; nothing to point at is a first write.
 *
 * A hard link rather than a copy: O(1) whatever the size, and once the rename puts a new
 * inode at `filePath`, the old one — already synced when it was written — lives on here.
 * A filesystem without hard links gets a copy instead.
 *
 * Made under a temporary name and renamed over the old backup, so the old one goes only as
 * the new one takes its place: a failure in between leaves the previous backup as it was.
 */
export async function keepBackup(
  filePath: string,
  backupPath: string,
  linkFile: (existing: string, created: string) => Promise<void> = link
): Promise<void> {
  const tempPath = `${backupPath}.${randomSuffix()}.tmp`
  try {
    try {
      await linkFile(filePath, tempPath)
    } catch (error) {
      if (isNotFound(error)) return
      const code = codeOf(error)
      if (code !== 'EPERM' && code !== 'ENOTSUP') throw error
      await copyFile(filePath, tempPath)
    }
    await rename(tempPath, backupPath)
  } catch (error) {
    // Settled, as in `replaceThrough`: a cleanup that throws must not replace the error.
    await Promise.allSettled([rm(tempPath, { force: true })])
    throw error
  }
}

/**
 * Writes JSON atomically.
 *
 * Validating before the write is deliberate: better to fail here than to put
 * data on disk that cannot be read back.
 *
 * With `backupPath`, the version being replaced stays there (`keepBackup`), taken after
 * the new contents are synced and before they land — a backup that fails stops the write.
 */
export async function writeJsonFile<T>(
  filePath: string,
  schema: z.ZodType<T>,
  value: T,
  tempPath = `${filePath}.tmp`,
  backupPath?: string
): Promise<void> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new InvalidFileError(
      filePath,
      result.error.issues.map((issue) => issue.message).join('; ')
    )
  }

  await mkdir(dirname(filePath), { recursive: true })
  // Fixed path, as callers serialise on it: this clears only a crash leftover or a planted
  // link, and `rm` removes a link itself, never its target.
  await rm(tempPath, { force: true })
  await replaceThrough(
    tempPath,
    filePath,
    `${JSON.stringify(result.data, null, 2)}\n`,
    undefined,
    backupPath === undefined ? undefined : () => keepBackup(filePath, backupPath)
  )
}
