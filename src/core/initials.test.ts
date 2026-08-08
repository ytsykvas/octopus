import { describe, expect, it } from 'vitest'

import { initials } from './initials.js'

describe('initials', () => {
  it('takes the first letter of two words', () => {
    expect(initials('tsykvas-rails-template')).toBe('TR')
  })

  it('takes the first two letters of a single word', () => {
    expect(initials('truthnode')).toBe('TR')
  })

  it('treats spaces, underscores and dots as separators too', () => {
    expect(initials('my project')).toBe('MP')
    expect(initials('my_project')).toBe('MP')
    expect(initials('my.project')).toBe('MP')
  })

  it('ignores repeated separators', () => {
    expect(initials('my--project')).toBe('MP')
  })

  it('ignores surrounding whitespace', () => {
    expect(initials('  planner  ')).toBe('PL')
  })

  it('uppercases whatever it finds', () => {
    expect(initials('esl')).toBe('ES')
  })

  // A one-letter name has no second character to take.
  it('copes with a name shorter than the label', () => {
    expect(initials('x')).toBe('X')
  })

  // A name is validated as non-empty before it reaches here, but a label of
  // undefined would render as a blank tab rather than fail loudly.
  it('never returns nothing', () => {
    expect(initials('')).toBe('?')
    expect(initials('---')).toBe('?')
  })

  it('keeps non-Latin names readable', () => {
    expect(initials('проєкт')).toBe('ПР')
  })
})
