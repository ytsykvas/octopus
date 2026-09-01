import { describe, expect, it } from 'vitest'

import { isSkillName, SkillNameSchema, skillKey } from './skillNames.js'

describe('SkillNameSchema', () => {
  it('accepts the shape a skill directory is allowed to have', () => {
    for (const name of ['review', 'code-review', 'a', 'ship-it-2']) {
      expect(isSkillName(name)).toBe(true)
    }
  })

  /*
   * This string is joined onto a path and handed to a recursive delete, so the
   * pattern is the guard rather than a check further down. Each of these has a
   * different way of leaving the directory it is meant to name.
   */
  it('refuses anything that could name a directory somewhere else', () => {
    for (const name of ['..', '.', '../etc', 'a/b', 'a\\b', '.hidden', '', 'a..b']) {
      expect(isSkillName(name)).toBe(false)
    }
  })

  it('refuses the spellings that would be two names for one skill', () => {
    for (const name of ['Review', 'code_review', 'code review', '-review', 'review-', 'a--b']) {
      expect(isSkillName(name)).toBe(false)
    }
  })

  it('refuses a name too long to be a directory anyone reads', () => {
    expect(isSkillName('a'.repeat(64))).toBe(true)
    expect(isSkillName('a'.repeat(65))).toBe(false)
  })

  it('is the schema the renderer validates a field with', () => {
    expect(SkillNameSchema.safeParse('code-review').success).toBe(true)
  })
})

describe('skillKey', () => {
  /*
   * The bare name, wherever the skill came from — a fact about the agent
   * rather than a simplification of ours. Every source reaches a session the
   * same way, and measured against a live one, a skill of the same name in the
   * checkout and in our own store came back as a single row.
   */
  it('is the name the agent knows the skill by', () => {
    expect(skillKey('review')).toBe('review')
  })
})
