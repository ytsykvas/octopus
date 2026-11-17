import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useShownWorkspace } from './useShownWorkspace.js'

const anna = { id: 'planner/anna', name: 'anna' }
const refusal = {
  ok: false as const,
  error: 'refused',
  code: 'mergeFailed',
  params: { number: '7', reason: 'not mergeable' }
}

describe('useShownWorkspace', () => {
  it('answers for the workspace shown now, even through a function kept from before', () => {
    const { result, rerender } = renderHook(({ id }) => useShownWorkspace(id), {
      initialProps: { id: 'planner/anna' }
    })
    const kept = result.current
    expect(kept.isShown('planner/anna')).toBe(true)

    rerender({ id: 'planner/bruno' })

    expect(kept.isShown('planner/anna')).toBe(false)
    expect(kept.isShown('planner/bruno')).toBe(true)
  })

  it('says a refusal plainly while its workspace is the one shown', () => {
    const { result } = renderHook(() => useShownWorkspace('planner/anna'))

    expect(result.current.describeFailure(anna, refusal)).toBe(
      'GitHub would not merge #7. It said: not mergeable'
    )
  })

  it('names the workspace a refusal belongs to once another is shown', () => {
    const { result } = renderHook(() => useShownWorkspace('planner/bruno'))

    expect(result.current.describeFailure(anna, refusal)).toBe(
      'In anna: GitHub would not merge #7. It said: not mergeable'
    )
  })
})
