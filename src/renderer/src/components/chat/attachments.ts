import type { DiffComment } from '../../hooks/useDiffComments.js'

/**
 * Puts the review notes into the message that carries them.
 *
 * They become text rather than anything hidden. §4 is explicit that nothing
 * implicit reaches the agent, and the message the user can read back in the log
 * is the whole of what was sent — the same reasoning that has `/clear` go out
 * as the characters the user typed rather than as a command this app dispatches.
 *
 * The quoted code is what the note was written against, kept from the moment it
 * was written: by the time the agent reads it the file may have moved on, and a
 * line number on its own would point at whatever now sits there.
 */
export function withComments(
  text: string,
  comments: readonly DiffComment[],
  intro: string
): string {
  if (comments.length === 0) return text

  const quoted = comments.map(
    (comment) =>
      `${comment.path}:${lineRange(comment)}\n${blockQuote(comment.code)}\n${comment.text}`
  )

  // The typed message last, so the agent reads the notes and then what to do
  // with them — and an empty one leaves no trailing blank lines behind.
  return [intro, ...quoted, text].filter((part) => part !== '').join('\n\n')
}

/** `42` for a note on one line, `42-47` for one covering a passage. */
function lineRange(comment: DiffComment): string {
  return comment.line === comment.endLine
    ? String(comment.line)
    : `${String(comment.line)}-${String(comment.endLine)}`
}

/**
 * Every line marked, not just the first.
 *
 * A passage quoted with one `>` and then bare lines reads as a quote that ended
 * and a message that began — which is exactly the confusion the marker exists
 * to prevent.
 */
function blockQuote(code: string): string {
  return code
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}
