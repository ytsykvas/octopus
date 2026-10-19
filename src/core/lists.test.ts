import { describe, expect, it } from 'vitest'

import { withMember } from './lists.js'

describe('withMember', () => {
  it('adds an item the list does not hold, at the end', () => {
    expect(withMember(['a'], 'b', true)).toEqual(['a', 'b'])
  })

  it('removes an item the list holds', () => {
    expect(withMember(['a', 'b'], 'a', false)).toEqual(['b'])
  })

  // An operation rather than a list: the same click landing twice is one
  // answer, not two copies.
  it('leaves a list that already says so as it was', () => {
    expect(withMember(['a', 'b'], 'a', true)).toEqual(['a', 'b'])
    expect(withMember(['a'], 'b', false)).toEqual(['a'])
  })
})
