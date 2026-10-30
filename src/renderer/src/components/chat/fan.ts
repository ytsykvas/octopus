import type { Prompt } from '@core/promptSchema.js'

/**
 * Where the pills of the prompt fan go, and which prompt goes in which.
 *
 * Pure, so the arithmetic is tested as numbers and the component only draws.
 * The fan is a circle round the button that opened it, one pill on each row,
 * read the way a clock is: **from 9 o'clock round, one unbroken sweep** — up
 * the left to 12, down the right past 3 to 6, straight below the button, and up
 * the left again to just under 9. The prompts fill it in their order and stop
 * where they do; what the window has no room for goes behind "More".
 *
 * Two earlier shapes taught the rest. Running from 12 down to 9 and starting the
 * right side again from the top read as two piles. So did a round arc read in
 * the right order: each side's pills grow outwards from the button, and with
 * nothing over it the sides sat far apart — hence the centred pills at 12 and 6,
 * and a circle narrower than it is tall.
 */

/**
 * The arc's radius: how far the top pill is above the button.
 *
 * A pill and its air are 28 px, so the radius is also how many rungs a quarter
 * holds — five at 140. Nearer the button holds fewer, and further holds more but
 * reaches further from the control it belongs to.
 */
export const FAN_RADIUS = 140
/**
 * How far out the arc reaches sideways, against how high it reaches: an arc
 * narrower than it is tall keeps the two sides near the button and near each
 * other. A round one put them so far apart either side of the button that, with
 * the pills growing outwards from it, the fan read as two piles.
 */
export const FAN_SPREAD = 0.6
/** One rung: a 24 px pill and 4 px of air. */
export const FAN_ROW = 28
export const PILL_HEIGHT = 24
/** The narrowest a pill may be and still say something. */
export const PILL_MIN = 96
export const PILL_MAX = 220
/** What a pill keeps clear of the edge of the area it is drawn in. */
export const FAN_MARGIN = 8

/** The area the fan is drawn in: the window, or the dialog it opened from. */
export interface FanBounds {
  readonly top: number
  readonly left: number
  readonly right: number
  readonly bottom: number
}

/** Which part of the circle: its top and its bottom are centred on the button. */
export type FanSide = 'left' | 'center' | 'right'

export interface FanSlot {
  /** Which half of the circle: it decides which edge of the pill sits on `x`. */
  readonly side: FanSide
  /**
   * Where the pill is fixed, in window coordinates: its **right** edge on the
   * left half, so it grows away from the button, its **left** edge on the right
   * half, for the same reason, and its **centre** at the top of the arc, so it
   * spans both sides and joins them.
   */
  readonly x: number
  readonly top: number
  /** As wide as the pill may grow before its title is cut short. */
  readonly maxWidth: number
  /** Where the button is from the pill's own place — where its flight starts. */
  readonly fromX: number
  readonly fromY: number
}

/** One row of the circle, `height` above the button's centre (below, if negative). */
function row(anchor: { x: number; y: number }, height: number): { top: number; across: number } {
  return {
    top: anchor.y - height - PILL_HEIGHT / 2,
    across: Math.round(Math.sqrt(FAN_RADIUS ** 2 - height ** 2) * FAN_SPREAD)
  }
}

/**
 * Every slot of the fan that fits whole inside `bounds`, clockwise from 9
 * o'clock.
 *
 * A slot is kept only if its pill clears the top and the bottom of the area by
 * the margin, and the narrowest pill clears the edge it grows towards — the
 * left on the left side, the right on the right, both for a centred one. A slot
 * that does not fit is left out of the sweep, and the sweep carries on past it.
 */
