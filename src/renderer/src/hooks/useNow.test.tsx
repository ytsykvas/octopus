import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useNow } from './useNow.js'

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the time, for a clock that ticks', () => {
  it('moves every second while ticking', () => {
    const { result } = renderHook(() => useNow(true))

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(result.current).toBe(1_003_000)
  })

  // A map of finished agents left open should cost nothing.
  it('stands still while not ticking, and stops when told to', () => {
    const { result, rerender } = renderHook(({ ticking }) => useNow(ticking), {
      initialProps: { ticking: true }
    })

    rerender({ ticking: false })
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current).toBe(1_000_000)
  })
})
