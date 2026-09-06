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
 * two of them is invisible here and the hunk after it can be mis-coloured. That
 * is the fallback rather than the rule now: `readWholeFileSides` answers with
 * both sides complete, and this is what colours a file too large for it.
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

/**
 * The same, from tokens covering the whole of each side.
 *
 * By line number rather than by walking, which is the whole difference: the
 * tokens describe every line of the file and the hunks describe some of them,
 * so there is no shared walk to keep in step — a `DiffLine` says which row of
 * which side it is, and that is the index.
 *
 * 1-based, as git counts, hence the subtraction. A line whose number falls
 * outside the tokens is absent rather than wrong: it means the two readings
 * disagree about the file, which happens if it changed between them, and a
 * plain line is the right answer to that.
 */
export function assignWholeTokens(
  hunks: readonly Hunk[],
  oldTokens: readonly (readonly Token[])[] | null,
  currentTokens: readonly (readonly Token[])[] | null
): ReadonlyMap<DiffLine, readonly Token[]> {
  const tokens = new Map<DiffLine, readonly Token[]>()

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      const removed = line.kind === 'removed'
      const number = removed ? line.oldNumber : line.newNumber

      /* Unreachable: a removed line always has its old number and every other
         kind has its new one — that is what the two nulls mean. The guard is
         here because the type says both can be absent. */
      /* v8 ignore next */
      if (number === null) continue

      const found = (removed ? oldTokens : currentTokens)?.[number - 1]
      if (found) tokens.set(line, found)
    }
  }

  return tokens
}
