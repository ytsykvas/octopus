/**
 * What a failed tool call says, as much of it as the log should carry.
 *
 * A failure is one of the few things drawn in full, because it is the one the
 * user has to act on. It still cannot be unbounded — a build that failed can
 * answer with thousands of lines — so it is shortened, and the shortening says
 * so, which is the whole difference between a summary and a message that
 * appears to have ended.
 */

/** The agent side's own envelope around a refusal it produced itself. */
const OPEN = '<tool_use_error>'
const CLOSE = '</tool_use_error>'

/**
 * How much of it to keep.
 *
 * Chosen against a validation error, which is the longest thing that is still
 * worth reading whole: it names the rule at the start and what to do at the
 * end, with the offending JSON in between.
 */
const MAX_LENGTH = 400

/** Marks where the middle was taken out, spaced so it reads as a gap. */
const GAP = ' … '

/**
 * Strips the envelope, whichever half of it is there.
 *
 * Both ends are checked independently rather than as a pair, because a message
 * already shortened by something upstream arrives with the opening tag and no
 * closing one — and an unclosed tag reads as broken output rather than as an
 * envelope.
 */
function unwrap(content: string): string {
  let text = content.trim()
  if (text.startsWith(OPEN)) text = text.slice(OPEN.length)
  if (text.endsWith(CLOSE)) text = text.slice(0, -CLOSE.length)

  return text.trim()
}

/**
 * The failure, unwrapped and shortened from the middle.
 *
 * From the middle rather than the end: the first line names what failed, and
 * the last sentence is usually what to do about it — a validation error spends
 * everything between them on the value it refused. Cutting the tail throws away
 * the half that answers "and now what".
 */
export function readFailure(content: string): string {
  const text = unwrap(content)
  if (text.length <= MAX_LENGTH) return text

  const half = Math.floor((MAX_LENGTH - GAP.length) / 2)
  return `${text.slice(0, half).trimEnd()}${GAP}${text.slice(-half).trimStart()}`
}
