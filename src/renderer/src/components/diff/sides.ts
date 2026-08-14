import type { DiffLine, Hunk } from '@core/diff.js'

import type { Token } from './highlight.js'

/**
 * The two documents a file's hunks describe: the code as it was, and as it is.
 *
 * Rebuilt because a highlighter has to read a side whole. Colouring each line
 * on its own gets a block comment, a template literal or a heredoc wrong from
 * its second line onwards, and the lines of a hunk are exactly where multi-line
 * constructs turn up.
 *
 * The hunks are joined end to end, so a construct opened in the lines between
 * two of them is invisible here and the hunk after it can be mis-coloured.
 * Reading the whole file from disk would fix that and cost a read and a full
 * tokenising per file; the limit is the same one every hunk-based viewer has.
 */
export interface Sides {
  readonly old: string
  readonly current: string
}

export function sideTexts(hunks: readonly Hunk[]): Sides {
  const old: string[] = []
  const current: string[] = []

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind !== 'added') old.push(line.text)
      if (line.kind !== 'removed') current.push(line.text)
    }
  }

  return { old: old.join('\n'), current: current.join('\n') }
}

/**
 * Hands each line the tokens of the side it belongs to.
 *
 * A context line takes the current side: it reads the same either way, and the
 * current file is the one the reader is looking at.
 *
 * Keyed by the line itself rather than by an index, because the same walk has
 * to line up with `sideTexts` above and a number shared between two functions
 * is a number that drifts. A line whose side produced no tokens is simply
 * absent, which is what the row draws plain.
 */
export function assignTokens(
  hunks: readonly Hunk[],
  oldTokens: readonly (readonly Token[])[] | null,
  currentTokens: readonly (readonly Token[])[] | null
): ReadonlyMap<DiffLine, readonly Token[]> {
  const tokens = new Map<DiffLine, readonly Token[]>()
  let oldRow = 0
  let currentRow = 0

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      const from = line.kind === 'removed' ? oldTokens : currentTokens
      const row = line.kind === 'removed' ? oldRow : currentRow
      const found = from?.[row]
      if (found) tokens.set(line, found)

      if (line.kind !== 'added') oldRow++
      if (line.kind !== 'removed') currentRow++
    }
  }

  return tokens
}
