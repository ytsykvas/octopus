/**
 * Past this much, a reply being written is parsed in two parts.
 *
 * Below it the whole text is parsed at every flush, as it always was: a short
 * answer costs nothing to parse, and one parse cannot disagree with itself.
 * Above it, parsing the whole again twenty times a second cost more the longer
 * the answer got — every flush of a long reply walked all of it.
 */
export const SETTLED_AFTER = 1_500

/**
 * A line a block can start on without reading on from the block above.
 *
 * A letter or a heading mark: a list item, a table row, a quote or an
 * indented line may continue what came before it and are left where they
 * are. Digits are left too — `2.` opens a list item.
 */
const OPENS_A_BLOCK = /^[\p{L}#]/u

const FENCE = /^(```|~~~)/

/**
 * The part of a reply being written that can be parsed once and kept, and the
 * part that is still moving.
 *
 * The cut is at a blank line, outside any fenced block, before a line that
 * opens a block of its own — a paragraph, a heading — so the two parts are
 * parsed as what they are. The last such cut, so the tail holds as little as
 * can be: the settled part grows at block boundaries, and `Markdown`, memoised
 * on its text, parses it again only then. The final text arrives whole, in
 * its own event, and is parsed whole; this shapes only what is drawn while it
 * is still arriving.
 */
export function splitStreamed(text: string): { readonly settled: string; readonly tail: string } {
  if (text.length < SETTLED_AFTER) return { settled: '', tail: text }

  let inFence = false
  let cut = 0
  let offset = 0
  let blankBefore = false

  for (const line of text.split('\n')) {
    // A fence opening after a blank line is a block of its own to cut before;
    // what follows, until it closes, is never cut into.
    const opens = !inFence && blankBefore
    if (FENCE.test(line)) {
      if (opens) cut = offset
      inFence = !inFence
    } else if (opens && OPENS_A_BLOCK.test(line)) {
      cut = offset
    }

    blankBefore = line === ''
    offset += line.length + 1
  }

  return { settled: text.slice(0, cut), tail: text.slice(cut) }
}
