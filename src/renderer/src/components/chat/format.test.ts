import { describe, expect, it } from 'vitest'

import { formatCountdown, formatTokens, usageTone } from './format.js'

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
