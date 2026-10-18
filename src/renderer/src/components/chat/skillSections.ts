import { SESSION_SKILL_SOURCES, type SessionSkillSource } from '@core/sessionSkills.js'
import type { OwnSkillScope } from '@core/skillNames.js'
import type { SkillListing } from '@core/skills.js'

/**
 * How the skills panel cuts its list into groups, and how tall that comes out.
 *
 * Apart from the component so the rules are tested as rules: which groups are
 * drawn, in what order, and the height the panel is anchored with — which is
 * otherwise a sum hidden in a click handler.
 */

/**
 * The three scopes octopus reads itself, in the order the panel draws them.
 *
 * The first two are ours and edited in settings, the third is what the
 * checkout carries — the order goes from what we own to what we only read.
 */
export const OWN_SKILL_SCOPES = [
  'global',
  'project',
  'repository'
] as const satisfies readonly OwnSkillScope[]

/** One group of rows, named by whatever it was grouped on. */
export interface SkillSection<Id extends string> {
  readonly id: Id
  readonly rows: readonly SkillListing[]
}

/**
 * The rows under each id, in the ids' order, and only the groups that have any.
 *
 * A group with nothing in it is not drawn: most projects have no skills of
 * their own, and an empty heading is a promise the interface is not keeping.
 */
function sectionsBy<Id extends string>(
  ids: readonly Id[],
  skills: readonly SkillListing[],
  idOf: (skill: SkillListing) => string | null
): SkillSection<Id>[] {
  return ids
    .map((id) => ({ id, rows: skills.filter((skill) => idOf(skill) === id) }))
    .filter((section) => section.rows.length > 0)
}

/** Ours and the checkout's, by scope. */
export function ownSections(skills: readonly SkillListing[]): SkillSection<OwnSkillScope>[] {
  return sectionsBy(OWN_SKILL_SCOPES, skills, (skill) => skill.scope)
}

/** Claude Code's own, by where the session says each came from. */
export function heldSections(skills: readonly SkillListing[]): SkillSection<SessionSkillSource>[] {
  return sectionsBy(SESSION_SKILL_SOURCES, skills, (skill) =>
    skill.scope === 'session' ? skill.source : null
  )
}

/** How many rows the groups hold, and how many of those are on. */
export function countIn(sections: readonly SkillSection<string>[]): {
  readonly total: number
  readonly enabled: number
} {
  const rows = sections.flatMap((section) => section.rows)

  return { total: rows.length, enabled: rows.filter((skill) => skill.enabled).length }
}

const ROW_HEIGHT = 44
const GROUP_HEADING = 24
const SUBHEADING = 20
/** The title above the list and the note below it. */
const PANEL_CHROME = 84

/**
 * The panel's height, given at the moment of opening so it can be flipped and
 * clamped against the window.
 *
 * The folded group is one heading tall; open, it adds a subheading per source
 * and its rows. The list scrolls past a cap of its own, so a group opened after
 * the panel is placed grows inside it and nothing has to be placed again.
 */
export function panelHeight(
  own: readonly SkillSection<string>[],
  held: readonly SkillSection<string>[],
  heldOpen: boolean
): number {
  const ownHeight = own.length * GROUP_HEADING + countIn(own).total * ROW_HEIGHT

  const heldHeight =
    held.length === 0
      ? 0
      : GROUP_HEADING + (heldOpen ? held.length * SUBHEADING + countIn(held).total * ROW_HEIGHT : 0)

  return PANEL_CHROME + ownHeight + heldHeight
}
