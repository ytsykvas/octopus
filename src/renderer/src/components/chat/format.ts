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
const NOTICEABLE = 75
/** At this, worth acting on before it decides for you. */
const PRESSING = 90

/**
 * The colour a share is drawn in as it fills.
 *
 * One function for every reading in the strip, so the context window and the
 * subscription cannot disagree about what counts as high — two gauges side by
 * side turning colour at different points reads as one of them being broken.
 *
 * Not tied to the agent's own auto-compaction threshold, which sounds like the
 * natural boundary and is not: measured against a live session it sits at
 * 96.7% of the window, which is long past the point where knowing helps.
 */
export function usageTone(percentage: number): 'text-ink-faint' | 'text-warning' | 'text-danger' {
  if (percentage >= PRESSING) return 'text-danger'
  if (percentage >= NOTICEABLE) return 'text-warning'
  return 'text-ink-faint'
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
