import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useAttachedFiles } from './useAttachedFiles.js'

const ANNA = 'planner/anna'
const BOB = 'planner/bob'

describe('the files each conversation will name', () => {
  it('holds each conversation’s files apart', () => {
    const { result } = renderHook(() => useAttachedFiles(ANNA))

    act(() => {
      result.current.add('first', ['/w/a.ts'])
      result.current.add('chat-2', ['/w/b.ts'])
    })

    expect(result.current.filesFor('first')).toEqual(['/w/a.ts'])
    expect(result.current.filesFor('chat-2')).toEqual(['/w/b.ts'])
    expect(result.current.filesFor('chat-3')).toEqual([])
  })

  it('holds each workspace’s files apart, and none without a workspace', () => {
    const start: { id: string | null } = { id: ANNA }
    const { result, rerender } = renderHook(({ id }) => useAttachedFiles(id), {
      initialProps: start
    })
    act(() => {
      result.current.add('first', ['/w/a.ts'])
    })

    rerender({ id: BOB })
    expect(result.current.filesFor('first')).toEqual([])

    rerender({ id: null })
    act(() => {
      result.current.add('first', ['/w/b.ts'])
    })
    expect(result.current.filesFor('first')).toEqual([])

    rerender({ id: ANNA })
    expect(result.current.filesFor('first')).toEqual(['/w/a.ts'])
  })

  it('takes the same file once, in the order added', () => {
    const { result } = renderHook(() => useAttachedFiles(ANNA))

    act(() => {
      result.current.add('first', ['/w/a.ts', '/w/b.ts'])
      result.current.add('first', ['/w/b.ts', '/w/c.ts'])
    })

    expect(result.current.filesFor('first')).toEqual(['/w/a.ts', '/w/b.ts', '/w/c.ts'])
  })

  it('clears one conversation only', () => {
    const { result } = renderHook(() => useAttachedFiles(ANNA))
    act(() => {
      result.current.add('first', ['/w/a.ts', '/w/b.ts'])
      result.current.add('chat-2', ['/w/a.ts'])
    })

    act(() => {
      result.current.clear('first')
    })
    expect(result.current.filesFor('first')).toEqual([])
    expect(result.current.filesFor('chat-2')).toEqual(['/w/a.ts'])
  })
})
