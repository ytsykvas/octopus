import type { DiffLine } from '@core/diff.js'

/** One row of a side-by-side diff: the old file left, the new file right. */
export interface SplitRow {
  readonly left: DiffLine | null
  readonly right: DiffLine | null
}

/**
 * Pairs a unified hunk's lines into two columns.
 *
 * A run of removals is set against the run of additions that follows it, one
 * for one, and whichever run is shorter is padded with nothing. That is what
 * makes a replaced line read as a replacement rather than as a deletion above
 * an unrelated insertion — the pairing is the whole reason to have two columns.
 *
 * Context lines occupy both sides, because they are the same line.
 *
 * Every read walks the array through the loop condition rather than by index,
 * so each line is narrowed where it is used: `noUncheckedIndexedAccess` types
 * an indexed read as possibly absent, and the alternative is an assertion the
 * project forbids or a guard no input reaches.
 */
export function splitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let index = 0

  for (let line = lines[index]; line !== undefined; line = lines[index]) {
    if (line.kind === 'context') {
      rows.push({ left: line, right: line })
      index++
      continue
    }

    const removed: DiffLine[] = []
    const added: DiffLine[] = []

    for (let next = lines[index]; next?.kind === 'removed'; next = lines[index]) {
      removed.push(next)
      index++
    }
    for (let next = lines[index]; next?.kind === 'added'; next = lines[index]) {
      added.push(next)
      index++
    }

    for (let offset = 0; offset < Math.max(removed.length, added.length); offset++) {
      rows.push({ left: removed[offset] ?? null, right: added[offset] ?? null })
    }
  }

  return rows
}
