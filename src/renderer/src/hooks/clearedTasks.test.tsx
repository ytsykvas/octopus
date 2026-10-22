import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { clearTasks, useClearedTasks } from './clearedTasks.js'

// Module state outlives a test, so each test clears a conversation of its own.
describe('the tasks cleared from a map', () => {
  it('is nothing until something is cleared, and the same nothing on every read', () => {
    const { result, rerender } = renderHook(() => useClearedTasks('fresh'))
    const first = result.current

    rerender()

    expect(first.size).toBe(0)
    expect(result.current).toBe(first)
  })

  it('adds to what a conversation cleared before, and leaves the others alone', () => {
    const mine = renderHook(() => useClearedTasks('mine'))
    const other = renderHook(() => useClearedTasks('other'))
    const untouched = other.result.current

    act(() => {
      clearTasks('mine', ['t-1'])
    })
    act(() => {
      clearTasks('mine', ['t-2'])
    })

    expect([...mine.result.current]).toEqual(['t-1', 't-2'])
    expect(other.result.current).toBe(untouched)
  })

  it('stops telling a reader that left', () => {
    const { result, unmount } = renderHook(() => useClearedTasks('left'))
    const before = result.current

    unmount()
    clearTasks('left', ['t-1'])

    expect(result.current).toBe(before)
  })
})
