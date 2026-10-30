import { describe, expect, it } from 'vitest'

import type { Prompt } from '@core/promptSchema.js'

import { fanItems, fanSlots, PILL_MAX } from './fan.js'

const WIDE = { top: 0, left: 0 }

describe('fanSlots', () => {
  // The quarter of a circle above and to the left of the button, which is where
  // there is room in the composer's corner: a pill on each of six rungs, the top
  // one straight above and the lowest nearly level with it.
  it('lays six pills on the arc when there is room all round', () => {
    const slots = fanSlots({ x: 600, y: 600 }, WIDE)

    expect(slots.map((slot) => slot.right)).toEqual([600, 507, 475, 455, 442, 434])
    expect(slots.map((slot) => slot.top)).toEqual([420, 448, 476, 504, 532, 560])
  })

  it('starts the first pill straight above the button, as wide as a pill may be', () => {
    const [first] = fanSlots({ x: 600, y: 600 }, WIDE)

    expect(first).toEqual({ right: 600, top: 420, maxWidth: PILL_MAX, fromX: 0, fromY: 168 })
  })

  // Each pill flies out of the button, so its offset is where the button is
  // from the pill's own place.
  it('measures each pill’s flight from the button’s centre', () => {
    const slots = fanSlots({ x: 600, y: 600 }, WIDE)
    const last = slots[5]

    expect(last).toMatchObject({ fromX: 600 - 434, fromY: 600 - 560 - 12 })
  })

  it('drops the pills that would run off the top, keeping the ones below', () => {
    const slots = fanSlots({ x: 600, y: 60 }, WIDE)

    expect(slots).toHaveLength(1)
    expect(slots[0]).toMatchObject({ top: 20 })
  })

  it('keeps a pill whose top is exactly at the margin, and drops one a pixel above', () => {
    // The top slot of this anchor sits at y - 180; the margin is 8.
    expect(fanSlots({ x: 600, y: 188 }, WIDE)[0]).toMatchObject({ top: 8, right: 600 })
    // The rung at 7 is gone, so the first one left is the next down: 187 - 140 - 12.
    expect(fanSlots({ x: 600, y: 187 }, WIDE)[0]).toMatchObject({ top: 35 })
  })

  it('drops the pills too far left for the narrowest pill to fit', () => {
    const slots = fanSlots({ x: 150, y: 600 }, WIDE)

    expect(slots).toHaveLength(1)
    expect(slots[0]).toMatchObject({ right: 150 })
  })

  it('keeps a pill whose left edge is exactly at the margin', () => {
    // Narrowest pill is 96 wide and the margin 8, so the right edge may be 104.
    expect(fanSlots({ x: 104, y: 600 }, WIDE)).toHaveLength(1)
    expect(fanSlots({ x: 103, y: 600 }, WIDE)).toHaveLength(0)
  })

  it('narrows a pill to the room it has on the left', () => {
    const [first] = fanSlots({ x: 350, y: 600 }, { top: 0, left: 200 })

    expect(first).toMatchObject({ right: 350, maxWidth: 350 - 200 - 8 })
  })

  it('measures from the top-left of the area it is given, not of the window', () => {
    const inside = fanSlots({ x: 600, y: 600 }, { top: 500, left: 0 })

    // The rungs at 420 to 504 are above 500 plus the margin; 532 and 560 are not.
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
