import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { type DiffComment, useDiffComments } from './useDiffComments.js'

const ANNA = 'planner/anna'
const BOB = 'planner/bob'

const note = (overrides: Partial<DiffComment> = {}): DiffComment => ({
  path: 'src/a.ts',
  side: 'new',
  line: 1,
  endLine: 1,
  code: 'const x = 1',
  text: 'rename this',
  ...overrides
})

describe('the review notes waiting to be sent', () => {
  it('starts with none', () => {
    const { result } = renderHook(() => useDiffComments(ANNA))

    expect(result.current.pending).toEqual([])
  })

  it('keeps a note that was written', () => {
    const { result } = renderHook(() => useDiffComments(ANNA))

    act(() => {
      result.current.add(note())
    })

    expect(result.current.pending).toEqual([note()])
  })

  it('keeps notes in the order they were written', () => {
    const { result } = renderHook(() => useDiffComments(ANNA))

    act(() => {
      result.current.add(note({ line: 1, text: 'first' }))
      result.current.add(note({ line: 2, text: 'second' }))
    })

    expect(result.current.pending.map((held) => held.text)).toEqual(['first', 'second'])
  })

  // One line, one remark: a thread would be a conversation this app has no way
  // to continue.
  it('replaces the note on a line rather than stacking a second one', () => {
    const { result } = renderHook(() => useDiffComments(ANNA))

    act(() => {
      result.current.add(note({ text: 'first thought' }))
      result.current.add(note({ text: 'second thought' }))
    })

    expect(result.current.pending).toHaveLength(1)
    expect(result.current.pending[0]?.text).toBe('second thought')
  })

  // The same line number on the two sides of a diff is two different lines.
  /*
   * Two selections starting on one line and covering different amounts are two
   * remarks about two passages. Identity that dropped the end would treat the
   * second as a correction of the first and silently lose one of them.
   */
  it('tells two passages starting on the same line apart', () => {
    const { result } = renderHook(() => useDiffComments(ANNA))

    act(() => {
      result.current.add(note({ line: 4, endLine: 6, text: 'this block' }))
    })
    act(() => {
      result.current.add(note({ line: 4, endLine: 9, text: 'all of this' }))
    })

    expect(result.current.pending).toHaveLength(2)
  })

  it('replaces a note on the passage it already covers', () => {
    const { result } = renderHook(() => useDiffComments(ANNA))

    act(() => {
      result.current.add(note({ line: 4, endLine: 6, text: 'first go' }))
    })
    act(() => {
      result.current.add(note({ line: 4, endLine: 6, text: 'better wording' }))
    })

    expect(result.current.pending).toEqual([expect.objectContaining({ text: 'better wording' })])
  })

  it('tells the two sides of a line apart', () => {
    const { result } = renderHook(() => useDiffComments(ANNA))

    act(() => {
      result.current.add(note({ side: 'old', text: 'was' }))
      result.current.add(note({ side: 'new', text: 'is' }))
    })

    expect(result.current.pending).toHaveLength(2)
  })

  it('gives a note back', () => {
    const { result } = renderHook(() => useDiffComments(ANNA))

    act(() => {
      result.current.add(note())
      result.current.remove(note())
    })

    expect(result.current.pending).toEqual([])
  })

  it('clears them all once they have gone out', () => {
    const { result } = renderHook(() => useDiffComments(ANNA))

    act(() => {
      result.current.add(note({ line: 1 }))
      result.current.add(note({ line: 2 }))
      result.current.clear()
    })

    expect(result.current.pending).toEqual([])
  })

  // A review belongs to the workspace it is about, and switching away and back
  // should find it where it was left.
  it('keeps each workspace’s notes to itself', () => {
    const { result, rerender } = renderHook(({ id }) => useDiffComments(id), {
      initialProps: { id: ANNA }
    })

    act(() => {
      result.current.add(note({ text: 'about anna' }))
    })

    rerender({ id: BOB })
    expect(result.current.pending).toEqual([])

    rerender({ id: ANNA })
    expect(result.current.pending[0]?.text).toBe('about anna')
  })

  it('has nowhere to keep a note when no workspace is open', () => {
    const { result } = renderHook(() => useDiffComments(null))

    act(() => {
      result.current.add(note())
    })

    expect(result.current.pending).toEqual([])
  })
})
