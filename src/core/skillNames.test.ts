import { describe, expect, it } from 'vitest'

import {
  GLOBAL_PLUGIN,
  isSkillName,
  PROJECT_PLUGIN,
  SkillNameSchema,
  SkillScopeSchema,
  skillKey
} from './skillNames.js'

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
   * The CLI looks an override up by the qualified name and falls back to the
   * bare one. So a bare key written for one of ours would silence a
   * repository skill that happens to share the name — which is why the two
   * stores qualify and only the checkout's does not.
   */
  it('qualifies our own skills by the plugin they arrive in', () => {
    expect(skillKey('global', 'review')).toBe(`${GLOBAL_PLUGIN}:review`)
    expect(skillKey('project', 'review')).toBe(`${PROJECT_PLUGIN}:review`)
  })

  it("leaves the checkout's own skills bare, because nothing qualifies them", () => {
    expect(skillKey('repository', 'review')).toBe('review')
  })

  it('gives the three scopes three different keys for one name', () => {
    const keys = SkillScopeSchema.options.map((scope) => skillKey(scope, 'review'))
    expect(new Set(keys).size).toBe(keys.length)
  })
})