export function fanSlots(anchor: { x: number; y: number }, bounds: FanBounds): FanSlot[] {
  const fitsUpright = (top: number): boolean =>
    top >= bounds.top + FAN_MARGIN && top + PILL_HEIGHT <= bounds.bottom - FAN_MARGIN

  const slot = (side: FanSide, height: number): FanSlot | null => {
    const { top, across } = row(anchor, height)
    if (!fitsUpright(top)) return null

    const fromY = anchor.y - top - PILL_HEIGHT / 2

    if (side === 'center') {
      // Centred, so half the narrowest pill has to fit on either side of it.
      const room = Math.min(
        anchor.x - bounds.left - FAN_MARGIN,
        bounds.right - FAN_MARGIN - anchor.x
      )
      if (room < PILL_MIN / 2) return null
      return { side, x: anchor.x, top, maxWidth: Math.min(PILL_MAX, room * 2), fromX: 0, fromY }
    }

    if (side === 'left') {
      const x = anchor.x - across
      if (x - PILL_MIN < bounds.left + FAN_MARGIN) return null
      const maxWidth = Math.min(PILL_MAX, x - bounds.left - FAN_MARGIN)
      return { side, x, top, maxWidth, fromX: anchor.x - x, fromY }
    }

    const x = anchor.x + across
    if (x + PILL_MIN > bounds.right - FAN_MARGIN) return null
    const maxWidth = Math.min(PILL_MAX, bounds.right - x - FAN_MARGIN)
    return { side, x, top, maxWidth, fromX: anchor.x - x, fromY }
  }

  // The rows, 28 apart from the top of the circle to its bottom. The two ends
  // are a single centred pill each; every row between has a pill on either side.
  const heights: number[] = []
  for (let height = FAN_RADIUS; height >= -FAN_RADIUS; height -= FAN_ROW) heights.push(height)
  const sides = heights.slice(1, -1)
  const upward = (from: number, to: number): number[] =>
    sides.filter((height) => height >= from && height <= to).toReversed()

  const sweep: (FanSlot | null)[] = [
    // Up the left from 9 o'clock to just under 12.
    ...upward(0, FAN_RADIUS).map((height) => slot('left', height)),
    slot('center', FAN_RADIUS),
    // Down the right from just past 12, by 3, to just above 6.
    ...sides.map((height) => slot('right', height)),
    slot('center', -FAN_RADIUS),
    // Up the left again from just past 6 to just under 9.
    ...upward(-FAN_RADIUS, -1).map((height) => slot('left', height))
  ]

  return sweep.filter((kept): kept is FanSlot => kept !== null)
}

export type FanEntry =
  | { readonly kind: 'prompt'; readonly prompt: Prompt }
  /** The pill that opens the list of what did not fit, and how many that is. */
  | { readonly kind: 'more'; readonly count: number }
  | { readonly kind: 'manage' }

/**
 * What goes into the slots, in priority order, and what is left for the list.
 *
 * The prompts come first, in the order given; when they do not all fit, the
 * last slots go to "more" and, in the composer, to the way to settings — which
 * is always the last pill, so it is in the same place however many prompts
 * there are. When there is not room for both of those, `entries` is empty and
 * the whole of `rest` is the list's: a fan of one pill that only says "more"
 * would be a button with a button inside it.
 */
export function fanItems(
  prompts: readonly Prompt[],
  slots: number,
  options: { readonly manage: boolean }
): { readonly entries: FanEntry[]; readonly rest: Prompt[] } {
  const manage: FanEntry[] = options.manage ? [{ kind: 'manage' }] : []
  const asEntries = (shown: readonly Prompt[]): FanEntry[] =>
    shown.map((prompt) => ({ kind: 'prompt', prompt }))

  if (prompts.length + manage.length <= slots) {
    return { entries: [...asEntries(prompts), ...manage], rest: [] }
  }

  // "More", and the way to settings if there is one, are not optional once
  // something does not fit — and without room for both, the list is the answer.
  if (slots < manage.length + 1) return { entries: [], rest: [...prompts] }

  const shown = prompts.slice(0, slots - manage.length - 1)

  return {
    entries: [
      ...asEntries(shown),
      { kind: 'more', count: prompts.length - shown.length },
      ...manage
    ],
    rest: prompts.slice(shown.length)
  }
}
