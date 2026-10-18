import {
  SESSION_SKILL_SOURCES,
  type SessionSkillSource,
  withholdable
} from '@core/sessionSkills.js'
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

/**
 * Whether a row's switch would do anything.
 *
 * Every row but a plugin's: Claude Code keeps a plugin's skill whatever
 * `skillOverrides` says, so that group is listed without switches and with a
 * line saying where a plugin is turned off instead.
 */
export function hasSwitch(skill: SkillListing): boolean {
  return skill.scope !== 'session' || withholdable(skill.source)
}

/** Whether the group needs the line saying its rows are switched elsewhere. */
export function switchedElsewhere(section: SkillSection<SessionSkillSource>): boolean {
  return !withholdable(section.id)
}

/** How many rows the groups hold, and how many of those are on. */
export function countIn(sections: readonly SkillSection<string>[]): {
  readonly total: number
  readonly enabled: number
} {
  const rows = sections.flatMap((section) => section.rows)

  return { total: rows.length, enabled: rows.filter((skill) => skill.enabled).length }
}

/*
 * Measured in the window, each rounded up: a row with a description is 49px, a
 * heading 29px, a source's subheading 25px. The chrome is the title, the note
 * — two lines at this width — the borders and the list's own padding.
 */
const ROW_HEIGHT = 50
const GROUP_HEADING = 30
const SUBHEADING = 25
/** The plugins' note, budgeted at two lines: it wraps at this width in Ukrainian. */
const ELSEWHERE_NOTE = 32
const PANEL_CHROME = 96
/** The list's `max-h-80`; past it the list scrolls rather than the panel growing. */
const LIST_CAP = 320

/**
 * The tallest the panel can become while it is open — every group unfolded,
 * up to the point where the list starts scrolling.
 *
 * The most rather than the current height, because folding happens after the
 * panel is placed: placed below the trigger for its folded height, it ran off
 * the bottom of the window the moment the group opened. Sized for the most it
 * can hold, it opens above whenever that would not fit below, pinned there by
 * its bottom edge (`useAnchoredPanel`) so the folded panel still meets the
 * trigger.
 */
export function panelHeight(
  own: readonly SkillSection<string>[],
  held: readonly SkillSection<SessionSkillSource>[]
): number {
  const headings = own.length * GROUP_HEADING + (held.length === 0 ? 0 : GROUP_HEADING)
  const subheadings = held.length * SUBHEADING
  const notes = held.filter(switchedElsewhere).length * ELSEWHERE_NOTE
  const rows = (countIn(own).total + countIn(held).total) * ROW_HEIGHT

  return PANEL_CHROME + Math.min(LIST_CAP, headings + subheadings + notes + rows)
}
