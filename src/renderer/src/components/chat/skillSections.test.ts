import { describe, expect, it } from 'vitest'

import { heldSkill, ownSkill } from '../../test/skills.js'
import { countIn, heldSections, ownSections, panelHeight } from './skillSections.js'

const ids = (sections: readonly { readonly id: string }[]): string[] =>
  sections.map((section) => section.id)

describe('cutting the skills into groups', () => {
  it('orders ours from what we own to what we only read, and skips the empty', () => {
    const sections = ownSections([
      ownSkill({ key: 'core-module', scope: 'repository' }),
      ownSkill({ key: 'review', scope: 'global' }),
      heldSkill()
    ])

    expect(ids(sections)).toEqual(['global', 'repository'])
    expect(sections[1]?.rows.map((skill) => skill.key)).toEqual(['core-module'])
  })

  it('orders Claude Code’s by where they came from, and leaves ours out', () => {
    const sections = heldSections([
      heldSkill({ key: 'pdf', source: 'synced' }),
      ownSkill(),
      heldSkill({ key: 'dataviz', source: 'builtin' })
    ])

    expect(ids(sections)).toEqual(['builtin', 'synced'])
  })

  it('counts the rows and the ones that are on', () => {
    const sections = ownSections([
      ownSkill({ key: 'a' }),
      ownSkill({ key: 'b', enabled: false }),
      ownSkill({ key: 'c', scope: 'project' })
    ])

    expect(countIn(sections)).toEqual({ total: 3, enabled: 2 })
  })
})

/*
 * The panel is anchored with this height before it draws, so it decides
 * whether the panel opens above or below the composer.
 */
describe('how tall the panel comes out', () => {
  const own = ownSections([ownSkill({ key: 'a' }), ownSkill({ key: 'b' })])
  const held = heldSections([
    heldSkill({ key: 'x' }),
    heldSkill({ key: 'y' }),
    heldSkill({ key: 'z', source: 'plugin' })
  ])

  // Chrome 84, then a 24px heading per group and 44px per row.
  it('is the chrome and our rows when Claude Code has nothing', () => {
    expect(panelHeight(own, [], false)).toBe(84 + 24 + 2 * 44)
  })

  it('counts a folded group as its heading alone', () => {
    expect(panelHeight(own, held, false)).toBe(84 + 24 + 2 * 44 + 24)
  })

  it('adds a subheading per source and every row once it is open', () => {
    expect(panelHeight(own, held, true)).toBe(84 + 24 + 2 * 44 + 24 + 2 * 20 + 3 * 44)
  })
})
