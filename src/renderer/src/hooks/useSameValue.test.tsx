import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { sameMap, sameSet, useSameValue } from './useSameValue.js'

describe('a value kept while it reads the same', () => {
  it('is the object it was last time, until it reads differently', () => {
    const first = new Set(['a'])
    const { result, rerender } = renderHook(({ value }) => useSameValue(value, sameSet), {
      initialProps: { value: first }
    })

    rerender({ value: new Set(['a']) })
    expect(result.current).toBe(first)

    const grown = new Set(['a', 'b'])
    rerender({ value: grown })
    expect(result.current).toBe(grown)
  })
})

describe('reading the same', () => {
  it('for a map, is the same keys with the same values', () => {
    const answer = ['yes']
    expect(sameMap(new Map([['q', answer]]), new Map([['q', answer]]))).toBe(true)
    expect(sameMap(new Map([['q', answer]]), new Map([['q', ['yes']]]))).toBe(false)
    expect(sameMap(new Map([['q', answer]]), new Map([['r', answer]]))).toBe(false)
    expect(sameMap(new Map([['q', answer]]), new Map())).toBe(false)
    const one = new Map([['q', answer]])
    expect(sameMap(one, one)).toBe(true)
  })

  it('for a set, is the same members', () => {
    expect(sameSet(new Set([1, 2]), new Set([2, 1]))).toBe(true)
    expect(sameSet(new Set([1, 2]), new Set([1, 3]))).toBe(false)
    expect(sameSet(new Set([1]), new Set([1, 2]))).toBe(false)
    const one = new Set([1])
    expect(sameSet(one, one)).toBe(true)
  })
})
