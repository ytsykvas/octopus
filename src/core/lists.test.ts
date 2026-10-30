import { describe, expect, it } from 'vitest'

import { movedTo, withMember } from './lists.js'

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

describe('movedTo', () => {
  it('takes an item out and puts it back further down', () => {
    expect(movedTo(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })

  it('and further up', () => {
    expect(movedTo(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  // A copy even when nothing moves: a caller may hold the result as state.
  it('hands back a copy when the item stays where it is', () => {
    const list = ['a', 'b']
    const same = movedTo(list, 1, 1)

    expect(same).toEqual(['a', 'b'])
    expect(same).not.toBe(list)
  })

  it('leaves the list alone for a position it does not have', () => {
    expect(movedTo(['a', 'b'], -1, 0)).toEqual(['a', 'b'])
    expect(movedTo(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(movedTo(['a', 'b'], 2, 0)).toEqual(['a', 'b'])
    expect(movedTo(['a', 'b'], 0, 2)).toEqual(['a', 'b'])
  })
})
