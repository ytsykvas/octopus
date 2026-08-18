import { z } from 'zod'

/** One line of a change, as it will be drawn. */
export interface ChangeLine {
  readonly sign: '+' | '-' | ' '
  readonly text: string
}

/** What a tool call did to a file, ready to draw. */
export interface Change {
  readonly path: string
  readonly lines: readonly ChangeLine[]
  readonly added: number
  readonly removed: number
  /**
   * Whether the text was replaced everywhere it appeared, rather than once.
   *
   * The counts describe a single occurrence, which is all the call carries: an
   * `Edit` is handed one pair of fragments however many places it applies them
   * to. Where this is set the counts are not a total and must not be drawn as
   * one — a rename through twelve places said `+1 −1`.
   */
  readonly everywhere: boolean
}

const EditSchema = z.object({
  file_path: z.string().min(1),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().optional()
})

const WriteSchema = z.object({
  file_path: z.string().min(1),
  content: z.string()
})

/**
 * Splits a fragment into the lines a diff works on.
 *
 * A trailing newline ends the last line rather than starting an empty one —
 * `'a\nb\n'` is two lines, and counting three would put a phantom `+` on every
 * change that ends the way files do.
 */
function toLines(text: string): string[] {
  // Nothing is no lines. `''.split('\n')` is one empty string, and taken as a
  // line it turns an insertion into nothing into a removal of a blank one.
  if (text === '') return []

  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/*
 * Two readings that cannot miss.
 *
 * Every index below is inside its array by construction — the table is built to
 * the exact size the walk covers. The fallbacks exist because
 * `noUncheckedIndexedAccess` types an indexed read as possibly absent, and one
 * place saying what absence would mean beats a guard at each of a dozen reads.
 *
 * Ignored for coverage rather than tested: no input reaches them, and a test
 * that pretended otherwise would be asserting against a state the module cannot
 * be in.
 */
/* v8 ignore next 2 */
const common = (table: readonly (readonly number[])[], row: number, column: number): number =>
  table[row]?.[column] ?? 0

/* v8 ignore next */
const lineAt = (lines: readonly string[], index: number): string => lines[index] ?? ''

/**
 * The length of the longest common subsequence of every pair of suffixes.
 *
 * The table is what lets the walk below tell a line that stayed from one that
 * was replaced. Without it a one-line change inside ten lines of context reads
 * as ten removed and ten added, which is true of the fragment and useless about
 * the change.
 */
function commonTable(before: readonly string[], after: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: before.length + 1 }, () =>
    Array.from({ length: after.length + 1 }, () => 0)
  )

  for (let row = before.length - 1; row >= 0; row--) {
    for (let column = after.length - 1; column >= 0; column--) {
      const kept =
        lineAt(before, row) === lineAt(after, column)
          ? common(table, row + 1, column + 1) + 1
          : Math.max(common(table, row + 1, column), common(table, row, column + 1))

      table[row]?.splice(column, 1, kept)
    }
  }

  return table
}

/**
 * A line-by-line diff of two fragments.
 *
 * Written here rather than taken from a package: the tree holds nothing of the
 * kind, and this is small enough that a dependency would cost more to justify
 * than the forty lines it saves — while being exactly the sort of thing a test
 * pins down completely.
 */
export function lineDiff(before: string, after: string): ChangeLine[] {
  const source = toLines(before)
  const target = toLines(after)
  const table = commonTable(source, target)

  const lines: ChangeLine[] = []
  let row = 0
  let column = 0

  while (row < source.length && column < target.length) {
    const left = lineAt(source, row)

    if (left === lineAt(target, column)) {
      lines.push({ sign: ' ', text: left })
      row++
      column++
      continue
    }

    // Whichever side keeps more of what follows is the one to hold back, so the
    // lines that survive line up rather than being reported twice.
    if (common(table, row + 1, column) >= common(table, row, column + 1)) {
      lines.push({ sign: '-', text: left })
      row++
    } else {
      lines.push({ sign: '+', text: lineAt(target, column) })
      column++
    }
  }

  for (; row < source.length; row++) lines.push({ sign: '-', text: lineAt(source, row) })
  for (; column < target.length; column++) lines.push({ sign: '+', text: lineAt(target, column) })

  return lines
}

function summarise(path: string, lines: ChangeLine[], everywhere = false): Change {
  return {
    path,
    lines,
    added: lines.filter((line) => line.sign === '+').length,
    removed: lines.filter((line) => line.sign === '-').length,
    everywhere
  }
}

/**
 * What a tool call changed, or null when it changed nothing we can show.
 *
 * The arguments carry it already — an `Edit` is handed the text it replaces and
 * the text it writes — so this needs nothing from disk and works just as well on
 * a conversation read back after a restart.
 *
 * A `Write` is reported as all additions. What stood there before is not in the
 * call, and a "before" invented for the sake of a tidier diff would be the one
 * part of this the reader could not check.
 *
 * An `Edit` with `replace_all` is one pair of fragments applied to every place
 * the text appears, and the call says nothing about how many that was. The
 * lines are still exactly right for each of them; only the counts stop being a
 * total, which is what `everywhere` warns the block about.
 */
export function readChange(toolName: string, input: unknown): Change | null {
  if (toolName === 'Edit') {
    const parsed = EditSchema.safeParse(input)
    if (!parsed.success) return null

    return summarise(
      parsed.data.file_path,
      lineDiff(parsed.data.old_string, parsed.data.new_string),
      parsed.data.replace_all ?? false
    )
  }

  if (toolName === 'Write') {
    const parsed = WriteSchema.safeParse(input)
    if (!parsed.success) return null

    return summarise(
      parsed.data.file_path,
      toLines(parsed.data.content).map((text) => ({ sign: '+' as const, text }))
    )
  }

  return null
}
