import { describe, expect, it } from 'vitest'

import type { Prompt } from '@core/promptSchema.js'

import { fanItems, fanSlots, PILL_MAX } from './fan.js'

// The composer's own corner: nothing to the right of the button, so only the
// left quarter — 9 o'clock to 12 — is there to use.
const LEFT_ONLY = { top: 0, left: 0, right: 600 }
// Room all round, which is what lets the fan open as far as 3 o'clock.
const WIDE = { top: 0, left: 0, right: 1200 }

describe('fanSlots', () => {
  // The quarter of a circle above and to the left of the button: a pill on each
  // of five rungs, the top one straight above and the lowest nearly level with it.
  it('lays five pills on the left quarter when there is room only on the left', () => {
    const slots = fanSlots({ x: 600, y: 600 }, LEFT_ONLY)

    expect(slots.map((slot) => slot.x)).toEqual([600, 516, 488, 472, 463])
    expect(slots.map((slot) => slot.top)).toEqual([448, 476, 504, 532, 560])
    expect(slots.every((slot) => slot.side === 'left')).toBe(true)
  })

  // The rest of the half circle, 12 o'clock to 3, for when there are many: the
  // top rung is shared, so the right quarter has one rung fewer.
  it('goes on round to 3 o\u2019clock when there is room on the right, top to bottom', () => {
    const slots = fanSlots({ x: 600, y: 600 }, WIDE)
    const right = slots.filter((slot) => slot.side === 'right')

    expect(slots).toHaveLength(9)
    expect(slots.slice(0, 5).every((slot) => slot.side === 'left')).toBe(true)
    expect(right.map((slot) => slot.x)).toEqual([684, 712, 728, 737])
    expect(right.map((slot) => slot.top)).toEqual([476, 504, 532, 560])
  })

  it('starts the first pill straight above the button, as wide as a pill may be', () => {
    const [first] = fanSlots({ x: 600, y: 600 }, LEFT_ONLY)

    expect(first).toEqual({
      side: 'left',
      x: 600,
      top: 448,
      maxWidth: PILL_MAX,
      fromX: 0,
      fromY: 140
    })
  })

  // Each pill flies out of the button, so its offset is where the button is
  // from the pill's own place — and on the right that is to the left of it.
  it('measures each pill\u2019s flight from the button\u2019s centre, on either side', () => {
    const slots = fanSlots({ x: 600, y: 600 }, WIDE)

    expect(slots[4]).toMatchObject({ fromX: 600 - 463, fromY: 600 - 560 - 12 })
    expect(slots[5]).toMatchObject({ side: 'right', fromX: 600 - 684, fromY: 600 - 476 - 12 })
  })

  it('drops the pills that would run off the top, keeping the ones below', () => {
    const slots = fanSlots({ x: 600, y: 60 }, WIDE)

    expect(slots).toHaveLength(2)
    expect(slots.map((slot) => slot.side)).toEqual(['left', 'right'])
    expect(slots.map((slot) => slot.top)).toEqual([20, 20])
  })

  it('keeps a pill whose top is exactly at the margin, and drops the rung above it', () => {
    // The top rung of this anchor sits at y - 152; the margin is 8.
    expect(fanSlots({ x: 600, y: 160 }, LEFT_ONLY)[0]).toMatchObject({ top: 8, x: 600 })
    // The rung at 7 is gone, so the first one left is the next down: 159 - 112 - 12.
    expect(fanSlots({ x: 600, y: 159 }, LEFT_ONLY)[0]).toMatchObject({ top: 35 })
  })

  it('drops the left pills too far left for the narrowest pill to fit', () => {
    const slots = fanSlots({ x: 150, y: 600 }, { top: 0, left: 0, right: 150 })

    expect(slots).toHaveLength(1)
    expect(slots[0]).toMatchObject({ x: 150 })
  })

  it('keeps a left pill whose edge is exactly at the margin', () => {
    // Narrowest pill is 96 wide and the margin 8, so the right edge may be 104.
    expect(fanSlots({ x: 104, y: 600 }, { top: 0, left: 0, right: 104 })).toHaveLength(1)
    expect(fanSlots({ x: 103, y: 600 }, { top: 0, left: 0, right: 103 })).toHaveLength(0)
  })

  it('drops the right pills too near the right edge, and keeps one exactly at the margin', () => {
    // A right pill starts at x and the narrowest is 96 wide: x + 96 <= right - 8.
    // The rungs of the right quarter start 84 right of the anchor at the least.
    const fits = fanSlots({ x: 600, y: 600 }, { top: 0, left: 0, right: 600 + 84 + 96 + 8 })
    expect(fits.filter((slot) => slot.side === 'right')).toHaveLength(1)

    const short = fanSlots({ x: 600, y: 600 }, { top: 0, left: 0, right: 600 + 84 + 96 + 7 })
    expect(short.filter((slot) => slot.side === 'right')).toHaveLength(0)
  })

  it('narrows a pill to the room it has, on the left and on the right', () => {
    const [first, ...others] = fanSlots({ x: 350, y: 600 }, { top: 0, left: 200, right: 650 })

    expect(first).toMatchObject({ side: 'left', x: 350, maxWidth: 350 - 200 - 8 })
    const right = others.find((slot) => slot.side === 'right')
    expect(right).toMatchObject({ maxWidth: 650 - (right?.x ?? 0) - 8 })
  })

  it('measures from the top-left of the area it is given, not of the window', () => {
    const inside = fanSlots({ x: 600, y: 600 }, { ...LEFT_ONLY, top: 500 })

    // The rungs at 448 to 504 are above 500 plus the margin; 532 and 560 are not.
    expect(inside.map((slot) => slot.top)).toEqual([532, 560])
  })

  it('has none when the button is nowhere near enough room', () => {
    expect(fanSlots({ x: 600, y: 10 }, WIDE)).toEqual([])
  })
})

