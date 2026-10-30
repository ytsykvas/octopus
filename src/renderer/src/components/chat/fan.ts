import type { Prompt } from '@core/promptSchema.js'

/**
 * Where the pills of the prompt fan go, and which prompt goes in which.
 *
 * Pure, so the arithmetic is tested as numbers and the component only draws.
 * The fan opens on a circle round the button that opened it — which sits in the
 * composer's top-right corner — with one pill on each rung of a ladder.
 *
 * **Read the way a clock is, from 9 o'clock round to 3**, one unbroken sweep: up
 * the left quarter from the rung nearly level with the button to the one
 * straight above it, then down the right quarter. The fan fills that sweep in
 * the order of the prompts and stops where they do, so a few prompts sit on the
 * left and many go on round to the right. Turning back at 12 and starting the
 * right side again from the top was tried, and read as two piles, not one fan.
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
}

/** Which part of the arc: the top of it is centred over the button. */
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

/**
 * Every slot of the fan that fits whole inside `bounds`, clockwise from 9
 * o'clock: up the left quarter, then down the right.
 *
 * A rung is kept only if the pill clears the top by the margin and the
 * narrowest pill clears the edge it grows towards — the left on the left half,
 * the right on the right. There is no check against the bottom: every rung is
 * above the button, which is itself inside the area. A rung that does not fit
 * is left out of the sweep, and the sweep carries on past it.
 */
export function fanSlots(anchor: { x: number; y: number }, bounds: FanBounds): FanSlot[] {
  const left: FanSlot[] = []
  const right: FanSlot[] = []
  let center: FanSlot | null = null

  for (let rung = 0; FAN_RADIUS - rung * FAN_ROW > 0; rung += 1) {
    const height = FAN_RADIUS - rung * FAN_ROW
    const across = Math.round(Math.sqrt(FAN_RADIUS ** 2 - height ** 2) * FAN_SPREAD)
    const top = anchor.y - height - PILL_HEIGHT / 2
    const fromY = anchor.y - top - PILL_HEIGHT / 2

    if (top < bounds.top + FAN_MARGIN) continue

    if (rung === 0) {
      // Centred, so half the narrowest pill has to fit on either side of it.
      const room = Math.min(
        anchor.x - bounds.left - FAN_MARGIN,
        bounds.right - FAN_MARGIN - anchor.x
      )
      if (room >= PILL_MIN / 2) {
        center = {
          side: 'center',
          x: anchor.x,
          top,
          maxWidth: Math.min(PILL_MAX, room * 2),
          fromX: 0,
          fromY
        }
      }
      continue
    }

    const leftX = anchor.x - across
    if (leftX - PILL_MIN >= bounds.left + FAN_MARGIN) {
      left.push({
        side: 'left',
        x: leftX,
        top,
        maxWidth: Math.min(PILL_MAX, leftX - bounds.left - FAN_MARGIN),
        fromX: anchor.x - leftX,
        fromY
      })
    }

    const rightX = anchor.x + across
    if (rightX + PILL_MIN <= bounds.right - FAN_MARGIN) {
      right.push({
        side: 'right',
        x: rightX,
        top,
        maxWidth: Math.min(PILL_MAX, bounds.right - rightX - FAN_MARGIN),
        fromX: anchor.x - rightX,
        fromY
      })
    }
  }

  // Built from the top rung down; the left quarter is read upwards to the top.
  return [...left.reverse(), ...(center === null ? [] : [center]), ...right]
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
