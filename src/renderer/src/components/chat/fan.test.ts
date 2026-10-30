import { describe, expect, it } from 'vitest'

import type { Prompt } from '@core/promptSchema.js'

import { fanItems, fanSlots, PILL_MAX } from './fan.js'

// Room for the left quarter and the top of the arc, none for the right quarter:
// the top pill is centred and needs 48 on either side of the anchor, and the
// right quarter's first pill needs 50 + 96 to its right.
const LEFT_ONLY = { top: 0, left: 0, right: 700 }
// Room all round, which is what lets the fan open as far as 3 o'clock.
const WIDE = { top: 0, left: 0, right: 1200 }

describe('fanSlots', () => {
  // The quarter of a circle above and to the left of the button, in the order a
  // clock is read: from 9 o'clock, nearly level with the button, up to 12,
  // straight above it. The arc is narrower than it is tall, so the two sides
  // stay close to the button and to each other.
  it('lays the left quarter from 9 o\u2019clock up to the top of the arc', () => {
    const slots = fanSlots({ x: 600, y: 600 }, LEFT_ONLY)

    expect(slots.map((slot) => slot.side)).toEqual(['left', 'left', 'left', 'left', 'center'])
    expect(slots.map((slot) => slot.x)).toEqual([518, 523, 533, 550, 600])
    expect(slots.map((slot) => slot.top)).toEqual([560, 532, 504, 476, 448])
  })

  // The rest of the half circle, 12 o'clock to 3, for when there are many: the
  // sweep goes on without a break, down the right side. The top of the arc is
  // shared, so each side has one rung fewer than the arc is tall.
  it('goes on round to 3 o\u2019clock when there is room on the right, top to bottom', () => {
    const slots = fanSlots({ x: 600, y: 600 }, WIDE)
    const right = slots.filter((slot) => slot.side === 'right')

    expect(slots).toHaveLength(9)
    expect(slots.slice(0, 5).map((slot) => slot.side)).toEqual([
      'left',
      'left',
      'left',
      'left',
      'center'
    ])
    expect(right.map((slot) => slot.x)).toEqual([650, 667, 677, 682])
    expect(right.map((slot) => slot.top)).toEqual([476, 504, 532, 560])
  })

  // Centred, so it bridges the two sides: anchored by an edge, it hung off one
  // of them and left the top of the arc open over the other.
  it('centres the pill at the top of the arc over the button, as wide as a pill may be', () => {
    const top = fanSlots({ x: 600, y: 600 }, WIDE)[4]

    expect(top).toEqual({
      side: 'center',
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

    expect(slots[0]).toMatchObject({ fromX: 600 - 518, fromY: 600 - 560 - 12 })
    expect(slots[5]).toMatchObject({ side: 'right', fromX: 600 - 650, fromY: 600 - 476 - 12 })
  })

  it('drops the pills that would run off the top, keeping the ones below', () => {
    const slots = fanSlots({ x: 600, y: 60 }, WIDE)

    expect(slots.map((slot) => slot.side)).toEqual(['left', 'right'])
    expect(slots.map((slot) => slot.top)).toEqual([20, 20])
  })

  it('keeps a pill whose top is exactly at the margin, and drops the rung above it', () => {
    // The top rung of this anchor sits at y - 152; the margin is 8.
    expect(fanSlots({ x: 600, y: 160 }, LEFT_ONLY).at(-1)).toMatchObject({
      side: 'center',
      top: 8
    })
    // The rung at 7 is gone, so the last one left is the next down: 159 - 112 - 12.
    expect(fanSlots({ x: 600, y: 159 }, LEFT_ONLY).at(-1)).toMatchObject({ side: 'left', top: 35 })
  })

  const onSide = (side: string, slots: readonly { side: string }[]): number =>
    slots.filter((slot) => slot.side === side).length

  it('drops the left pills too far left for the narrowest pill to fit', () => {
    // Only the first rung of the left quarter, 50 left of the anchor, clears it.
    expect(onSide('left', fanSlots({ x: 170, y: 600 }, WIDE))).toBe(1)
  })

  it('keeps a left pill whose edge is exactly at the margin', () => {
    // Narrowest pill is 96 wide and the margin 8, so its right edge may be 104.
    expect(onSide('left', fanSlots({ x: 154, y: 600 }, WIDE))).toBe(1)
    expect(onSide('left', fanSlots({ x: 153, y: 600 }, WIDE))).toBe(0)
  })

  it('drops the right pills too near the right edge, and keeps one exactly at the margin', () => {
    // A right pill starts at x and the narrowest is 96 wide: x + 96 <= right - 8.
    const bounds = (right: number): { top: number; left: number; right: number } => ({
      top: 0,
      left: 0,
      right
    })
    expect(onSide('right', fanSlots({ x: 600, y: 600 }, bounds(600 + 50 + 96 + 8)))).toBe(1)
    expect(onSide('right', fanSlots({ x: 600, y: 600 }, bounds(600 + 50 + 96 + 7)))).toBe(0)
  })

  it('keeps the top pill only where half the narrowest pill fits on either side', () => {
    expect(onSide('center', fanSlots({ x: 600, y: 600 }, { top: 0, left: 0, right: 656 }))).toBe(1)
    expect(onSide('center', fanSlots({ x: 600, y: 600 }, { top: 0, left: 0, right: 655 }))).toBe(0)
    expect(onSide('center', fanSlots({ x: 600, y: 600 }, { top: 0, left: 544, right: 1200 }))).toBe(
      1
    )
    expect(onSide('center', fanSlots({ x: 600, y: 600 }, { top: 0, left: 545, right: 1200 }))).toBe(
      0
    )
  })

  it('narrows a pill to the room it has, on either side of the top and on the right', () => {
    const slots = fanSlots({ x: 350, y: 600 }, { top: 0, left: 250, right: 560 })

    // Centred, so the nearer edge decides: 350 - 250 - 8 on the left, twice over.
    expect(slots.find((slot) => slot.side === 'center')).toMatchObject({ maxWidth: 184 })
    expect(slots.find((slot) => slot.side === 'right')).toMatchObject({
      x: 400,
      maxWidth: 560 - 400 - 8
    })
  })

  it('measures from the top-left of the area it is given, not of the window', () => {
    const inside = fanSlots({ x: 600, y: 600 }, { ...LEFT_ONLY, top: 500 })

    // The rungs at 448 to 504 are above 500 plus the margin; 532 and 560 are not.
    expect(inside.map((slot) => slot.top)).toEqual([560, 532])
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
