import { describe, expect, it } from 'vitest'

import type { Prompt } from '@core/promptSchema.js'

import { fanItems, type FanSlot, fanSlots, PILL_MAX } from './fan.js'

// Room for the upper-left quarter and the top of the circle only: nothing below
// the button's row, and too little on the right for the right side.
const LEFT_ONLY = { top: 0, left: 0, right: 700, bottom: 600 }
// The upper half, 9 o'clock round to 3: room on either side, none below.
const HALF = { top: 0, left: 0, right: 1200, bottom: 600 }
// Room all round, for the whole circle.
const WIDE = { top: 0, left: 0, right: 1200, bottom: 1200 }

const sides = (slots: readonly FanSlot[]): string[] => slots.map((slot) => slot.side)
const onSide = (side: string, slots: readonly FanSlot[]): number =>
  slots.filter((slot) => slot.side === side).length

describe('fanSlots', () => {
  // The quarter of a circle above and to the left of the button, in the order a
  // clock is read: up from 9 o'clock to 12, straight above it. The circle is
  // narrower than it is tall, so the pills stay near the button.
  it('lays the upper-left quarter up to the top of the circle', () => {
    const slots = fanSlots({ x: 600, y: 600 }, LEFT_ONLY)

    expect(sides(slots)).toEqual(['left', 'left', 'left', 'left', 'center'])
    expect(slots.map((slot) => slot.x)).toEqual([518, 523, 533, 550, 600])
    expect(slots.map((slot) => slot.top)).toEqual([560, 532, 504, 476, 448])
  })

  it('goes on down the right as far as 3 o\u2019clock when there is room on the right', () => {
    const slots = fanSlots({ x: 600, y: 600 }, HALF)
    const right = slots.filter((slot) => slot.side === 'right')

    expect(slots).toHaveLength(9)
    expect(right.map((slot) => slot.x)).toEqual([650, 667, 677, 682])
    expect(right.map((slot) => slot.top)).toEqual([476, 504, 532, 560])
  })

  // The whole circle, clockwise from 9 o'clock, one unbroken sweep: up the left
  // to 12, down the right past 3 to 6, straight below the button, and up the
  // left again to just under 9. The rows are 28 apart, and the one level with
  // the button is the first and the middle of the right side.
  it('goes all the way round when there is room all round', () => {
    const slots = fanSlots({ x: 600, y: 600 }, WIDE)

    expect(sides(slots)).toEqual([
      ...Array<string>(5).fill('left'),
      'center',
      ...Array<string>(9).fill('right'),
      'center',
      ...Array<string>(4).fill('left')
    ])
    expect(slots.map((slot) => slot.top)).toEqual([
      588, 560, 532, 504, 476, 448, 476, 504, 532, 560, 588, 616, 644, 672, 700, 728, 700, 672, 644,
      616
    ])
    expect(slots.map((slot) => slot.x)).toEqual([
      516, 518, 523, 533, 550, 600, 650, 667, 677, 682, 684, 682, 677, 667, 650, 600, 550, 533, 523,
      518
    ])
  })

  // Centred, so it bridges the two sides: anchored by an edge, it hung off one
  // of them and left the top of the circle open over the other.
  it('centres the pill at the top of the circle over the button, as wide as a pill may be', () => {
    const top = fanSlots({ x: 600, y: 600 }, HALF)[4]

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
  // from the pill's own place — on the right that is to the left of it, and
  // below the button it is above it.
  it('measures each pill\u2019s flight from the button\u2019s centre, wherever it is', () => {
    const half = fanSlots({ x: 600, y: 600 }, HALF)
    const whole = fanSlots({ x: 600, y: 600 }, WIDE)

    expect(half[0]).toMatchObject({ fromX: 600 - 518, fromY: 600 - 560 - 12 })
    expect(half[5]).toMatchObject({ side: 'right', fromX: 600 - 650, fromY: 600 - 476 - 12 })
    expect(whole[15]).toMatchObject({ side: 'center', fromX: 0, fromY: -140 })
  })

  it('drops the pills that would run off the top, and keeps the rest of the circle', () => {
    const slots = fanSlots({ x: 600, y: 60 }, WIDE)

    expect(slots.every((slot) => slot.top >= 8)).toBe(true)
    // The highest row left is 28 above the button: 60 - 28 - 12.
    expect(Math.min(...slots.map((slot) => slot.top))).toBe(20)
    expect(onSide('center', slots)).toBe(1)
  })

  it('drops the pills that would run past the bottom, and keeps one exactly at the margin', () => {
    // The row level with the button runs from 588 to 612; the margin is 8.
    const fits = fanSlots({ x: 600, y: 600 }, { ...HALF, bottom: 620 })
    expect(fits.map((slot) => slot.top)).toContain(588)
    expect(Math.max(...fits.map((slot) => slot.top))).toBe(588)

    const short = fanSlots({ x: 600, y: 600 }, { ...HALF, bottom: 619 })
    expect(Math.max(...short.map((slot) => slot.top))).toBe(560)
  })

  it('keeps a pill whose top is exactly at the margin, and drops the row above it', () => {
    // The top of this circle sits at y - 152; the bottom of it at y + 128.
    const centres = (y: number): number[] =>
      fanSlots({ x: 600, y }, WIDE)
        .filter((slot) => slot.side === 'center')
        .map((slot) => slot.top)

    expect(centres(160)).toEqual([8, 288])
    expect(centres(159)).toEqual([287])
  })

  it('drops the left pills too far left for the narrowest pill to fit', () => {
    // Only the rows furthest above and below, 50 left of the anchor, clear it.
    expect(onSide('left', fanSlots({ x: 170, y: 600 }, WIDE))).toBe(2)
  })

  it('keeps a left pill whose edge is exactly at the margin', () => {
    // Narrowest pill is 96 wide and the margin 8, so its right edge may be 104.
    expect(onSide('left', fanSlots({ x: 154, y: 600 }, WIDE))).toBe(2)
    expect(onSide('left', fanSlots({ x: 153, y: 600 }, WIDE))).toBe(0)
  })

  it('drops the right pills too near the right edge, and keeps one exactly at the margin', () => {
    // A right pill starts at x and the narrowest is 96 wide: x + 96 <= right - 8.
    const right = (edge: number): number =>
      onSide('right', fanSlots({ x: 600, y: 600 }, { ...WIDE, right: edge }))

    expect(right(600 + 50 + 96 + 8)).toBe(2)
    expect(right(600 + 50 + 96 + 7)).toBe(0)
  })

  it('keeps a centred pill only where half the narrowest pill fits on either side', () => {
    const centres = (bounds: Partial<typeof WIDE>): number =>
      onSide('center', fanSlots({ x: 600, y: 600 }, { ...WIDE, ...bounds }))

    expect(centres({ right: 656 })).toBe(2)
    expect(centres({ right: 655 })).toBe(0)
    expect(centres({ left: 544 })).toBe(2)
    expect(centres({ left: 545 })).toBe(0)
  })

  it('narrows a pill to the room it has, on either side of a centre and on the right', () => {
    const slots = fanSlots({ x: 350, y: 600 }, { top: 0, left: 250, right: 560, bottom: 1200 })

    // Centred, so the nearer edge decides: 350 - 250 - 8 on the left, twice over.
    expect(slots.find((slot) => slot.side === 'center')).toMatchObject({ maxWidth: 184 })
    expect(slots.find((slot) => slot.side === 'right')).toMatchObject({
      x: 400,
      maxWidth: 560 - 400 - 8
    })
  })

  it('measures from the edges of the area it is given, not of the window', () => {
    const inside = fanSlots({ x: 600, y: 600 }, { ...LEFT_ONLY, top: 500 })

    // The rows at 448 to 504 are above 500 plus the margin; 532 and 560 are not.
    expect(inside.map((slot) => slot.top)).toEqual([560, 532])
  })

  it('has none when there is no room at all', () => {
    expect(fanSlots({ x: 0, y: 0 }, { top: 0, left: 0, right: 0, bottom: 0 })).toEqual([])
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
