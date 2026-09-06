/**
 * Numbers as a line of running text wants them.
 *
 * The turn footer is a single quiet line; a full token count would be the
 * widest thing on it and the least worth reading precisely. Nobody acts on the
 * difference between 47,912 and 48,000.
 */

/** A token count, shortened: `860`, `1.2k`, `48k`. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(Math.max(0, Math.round(count)))

  const thousands = count / 1000
  const withDecimal = thousands.toFixed(1)

  // One decimal below ten, none above: `1.2k` is worth the character, `47.9k`
  // is not — by then the round number is what the eye takes anyway. The
  // comparison is against the rounded value, not the raw one, or 9,960 would
  // round up into `10.0k` and sit there contradicting the rule.
  return Number(withDecimal) < 10 ? `${withDecimal}k` : `${String(Math.round(thousands))}k`
}

/** Below this a share is unremarkable; at it, worth noticing. */
const NOTICEABLE = 60
/** At this, worth acting on before it decides for you. */
const PRESSING = 80

/**
 * How much of something being gone should be made of.
 *
 * The one place the thresholds are read, so every gauge in the app agrees about
 * what counts as high — two of them side by side turning colour at different
 * points reads as one being broken. Colour is chosen from this rather than
 * beside it, which is what keeps a bar and the number written on it in step.
 *
 * Not tied to the agent's own auto-compaction threshold, which sounds like the
 * natural boundary and is not: measured against a live session it sits at
 * 96.7% of the window, which is long past the point where knowing helps.
 */
export function usageLevel(
  percentage: number,
  severity?: string | null
): 'calm' | 'noticeable' | 'pressing' {
  const said = severity === null || severity === undefined ? undefined : SEVERITIES[severity]
  if (said !== undefined) return said

  if (percentage >= PRESSING) return 'pressing'
  if (percentage >= NOTICEABLE) return 'noticeable'
  return 'calm'
}

/**
 * The server's own vocabulary for a reading, where we know the word.
 *
 * The thresholds above are guesses; this is not, and the account is the thing
 * that decides when a plan window is worth worrying about. So a word we
 * recognise wins, and a word we do not falls back — adding a row here is the
 * whole of what it takes when a new one is observed.
 *
 * **`normal` is the only row because it is the only one measured.** A captured
 * `/usage` response carries it and nothing else, and inventing `warning` and
 * `critical` beside it would be this app guessing again in a table whose entire
 * purpose is to stop it. The asymmetry that leaves is deliberate and is the
 * right way round: the server can talk us down from a colour our thresholds
 * chose, and cannot raise one on a word nobody has seen.
 */
const SEVERITIES: Record<string, 'calm' | 'noticeable' | 'pressing' | undefined> = {
  normal: 'calm'
}

const TONES = {
  calm: 'text-ink-faint',
  noticeable: 'text-warning',
  pressing: 'text-danger'
} as const

const FILLS = {
  // Green rather than neutral, and the one place a calm reading is coloured at
  // all: a bar is a block by design, so an empty one has room to say "fine"
  // where a number in green would only be a number wearing a colour. The tone
  // beside it stays `ink-faint` for that reason.
  calm: 'bg-success',
  noticeable: 'bg-warning',
  pressing: 'bg-danger'
} as const

/** The colour a share is written in as it fills. */
export function usageTone(
  percentage: number,
  severity?: string | null
): (typeof TONES)[keyof typeof TONES] {
  return TONES[usageLevel(percentage, severity)]
}

/**
 * The colour a share is drawn in as it fills.
 *
 * The one place a status colour is a block rather than text or an icon. The
 * rule against that exists so a list does not turn into confetti; here the
 * block *is* the reading, and a bar drawn in the ink colour beside a number
 * drawn in red would be the two disagreeing.
 */
export function usageFill(
  percentage: number,
  severity?: string | null
): (typeof FILLS)[keyof typeof FILLS] {
  return FILLS[usageLevel(percentage, severity)]
}

/**
 * A span of time, coarsely: `4хв 12с`, `38с`, `0с`.
 *
 * Minutes and seconds and no further. What this measures is how long a session
 * spent waiting on the API, and an hour of it reads as `74хв` rather than
 * growing a third unit — the figure is there to be compared with the wall clock
 * beside it, and two units line up where three wrap.
 */
export function formatDuration(
  ms: number,
  labels: { readonly minutes: string; readonly seconds: string }
): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60

  if (minutes === 0) return `${String(seconds)}${labels.seconds}`
  return `${String(minutes)}${labels.minutes} ${String(seconds)}${labels.seconds}`
}

/**
 * How long until a moment, coarsely: `3г 12хв`, `47хв`, `зараз`.
 *
 * Coarse on purpose. A rate limit window resets hours from now, and a ticking
 * second count would redraw the header sixty times a minute to say something
 * nobody is watching that closely.
 */
export function formatCountdown(
  target: string,
  labels: { readonly hours: string; readonly minutes: string; readonly now: string },
  from: Date = new Date()
): string {
  const remaining = Date.parse(target) - from.getTime()
  if (!Number.isFinite(remaining) || remaining <= 0) return labels.now

  const totalMinutes = Math.ceil(remaining / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) return `${String(minutes)}${labels.minutes}`
  return `${String(hours)}${labels.hours} ${String(minutes)}${labels.minutes}`
}

/** Two digits, so `9:5` never appears where `09:05` is meant. */
function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * When a window comes back: `19:50`, or `12.08 01:00` when that is not today.
 *
 * The hour always, because "when does it reset" is the question — and the day
 * only when the hour alone would not answer it. A bare `01:00` read at 22:00 is
 * a time that has already gone, so a reset falling on another day carries its
 * date. The boundary is the calendar day rather than a rolling twenty-four
 * hours: a reader reasons in days, and a rolling one would date tonight's
 * `23:00` while leaving tomorrow's `01:00` bare — the inversion of what helps.
 *
 * One rule for both windows rather than a format each. A weekly window that
 * happens to reset today then says the hour rather than saying "today", and a
 * five-hour one across midnight says which midnight — and it crosses one for
 * five hours in every twenty-four, so that is not a corner.
 *
 * 24-hour and day-first in every language, following neither the app's language
 * nor the system's locale. This is a figure on a strip read sideways: `6:00 PM`
 * spends three characters saying what `18:00` says, and both locales the app has
 * write the day first. A locale that does not is the reason to revisit it.
 *
 * Null for a moment that cannot be read or has already passed. The reading is
 * pulled when a turn ends and then sits there, so a window that has reset since
 * is ordinary rather than broken — and an hour in the past under the word
 * "resets" is a promise about the future that has already been broken.
 * `formatCountdown` answers `now` to that same instant, so the strip and its
 * tooltip cannot end up disagreeing about one window.
 */
export function formatResetAt(target: string, from: Date = new Date()): string | null {
  const at = new Date(target)
  const moment = at.getTime()
  if (!Number.isFinite(moment) || moment <= from.getTime()) return null

  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`

  // Compared, never shown: `toDateString` is a fixed format by specification, so
  // this asks "the same day?" in one comparison rather than in three that would
  // each need a case of their own to stay covered — cases named after the branch
  // that fired rather than after the rule.
  if (at.toDateString() === from.toDateString()) return clock

  // `getMonth` counts from zero; nothing else about a date does.
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)} ${clock}`
}
