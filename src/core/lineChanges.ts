/**
 * Which lines of one file differ from the branch's fork point, for the viewer
 * to mark.
 *
 * Only the hunk headers of a zero-context diff are read: they already say where
 * each change lies in the file as it stands, and printing the lines themselves
 * would cost a read of the whole change for numbers the header carries.
 */

import { readFile } from 'node:fs/promises'

import { mergeBase } from './diff.js'
import { DIFF_FLAGS, RAW_PATHS } from './nameStatus.js'
import type { GitExec } from './git.js'
import { allOf } from './parallel.js'

/** Inclusive, 1-based, in the file as it is now. */
export interface LineRange {
  readonly start: number
  readonly end: number
}

export interface LineChanges {
  /** Lines with nothing before them in the base. */
  readonly added: readonly LineRange[]
  /** Lines that replaced others. */
  readonly modified: readonly LineRange[]
  /**
   * Lines were taken out right after each of these; 0 is above the first line.
   * A removed line has no place in the file as it stands, so the mark is on the
   * gap it left.
   */
  readonly removedAfter: readonly number[]
}

/**
 * `@@ -a[,b] +c[,d] @@`, with either count missing meaning one line. Anchored,
 * and two `@` only: a combined diff's `@@@` and a `+` line that happens to
 * read like a header are not hunks of this file.
 */
const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** What a file with nothing to mark answers. */
export const NO_LINE_CHANGES: LineChanges = { added: [], modified: [], removedAfter: [] }

export function parseLineChanges(output: string): LineChanges {
  const added: LineRange[] = []
  const modified: LineRange[] = []
  const removedAfter: number[] = []

  for (const line of output.split('\n')) {
    const match = HUNK.exec(line)
    if (match === null) continue

    const [, oldCount, start, newCount] = match
    const before = oldCount === undefined ? 1 : Number(oldCount)
    const after = newCount === undefined ? 1 : Number(newCount)
    const first = Number(start)

    if (after === 0) removedAfter.push(first)
    else (before === 0 ? added : modified).push({ start: first, end: first + after - 1 })
  }

  return { added, modified, removedAfter }
}

export interface ReadLineChangesOptions {
  readonly baseBranch: string
  /** Relative to the worktree, as git names it. */
  readonly path: string
  /**
   * Where the file is on disk, already proved inside the worktree.
   *
   * Only read for an untracked file, which git prints no diff for and which is
   * therefore counted rather than parsed.
   */
  readonly absolute: string
}

/**
 * The lines of one file that differ from where the branch began — the same
 * left-hand side as the Changes pane, so a mark here is a line that pane shows.
 *
 * One diff and one listing, both for this path alone and run together: nothing
 * about the rest of the worktree is read, which is what keeps this cheap enough
 * to ask each time a file comes to the front. `-U0` because the context lines
 * would only be printed to be thrown away.
 */
export async function readLineChanges(
  exec: GitExec,
  options: ReadLineChangesOptions
): Promise<LineChanges> {
  const baseCommit = await mergeBase(exec, options.baseBranch)
  // Literal, or a file named `a*.txt` would also mark `a.txt`'s changes.
  const spec = `:(literal)${options.path}`

  const [diff, untracked] = await allOf([
    exec([...RAW_PATHS, 'diff', '-U0', ...DIFF_FLAGS, baseCommit, '--', spec]),
    exec(['ls-files', '--others', '--exclude-standard', '-z', '--', spec])
  ])

  if (untracked === '') return parseLineChanges(diff)

  const count = lineCount(await readFile(options.absolute, 'utf8'))
  return {
    added: count === 0 ? [] : [{ start: 1, end: count }],
    modified: [],
    removedAfter: []
  }
}

/** A final newline ends the last line rather than starting another. */
function lineCount(text: string): number {
  if (text === '') return 0
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}
