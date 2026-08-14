/**
 * Characters that make a line read differently from how it runs.
 *
 * A diff line is put on screen as text, and the browser applies the Unicode
 * bidirectional algorithm to it. A right-to-left override reorders what the
 * reviewer sees without changing a byte of what the compiler reads — the
 * Trojan Source trick, CVE-2021-42574 — and the invisible characters below
 * draw as nothing at all. Neither executes anything: the danger is narrower
 * and worse suited to being ignored, because the reviewer approves a line that
 * is not the line.
 *
 * Pure and dependency-free, beside `language.ts` and `sides.ts`, for the same
 * reason they are: it can be tested on strings.
 */

import type { FileDiff } from '@core/diff.js'

/**
 * The characters worth showing, and no others.
 *
 * Two groups. The bidi controls — U+061C, U+200E, U+200F, U+202A–U+202E and
 * U+2066–U+2069 — are the ones that reorder a line. The rest are invisible
 * rather than reordering: a zero-width space, a word joiner, a byte order mark
 * left in the middle of a file.
 *
 * Deliberately **not** U+200C and U+200D, the zero-width non-joiner and
 * joiner. They are ordinary in Persian and in Indic scripts, and every emoji
 * built from several code points contains one; a warning that fires on those
 * is a warning nobody reads by the second file.
 */
const INVISIBLE = /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu

/** A run of ordinary text, or one character that has to be shown to be seen. */
export type Piece = { readonly text: string } | { readonly code: string }

/** Whether anything in this text would draw as something other than itself. */
export function hasInvisible(text: string): boolean {
  // `test` on a `g` regexp advances `lastIndex`, so the same call on the same
  // string answers differently the second time. Reset rather than drop the
  // flag: `split` below needs it.
  INVISIBLE.lastIndex = 0
  return INVISIBLE.test(text)
}

/**
 * Splits a line into what can be drawn as itself and what cannot.
 *
 * The character is replaced rather than annotated, so the reordering stops as
 * well as being announced — a marker beside a line that still reads backwards
 * would name the problem and leave it there.
 */
export function splitInvisible(text: string): readonly Piece[] {
  if (!hasInvisible(text)) return [{ text }]

  const pieces: Piece[] = []
  let last = 0

  INVISIBLE.lastIndex = 0
  for (const match of text.matchAll(INVISIBLE)) {
    if (match.index > last) pieces.push({ text: text.slice(last, match.index) })
    pieces.push({ code: codePoint(match[0]) })
    last = match.index + match[0].length
  }

  if (last < text.length) pieces.push({ text: text.slice(last) })

  return pieces
}

/**
 * `U+202E`, which is how such a character is named everywhere else.
 *
 * The fallback is what the type asks for rather than a state to test: every
 * caller passes a character the regexp above matched, and an empty string is
 * not one. Ignored for coverage the way `at` in `core/diff.ts` is, and for the
 * same reason — a test reaching it would have to model an input the only
 * caller cannot produce.
 */
function codePoint(character: string): string {
  /* v8 ignore next */
  const code = character.codePointAt(0) ?? 0
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
}

/**
 * Whether anything about a file would draw other than as itself.
 *
 * Its lines, and its name: a path is drawn from the same bytes and reorders
 * the same way, so `report<U+202E>gnp.js` is a script that looks like an image.
 *
 * Asked per file so the header can say so while the file is collapsed — the
 * state a large generated file is in by default, and the one where a line
 * nobody has looked at is most likely to be approved.
 */
export function fileHasInvisible(file: FileDiff): boolean {
  if (hasInvisible(file.path)) return true
  return file.hunks.some((hunk) => hunk.lines.some((line) => hasInvisible(line.text)))
}
