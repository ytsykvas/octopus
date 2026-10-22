import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useLatest } from './useLatest.js'

describe('useLatest', () => {
  it('holds the value from the first render, and the newest after each commit', () => {
    const { result, rerender } = renderHook(({ value }) => useLatest(value), {
      initialProps: { value: 'first' }
    })
    const ref = result.current
    expect(ref.current).toBe('first')

    rerender({ value: 'second' })

    // The same ref, so a listener that read it once keeps reading the newest.
    expect(result.current).toBe(ref)
    expect(ref.current).toBe('second')
  })
})
