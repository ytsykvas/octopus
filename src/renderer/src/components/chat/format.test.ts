import { describe, expect, it } from 'vitest'

import { formatCountdown, formatResetAt, formatTokens, usageTone } from './format.js'

describe('token counts', () => {
  it('shows small counts exactly', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(860)).toBe('860')
    expect(formatTokens(999)).toBe('999')
  })

  // The decimal is worth a character at 1.2k and not at 47.9k, where the round
  // number is what the eye takes anyway.
  it('shortens thousands, with a decimal only while it says something', () => {
    expect(formatTokens(1000)).toBe('1.0k')
    expect(formatTokens(1180)).toBe('1.2k')
    expect(formatTokens(48_120)).toBe('48k')
  })

  // The decimal drops at ten, so the value that would round up into it has to
  // cross over rather than read as `10.0k`.
  it('crosses cleanly at ten thousand', () => {
    expect(formatTokens(9940)).toBe('9.9k')
    expect(formatTokens(9960)).toBe('10k')
  })

  it('never shows a fraction of a token or a negative one', () => {
    expect(formatTokens(12.4)).toBe('12')
    expect(formatTokens(-5)).toBe('0')
  })
})

describe('the countdown to a reset', () => {
  const labels = { hours: 'h', minutes: 'm', now: 'now' }
  const from = new Date('2026-08-11T09:00:00.000Z')

  it('reads in hours and minutes', () => {
    expect(formatCountdown('2026-08-11T12:12:00.000Z', labels, from)).toBe('3h 12m')
  })

  it('drops the hours when there are none', () => {
    expect(formatCountdown('2026-08-11T09:47:00.000Z', labels, from)).toBe('47m')
  })

  // A window that has already reset is not a negative amount of time.
  it('says the window is up rather than counting backwards', () => {
    expect(formatCountdown('2026-08-11T08:00:00.000Z', labels, from)).toBe('now')
    expect(formatCountdown('2026-08-11T09:00:00.000Z', labels, from)).toBe('now')
  })

  it('says the window is up rather than showing a broken timestamp', () => {
    expect(formatCountdown('not a date', labels, from)).toBe('now')
  })

  it('reads the clock when given no reference point', () => {
    const soon = new Date(Date.now() + 90 * 60_000).toISOString()

    expect(formatCountdown(soon, labels)).toBe('1h 30m')
  })
})

// One function for both readings in the strip. Two gauges side by side that
// turned colour at different points would read as one of them being broken.
describe('how full is worth noticing', () => {
  it('stays quiet while there is room', () => {
    expect(usageTone(0)).toBe('text-ink-faint')
    expect(usageTone(74)).toBe('text-ink-faint')
  })

  it('warns from three quarters', () => {
    expect(usageTone(75)).toBe('text-warning')
    expect(usageTone(89)).toBe('text-warning')
  })

  it('is plain about the last tenth', () => {
    expect(usageTone(90)).toBe('text-danger')
    expect(usageTone(100)).toBe('text-danger')
  })
})

describe('the moment a window resets', () => {
  // 19:00 in the zone the suite is pinned to. Kyiv rather than UTC on purpose:
  // a formatter that reached for `getUTCHours` could not pass a line of this.
  const from = new Date('2026-08-11T16:00:00+00:00')

  it('reads as an hour of the day, on a 24-hour clock in any language', () => {
    expect(formatResetAt('2026-08-11T16:50:00+00:00', from)).toBe('19:50')
  })

  // The offset and the microseconds are how a reset actually arrives, taken
  // from a live session rather than composed from the declaration.
  it('reads a reset in the shape the agent sends it', () => {
    expect(formatResetAt('2026-08-11T19:50:00.149775+00:00', from)).toBe('22:50')
  })

  it('pads the hour and the minute, so the reading never changes width', () => {
    expect(formatResetAt('2026-08-11T18:05:00+00:00', from)).toBe('21:05')
  })

  // `01:00` read at 22:00 is a time that has already gone. The day is the only
  // thing that tells the two apart, so it comes with any reset that is not
  // today's — day first, and months counted from one.
  it('carries the date once the reset falls on another day', () => {
    expect(formatResetAt('2026-08-12T04:00:00+00:00', from)).toBe('12.08 07:00')
    expect(formatResetAt('2026-09-02T05:30:00+00:00', from)).toBe('02.09 08:30')
  })

  // The boundary is the calendar day, not a rolling twenty-four hours: three
  // hours away and past midnight is another day, twenty hours away and short of
  // it is not. A reader reasons in days, so the format follows days.
  it('goes by the day rather than by how far off the reset is', () => {
    const lateEvening = new Date('2026-08-11T20:00:00+00:00')
    expect(formatResetAt('2026-08-11T23:00:00+00:00', lateEvening)).toBe('12.08 02:00')

    const justPastMidnight = new Date('2026-08-11T21:10:00+00:00')
    expect(formatResetAt('2026-08-12T17:30:00+00:00', justPastMidnight)).toBe('20:30')
  })

  // The reading is pulled when a turn ends and then sits there, so a window that
  // has reset since is ordinary. An hour in the past under the word "resets" is
  // a promise about the future that has already been broken.
  it('says nothing about a moment that has already passed', () => {
    expect(formatResetAt('2026-08-11T15:00:00+00:00', from)).toBeNull()
    expect(formatResetAt('2026-08-11T16:00:00+00:00', from)).toBeNull()
  })

  // The same answer the countdown gives an unreadable timestamp, so the strip
  // and its tooltip cannot end up disagreeing about one window.
  it('says nothing about a moment it cannot read', () => {
    expect(formatResetAt('not a date', from)).toBeNull()
  })

  it('reads the machine clock when given no reference point', () => {
    const soon = new Date(Date.now() + 60 * 60_000).toISOString()

    expect(formatResetAt(soon)).toBe(formatResetAt(soon, new Date()))
    expect(formatResetAt(soon)).not.toBeNull()
  })
})
