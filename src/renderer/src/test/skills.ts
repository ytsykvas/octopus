import type { OwnSkillScope } from '@core/skillNames.js'
import type { SkillListing } from '@core/skills.js'

type OwnListing = Extract<SkillListing, { scope: OwnSkillScope }>
type HeldListing = Extract<SkillListing, { scope: 'session' }>

/** A skill octopus reads from disk itself — ours everywhere, unless told otherwise. */
export function ownSkill(overrides: Partial<OwnListing> = {}): OwnListing {
  return {
    key: 'review',
    name: 'review',
    description: 'When reviewing.',
    scope: 'global',
    enabled: true,
    ...overrides
  }
}

/** A skill only the running session reports — one of Claude Code's own, unless told otherwise. */
export function heldSkill(overrides: Partial<HeldListing> = {}): HeldListing {
  return {
    key: 'dataviz',
    name: 'dataviz',
    description: 'Charts.',
    scope: 'session',
    source: 'builtin',
    enabled: true,
    ...overrides
  }
}
