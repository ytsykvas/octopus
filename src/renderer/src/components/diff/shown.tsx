import { Fragment } from 'react'

import { hasInvisible, splitInvisible } from './invisible.js'

/**
 * Text with anything that would not draw as itself named in its place.
 *
 * A right-to-left override reorders what is on screen without changing what
 * the compiler reads, and a zero-width character draws as nothing — either way
 * the reviewer approves a line, or opens a file, that is not the one they
 * read. Putting the code point where the character was stops the reordering as
 * well as reporting it, which a marker elsewhere on the row would not.
 *
 * A function rather than a component, and the text returned as itself when
 * there is nothing to replace: this runs on every token of every line, and a
 * wrapper element on all of them would be paid for to serve the one line in a
 * thousand that needs it.
 */
export function shown(text: string): React.ReactNode {
  if (!hasInvisible(text)) return text

  return splitInvisible(text).map((piece, index) =>
    'text' in piece ? (
      <Fragment key={index}>{piece.text}</Fragment>
    ) : (
      <span
        key={index}
        className="bg-warning-bg text-warning mx-px rounded-[2px] px-1 align-middle text-[9px] select-none"
      >
        {piece.code}
      </span>
    )
  )
}
