/**
 * The two readings of time the pull request pane draws.
 *
 * Its own file rather than `chat/format.ts`, which is about a countdown to a
 * rate limit — a different question that happens to involve a clock. What is
 * shared is the shape of a date, and that is copied deliberately: `dd.mm HH:MM`
 * with the date dropped for today is what the composer's strip already reads
 * like, and two spellings of a timestamp in one window is the sort of
 * inconsistency that reads as sloppiness.
 */

/** Two digits, which is what makes a column of times line up. */
function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * When something was said.
 *
 * The clock alone for today, because the date on every line of a conversation
 * that happened this afternoon is noise; the date as well as soon as it is not
 * today, because "14:02" on its own then answers the wrong question.
 *
 * Answers null for a date that is not one. The value comes from GitHub, and a
 * pane that renders `Invalid Date` beside somebody's name is worse than one
 * that says nothing about when they said it.
 */
export function moment(value: string, from: Date = new Date()): string | null {
  const at = new Date(value)
  if (!Number.isFinite(at.getTime())) return null

  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`

  // `toDateString` is a fixed format by specification, so this asks "the same
  // day?" in one comparison rather than in three that would each need a case.
  if (at.toDateString() === from.toDateString()) return clock

  // `getMonth` counts from zero; nothing else about a date does.
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)} ${clock}`
}

/** Under this, seconds alone; above it, minutes and seconds. */
const MINUTE_MS = 60_000

/**
 * How long a check took, or null while it is still taking it.
 *
 * Null rather than a running total: the row already says the check is running,
 * and a number that changes every time the pane redraws draws the eye to the
 * one thing on it that means nothing yet.
 *
 * Both ends come from `pullRequestShapes.ts`, which has already turned GitHub's
 * zero time into null — the reason this can subtract two dates without checking
 * whether either is two thousand years ago.
 */
export function duration(startedAt: string | null, completedAt: string | null): string | null {
  if (startedAt === null || completedAt === null) return null

  const spent = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  // Not a number, or a run that finished before it started — which GitHub does
  // send, since the two stamps come from different machines.
  if (!Number.isFinite(spent) || spent < 0) return null

  const seconds = Math.round(spent / 1000)
  if (spent < MINUTE_MS) return `${String(seconds)}s`

  return `${String(Math.floor(seconds / 60))}m${String(seconds % 60)}s`
}
