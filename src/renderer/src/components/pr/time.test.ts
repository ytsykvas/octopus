import { describe, expect, it } from 'vitest'

import { duration, moment } from './time.js'

/* The suite pins `TZ` to Europe/Kyiv, so a wall clock is a fixed thing to
   assert on rather than whatever the machine running this happens to be set to. */
const NOW = new Date('2026-08-20T15:00:00+03:00')

describe('when something was said', () => {
  it('shows the clock alone for today', () => {
    expect(moment('2026-08-20T14:02:00+03:00', NOW)).toBe('14:02')
  })

  /* "14:02" on its own answers the wrong question once it is not today. */
  it('shows the date as well once it is not today', () => {
    expect(moment('2026-08-11T09:47:00+03:00', NOW)).toBe('11.08 09:47')
  })

  it('pads both halves so a column of times lines up', () => {
    expect(moment('2026-01-02T03:04:00+02:00', NOW)).toBe('02.01 03:04')
  })

  /* The value comes from GitHub. A pane rendering `Invalid Date` beside
     somebody's name is worse than one saying nothing about when they spoke. */
  it('says nothing about a date that is not one', () => {
    expect(moment('whenever', NOW)).toBeNull()
  })

  it('falls back to the real clock when no moment is given', () => {
    expect(moment(new Date().toISOString())).not.toBeNull()
  })
})

describe('how long a check took', () => {
  it('counts seconds for a short run', () => {
    expect(duration('2026-08-20T11:00:00Z', '2026-08-20T11:00:12Z')).toBe('12s')
  })

  it('counts minutes and seconds for a long one', () => {
    expect(duration('2026-08-20T11:00:00Z', '2026-08-20T11:01:04Z')).toBe('1m4s')
  })

  it('rounds to the second rather than showing a fraction of one', () => {
    expect(duration('2026-08-20T11:00:00.000Z', '2026-08-20T11:00:12.400Z')).toBe('12s')
  })

  /* The row already says a check is running. A number that changes on every
     redraw draws the eye to the one thing on it that means nothing yet. */
  it('says nothing about a run that has not finished', () => {
    expect(duration('2026-08-20T11:00:00Z', null)).toBeNull()
    expect(duration(null, '2026-08-20T11:00:12Z')).toBeNull()
  })

  /*
   * GitHub does send this: the two stamps come from different machines, and a
   * job can report finishing a moment before it reports starting. Shown, it is
   * a negative duration beside a passing check.
   */
  it('says nothing about a run that finished before it started', () => {
    expect(duration('2026-08-20T11:00:12Z', '2026-08-20T11:00:00Z')).toBeNull()
  })

  it('says nothing about a stamp that is not a date', () => {
    expect(duration('the beginning', '2026-08-20T11:00:00Z')).toBeNull()
  })
})
