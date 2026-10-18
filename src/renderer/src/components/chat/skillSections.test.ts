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
 * The panel is placed with this height before it draws, so it decides whether
 * the panel opens above or below the composer. It is the most the panel can
 * grow to — a group unfolded after placing must not run off the window.
 */
describe('how tall the panel can grow', () => {
  const own = ownSections([ownSkill({ key: 'a' }), ownSkill({ key: 'b' })])
  const held = heldSections([
    heldSkill({ key: 'x' }),
    heldSkill({ key: 'y' }),
    heldSkill({ key: 'z', source: 'plugin' })
  ])

  // Chrome 96, then 30px per group heading, 25px per source and 50px per row.
  it('is the chrome and our rows when Claude Code has nothing', () => {
    expect(panelHeight(own, [])).toBe(96 + 30 + 2 * 50)
  })

  it('counts Claude Code’s group as though it were open', () => {
    expect(panelHeight(own.slice(0, 0), held.slice(0, 1))).toBe(96 + 30 + 25 + 2 * 50)
  })

  it('stops where the list starts scrolling', () => {
    expect(panelHeight(own, held)).toBe(96 + 320)
  })
})
