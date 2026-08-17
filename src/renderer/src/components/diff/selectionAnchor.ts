import type { CommentAnchor } from '../../hooks/useDiffComments.js'

/**
 * Where one line of the diff sits, written so the DOM can carry it.
 *
 * The rows have to say which line they are for a selection to be read back into
 * a note, and there is nowhere else to put it: a browser selection knows about
 * nodes and offsets, and nothing about the model that produced them.
 *
 * Not `anchorKey`, though the two look alike. That one identifies a **note**,
 * which covers a range; this identifies a **line**, and a line is where it is.
 */
export function lineAddress(path: string, side: 'old' | 'new', line: number): string {
  return `${path}:${side}:${String(line)}`
}

/**
 * Read back, and null for anything that is not one.
 *
 * Parsed from the right, because the path is the part that can contain a colon
 * — `src/a:b.ts` is a legal filename, and splitting from the left would put
 * half of it in the side.
 */
function parseAddress(address: string): { path: string; side: 'old' | 'new'; line: number } | null {
  const lineAt = address.lastIndexOf(':')
  const sideAt = address.lastIndexOf(':', lineAt - 1)
  if (sideAt < 0) return null

  const side = address.slice(sideAt + 1, lineAt)
  const line = Number(address.slice(lineAt + 1))
  if ((side !== 'old' && side !== 'new') || !Number.isInteger(line)) return null

  return { path: address.slice(0, sideAt), side, line }
}

/**
 * The note a selection would make, from the lines it touched.
 *
 * A selection is free-form and the notes are not: it can begin mid-word, end
 * mid-word, and run past the end of a file into the next one. So the addresses
 * are reduced to one file, one side, and the first and last line numbers in it
 * — the whole of every line the selection touched, which is what gets quoted.
 *
 * **Trimmed to where it started, not refused.** Dragging past the end of a file
 * is how a reader selects the end of a file, and a gesture that answers nothing
 * because it went one line too far teaches people to drag carefully rather than
 * to select what they mean.
 *
 * The addresses arrive in document order, not in the order they were dragged
 * over: a selection made from the bottom up is normalised by the browser before
 * `getRangeAt` hands it over, so which way it was drawn never reaches here.
 * `first` is therefore the topmost line touched, and the file and side it
 * belongs to are the ones the rest are held against.
 */
export function selectionAnchor(addresses: readonly string[]): CommentAnchor | null {
  const parsed = addresses.map(parseAddress).filter((one) => one !== null)

  const first = parsed[0]
  if (first === undefined) return null

  const lines = parsed
    .filter((one) => one.path === first.path && one.side === first.side)
    .map((one) => one.line)

  return {
    path: first.path,
    side: first.side,
    line: Math.min(...lines),
    endLine: Math.max(...lines)
  }
}
