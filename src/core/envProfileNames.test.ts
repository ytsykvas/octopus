import { describe, expect, it } from 'vitest'

import { DEFAULT_PROFILE, isProfileName, ProfileNameSchema } from './envProfileNames.js'

describe('what a set of variables may be called', () => {
  it('takes a lowercase name with digits and dashes', () => {
    expect(isProfileName('prod')).toBe(true)
    expect(isProfileName('staging-2')).toBe(true)
  })

  /*
   * Lowercase is a boundary rather than a style: the name becomes a filename,
   * and macOS filesystems are case-insensitive by default, so `Prod` and `prod`
   * would be one file under two names in `state.json`.
   */
  it('refuses a capital, which would be the same file under another name', () => {
    expect(isProfileName('Prod')).toBe(false)
  })

  // It is joined onto a path, so a separator and a leading dash have to be
  // impossible here rather than caught somewhere further down.
  it('refuses anything that would not be one path segment', () => {
    expect(isProfileName('')).toBe(false)
    expect(isProfileName('../escape')).toBe(false)
    expect(isProfileName('-leading')).toBe(false)
    expect(isProfileName('with space')).toBe(false)
    expect(isProfileName('a'.repeat(33))).toBe(false)
  })

  // The predicate and the schema are one rule, not two: the window asks the
  // first as a name is typed and the bridge parses with the second.
  it('answers the same as the schema it stands for', () => {
    expect(isProfileName('prod')).toBe(ProfileNameSchema.safeParse('prod').success)
    expect(isProfileName('Prod')).toBe(ProfileNameSchema.safeParse('Prod').success)
  })

  // `ProjectSchema.envProfile` defaults to it, so a record written before
  // profiles existed reads back pointing at the file the migration created.
  it('is a name a project may be given', () => {
    expect(isProfileName(DEFAULT_PROFILE)).toBe(true)
  })
})
