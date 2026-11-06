/**
 * Atomic reading and writing of validated JSON files.
 *
 * Shared by both the config and the state store, so the persistence mechanics
 * live in one place (§11.3 docs/PROJECT.md).
 *
 * The guarantee: the file on disk is either the old version or the new one,
 * never a truncated mix. Three things hold it together. The temporary file is
 * created exclusively (`O_EXCL`), so the write cannot be redirected through a
 * link planted at its name. Its contents are `fsync`ed before the rename, so
 * after a power cut the new name does not point at an empty file. And the
 * rename itself is atomic on POSIX.
 *
 * One caveat, accepted: on macOS `fsync(2)` without `F_FULLFSYNC` orders the
 * write before the rename but does not force the drive to empty its cache, and
 * the directory is not synced after the rename.
 */

import { randomBytes } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
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

/** What `writeFile` creates a file with when nobody asks; the umask still applies. */
const DEFAULT_MODE = 0o666

function randomSuffix(): string {
  return randomBytes(6).toString('hex')
}

/**
 * Where a write keeps its contents until the rename: `<target>.<random>.tmp`.
 *
 * The `<target>.` prefix is kept so a `.gitignore` pattern such as `.env*`
 * still covers a file a crash left behind.
 */
export function temporarySibling(filePath: string, suffix: () => string = randomSuffix): string {
  return `${filePath}.${suffix()}.tmp`
}

/**
 * Puts `contents` at `filePath` by way of a temporary file this call creates.
 *
 * `wx` is `O_CREAT | O_EXCL`: it never follows a symbolic link and fails with
 * `EEXIST` on a path that already exists, so the bytes can only reach a file
 * made here. The mode is set with `fchmod` on the descriptor — a path could be
 * swapped for a link, and the mode given to `open(2)` loses whatever bits the
 * umask clears. `fsync` comes before the rename so the new name never points at
 * contents still sitting in memory.
 */
async function replaceThrough(
  tempPath: string,
  filePath: string,
  contents: string,
  mode: number | undefined
): Promise<void> {
  // Outside the try: when `open` fails, EEXIST included, the path is not ours
  // to remove.
  const handle = await open(tempPath, 'wx', mode ?? DEFAULT_MODE)
  try {
    try {
      await handle.writeFile(contents, 'utf8')
      if (mode !== undefined) await handle.chmod(mode)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

/**
 * Writes a text file atomically, and with the mode it is asked for.
 *
 * The mode is applied to the temporary file, not left to the target: `open(2)`
 * ignores a mode **unless the call creates the file**, so appending credentials
 * to a file copied in from somewhere else used to leave it as permissive as the
 * copy was. Renaming the temporary file over the target carries the mode with
 * it, whatever the target had before.
 *
 * The temporary file is a sibling of the target because `rename` is only atomic
 * within a filesystem, and across some it fails outright. Its name is random
 * because these land in a git worktree, and a repository can commit a symbolic
 * link at any fixed name — `.env.tmp` pointed at `~/.zshrc` once sent the env
 * block there. Should something already sit at the name, the write fails with
 * `EEXIST` and leaves it alone; `suffix` exists so a test can pick that name.
 *
 * A failed write takes its temporary file with it. That matters here more than
 * for JSON: a leftover in a worktree is an untracked file somebody has to
 * explain.
 */
export async function writeTextFile(
  filePath: string,
  contents: string,
  mode?: number,
  suffix: () => string = randomSuffix
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await replaceThrough(temporarySibling(filePath, suffix), filePath, contents, mode)
}

/**
 * Writes JSON atomically.
 *
 * Validating before the write is deliberate: better to fail here than to put
 * data on disk that cannot be read back.
 *
 * The temporary path is fixed, unlike {@link writeTextFile}'s: callers
 * serialise their writes on it, and these files live in the data root, not in
 * a repository. Whatever a crash left there — a file, or a link — is removed
 * first; `rm` takes the entry itself, never what a link points at. The
 * exclusive create that follows then holds the same guarantee as for text.
 */
export async function writeJsonFile<T>(
  filePath: string,
  schema: z.ZodType<T>,
  value: T,
  tempPath = `${filePath}.tmp`
): Promise<void> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new InvalidFileError(
      filePath,
      result.error.issues.map((issue) => issue.message).join('; ')
    )
  }

  await mkdir(dirname(filePath), { recursive: true })
  await rm(tempPath, { force: true })
  await replaceThrough(tempPath, filePath, `${JSON.stringify(result.data, null, 2)}\n`, undefined)
}
