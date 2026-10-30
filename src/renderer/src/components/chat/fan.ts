import type { Prompt } from '@core/promptSchema.js'

/**
 * Where the pills of the prompt fan go, and which prompt goes in which.
 *
 * Pure, so the arithmetic is tested as numbers and the component only draws.
 * The fan is a quarter of a circle above and to the left of the button that
 * opened it — the button sits in the composer's top-right corner, which is
 * where the room is — with one pill on each rung of a ladder: the top rung
 * straight above the button and the lowest nearly level with it, each a little
 * further left, so the pills lie along the arc.
 */

/** The arc's radius: how far the top pill is above the button. */
export const FAN_RADIUS = 168
/** One rung: a 24 px pill and 4 px of air. */
export const FAN_ROW = 28
export const PILL_HEIGHT = 24
/** The narrowest a pill may be and still say something. */
export const PILL_MIN = 96
export const PILL_MAX = 220
/** What a pill keeps clear of the edge of the area it is drawn in. */
export const FAN_MARGIN = 8

/** The top-left of the area the fan is drawn in: the window, or the dialog it opened from. */
export interface FanBounds {
  readonly top: number
  readonly left: number
}

export interface FanSlot {
  /** Where the pill's right edge and its top are, in window coordinates. */
  readonly right: number
  readonly top: number
  /** As wide as the pill may grow before its title is cut short. */
  readonly maxWidth: number
  /** Where the button is from the pill's own place — where its flight starts. */
  readonly fromX: number
  readonly fromY: number
}

/**
 * Every slot of the fan that fits whole inside `bounds`, the highest first.
 *
 * A rung is kept only if the pill clears the top by the margin and the narrowest
 * pill clears the left by it. There is no check against the bottom or the right:
 * every rung is above and to the left of the button, which is itself inside the
 * area. When the top of the fan is cut off it is the **highest** rungs that go,
 * so the first prompt takes the highest rung that is left.
 */
export function fanSlots(anchor: { x: number; y: number }, bounds: FanBounds): FanSlot[] {
  const slots: FanSlot[] = []

  for (let rung = 0; FAN_RADIUS - rung * FAN_ROW > 0; rung += 1) {
    const height = FAN_RADIUS - rung * FAN_ROW
    const right = anchor.x - Math.round(Math.sqrt(FAN_RADIUS ** 2 - height ** 2))
    const top = anchor.y - height - PILL_HEIGHT / 2

    if (top < bounds.top + FAN_MARGIN) continue
    if (right - PILL_MIN < bounds.left + FAN_MARGIN) continue

    slots.push({
      right,
      top,
      maxWidth: Math.min(PILL_MAX, right - bounds.left - FAN_MARGIN),
      fromX: anchor.x - right,
      fromY: anchor.y - top - PILL_HEIGHT / 2
    })
  }

  return slots
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
