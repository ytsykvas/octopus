/**
 * Picking a colour for a new project.
 *
 * The colour is what tells two projects apart at a glance — the tab strip
 * shows two letters and little else — so a new project should land on one
 * nobody else is using.
 */

import { z } from 'zod'

/**
 * Colours a project can be tagged with.
 *
 * A fixed palette rather than free-form hex: each value is declared twice in
 * the stylesheet, once per theme, and an arbitrary colour would either vanish
 * into the dark background or glare out of the light one.
 */
export const PROJECT_COLORS = [
  'blue',
  'violet',
  'pink',
  'rose',
  'amber',
  'green',
  'teal',
  'slate'
] as const

export const ProjectColorSchema = z.enum(PROJECT_COLORS)
export type ProjectColor = z.infer<typeof ProjectColorSchema>

/**
 * Where the search starts from.
 *
 * Named rather than indexed: `PROJECT_COLORS[0]` is `ProjectColor | undefined`
 * under `noUncheckedIndexedAccess`, and asserting it away is forbidden here.
 */
const FALLBACK: ProjectColor = 'blue'

/**
 * First colour not already in use, wrapping round when the palette runs out.
 *
 * Wrapping rather than failing: eight projects is not a limit worth enforcing,
 * and a repeated colour is a mild annoyance next to a refusal to add a project.
 * The wrap counts occurrences so the least-used colour comes up next, which
 * keeps duplicates spread out instead of piling onto the first entry.
 */
export function nextProjectColor(taken: readonly string[]): ProjectColor {
  const uses = new Map<string, number>()
  for (const colour of taken) uses.set(colour, (uses.get(colour) ?? 0) + 1)

  let best: ProjectColor = FALLBACK
  let fewest = Number.POSITIVE_INFINITY

  for (const colour of PROJECT_COLORS) {
    const count = uses.get(colour) ?? 0
    if (count === 0) return colour
    if (count < fewest) {
      fewest = count
      best = colour
    }
  }

  return best
}
