import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { usePendingIn } from './usePendingIn.js'

describe('usePendingIn', () => {
  it('holds an action for the workspace it started in and no other', () => {
    const { result } = renderHook(() => usePendingIn<'merge' | 'push'>())

    act(() => {
      result.current.start('planner/anna', 'merge')
    })

    expect(result.current.isPending('planner/anna', 'merge')).toBe(true)
    expect(result.current.isPending('planner/bruno', 'merge')).toBe(false)
    expect(result.current.isPending('planner/anna', 'push')).toBe(false)
  })

  it('lets one workspace finish without releasing another', () => {
    const { result } = renderHook(() => usePendingIn<'merge'>())

    act(() => {
      result.current.start('planner/anna', 'merge')
      result.current.start('planner/bruno', 'merge')
    })
    act(() => {
      result.current.finish('planner/anna', 'merge')
    })

    expect(result.current.isPending('planner/anna', 'merge')).toBe(false)
    expect(result.current.isPending('planner/bruno', 'merge')).toBe(true)
  })
})
