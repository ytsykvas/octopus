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

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
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

function isNotFound(error: unknown): boolean {
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

/**
 * Writes a text file atomically, and with the mode it is asked for.
 *
 * The mode is set with `chmod` rather than left to `writeFile`'s option, which
 * is the whole reason this exists. Node passes that option to `open(2)`, where
 * it is **ignored unless the call creates the file** — so appending credentials
 * to a file that was copied in from somewhere else left it as permissive as the
 * copy was. Renaming the temporary file over the target carries the mode with
 * it, whatever the target had before.
 *
 * The temporary file is a sibling of the target because `rename` is only atomic
 * within a filesystem, and across some it fails outright.
 *
 * A failed write takes its temporary file with it. That matters here more than
 * for JSON: these land in a git worktree, where a leftover `.env.tmp` is an
 * untracked file somebody has to explain.
 */
export async function writeTextFile(
  filePath: string,
  contents: string,
  mode?: number
): Promise<void> {
  const tempPath = `${filePath}.tmp`

  await mkdir(dirname(filePath), { recursive: true })

  try {
    // The mode twice, and both are needed. On the write it is what stops the
    // contents existing at the default mode even for the length of the write;
    // `chmod` is what applies it to a temporary file left behind by an earlier
    // failure, which `open(2)` would not.
    await writeFile(tempPath, contents, mode === undefined ? 'utf8' : { encoding: 'utf8', mode })
    if (mode !== undefined) await chmod(tempPath, mode)
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

/**
 * Writes JSON atomically.
 *
 * Validating before the write is deliberate: better to fail here than to put
 * data on disk that cannot be read back.
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
  await writeFile(tempPath, `${JSON.stringify(result.data, null, 2)}\n`, 'utf8')
  await rename(tempPath, filePath)
}
