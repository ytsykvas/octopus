/**
 * What `git diff --name-status` says, and the flags every diff runs with.
 *
 * Apart from `diff.ts` because the Files tab's tree reads it too, and
 * `fileTree.ts` is a module the window imports values from; `diff.ts` reaches
 * `node:fs`.
 */

import type { FileStatus } from './diff.js'

/**
 * Options every diff invocation carries, and what each one prevents.
 *
 * `--no-ext-diff` and `--no-textconv`: a `diff.external` or a textconv filter
 * in the user's config would replace git's output with another program's, and
 * run that program. `--no-color`: `color.ui = always` otherwise puts ANSI
 * escapes through the parser. `--find-renames`: a moved file is one entry
 * rather than a deletion beside an addition.
 */
export const DIFF_FLAGS = [
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--find-renames',
  // Pinned, because `diff.mnemonicPrefix` in a user's config renames these to
  // `c/` and `w/`. Every path would then fail to match the listing it is paired
  // with, and every file in the pane would draw empty — a total failure with
  // nothing on screen to say why.
  '--src-prefix=a/',
  '--dst-prefix=b/'
] as const

/**
 * Paths arrive raw rather than octal-escaped.
 *
 * `-z` covers the machine-readable outputs, but the unified diff has no such
 * option, and without this a Cyrillic filename reaches the parser as `\320\243`.
 */
export const RAW_PATHS = ['-c', 'core.quotePath=false'] as const

/*
 * A read from inside a walk that has already checked its bounds.
 *
 * `noUncheckedIndexedAccess` types every indexed read as possibly absent, and
 * one place saying what absence means beats a guard at each read. Ignored for
 * coverage rather than tested: no input reaches the fallback, and a test that
 * pretended otherwise would assert against a state the walk cannot be in.
 */
/* v8 ignore next 2 */
const at = (values: readonly string[], index: number): string => values[index] ?? ''

/** One file's status as `--name-status` reports it. */
export interface NameStatusEntry {
  readonly path: string
  readonly oldPath: string | null
  readonly status: FileStatus
}

const STATUS_LETTERS: Readonly<Record<string, FileStatus>> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typeChanged'
}

/**
 * Parses `git diff --name-status -z`.
 *
 * The status is its own NUL-terminated field, so `R100` and `M` are read the
 * same way; `R` and `C` carry a similarity score and are followed by two paths
 * rather than one.
 */
export function parseNameStatus(output: string): NameStatusEntry[] {
  const fields = output.split('\0').filter((field) => field !== '')
  const entries: NameStatusEntry[] = []

  for (let index = 0; index < fields.length; index++) {
    const letter = at(fields, index).charAt(0)
    // A letter we do not know still consumes its path. `U` for an unmerged file
    // is the one that occurs, and skipping the record would leave the walk one
    // field out of step — reading every path that follows as a status and
    // losing the rest of the list, which is far worse than one imprecise word.
    const status = STATUS_LETTERS[letter] ?? 'modified'

    const moved = status === 'renamed' || status === 'copied'
    const first = at(fields, index + 1)
    const second = moved ? at(fields, index + 2) : ''
    index += moved ? 2 : 1

    entries.push({
      path: moved ? second : first,
      oldPath: moved ? first : null,
      status
    })
  }

  return entries
}