let made = 0

function prompt(title: string): Prompt {
  made += 1

  return {
    id: `00000000-0000-4000-8000-${String(made).padStart(12, '0')}`,
    title,
    text: title,
    forPlan: false
  }
}

const five = ['p1', 'p2', 'p3', 'p4', 'p5'].map(prompt)
const [p1, p2, p3, p4, p5] = five as [Prompt, Prompt, Prompt, Prompt, Prompt]

const entry = (found: Prompt): { kind: 'prompt'; prompt: Prompt } => ({
  kind: 'prompt',
  prompt: found
})

describe('fanItems', () => {
  it('shows everything, with the way to settings last, when it all fits', () => {
    const { entries, rest } = fanItems(five, 8, { manage: true })

    expect(entries).toEqual([...five.map(entry), { kind: 'manage' }])
    expect(rest).toEqual([])
  })

  it('fits exactly when the prompts and the way to settings fill the slots', () => {
    const { entries, rest } = fanItems([p1, p2, p3], 4, { manage: true })

    expect(entries).toEqual([entry(p1), entry(p2), entry(p3), { kind: 'manage' }])
    expect(rest).toEqual([])
  })

  it('makes room for "more" and keeps settings last when one prompt too many', () => {
    const { entries, rest } = fanItems([p1, p2, p3, p4], 4, { manage: true })

    expect(entries).toEqual([entry(p1), entry(p2), { kind: 'more', count: 2 }, { kind: 'manage' }])
    expect(rest).toEqual([p3, p4])
  })

  it('shows the highest priority first and hands the rest to the list', () => {
    const { entries, rest } = fanItems(five, 4, { manage: true })

    expect(entries).toEqual([entry(p1), entry(p2), { kind: 'more', count: 3 }, { kind: 'manage' }])
    expect(rest).toEqual([p3, p4, p5])
  })

  it('has no way to settings, and a slot more for prompts, in the plan dialog', () => {
    const { entries, rest } = fanItems(five, 3, { manage: false })

    expect(entries).toEqual([entry(p1), entry(p2), { kind: 'more', count: 3 }])
    expect(rest).toEqual([p3, p4, p5])
  })

  it('is "more" alone when that is all the slots hold and there is no settings pill', () => {
    const { entries, rest } = fanItems(five, 1, { manage: false })

    expect(entries).toEqual([{ kind: 'more', count: 5 }])
    expect(rest).toEqual(five)
  })

  // Too few slots for "more" and settings both: the list takes over, and it has
  // a row for settings of its own.
  it('leaves everything to the list when "more" and settings cannot both fit', () => {
    const { entries, rest } = fanItems(five, 1, { manage: true })

    expect(entries).toEqual([])
    expect(rest).toEqual(five)
  })

  it('leaves everything to the list when there are no slots at all', () => {
    const { entries, rest } = fanItems(five, 0, { manage: true })

    expect(entries).toEqual([])
    expect(rest).toEqual(five)
  })

  it('is only the way to settings when there are no prompts', () => {
    expect(fanItems([], 3, { manage: true })).toEqual({
      entries: [{ kind: 'manage' }],
      rest: []
    })
    expect(fanItems([], 3, { manage: false })).toEqual({ entries: [], rest: [] })
  })
})
