import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { type CodeNote, codeNoteKey, useCodeNotes } from './useCodeNotes.js'

const ANNA = 'planner/anna'
const BOB = 'planner/bob'

const note = (overrides: Partial<CodeNote> = {}): CodeNote => ({
  path: 'src/a.ts',
  line: 3,
  endLine: 5,
  code: 'const x = 1',
  text: 'rename this',
  ...overrides
})

describe('the notes from the viewer', () => {
  it('holds each conversation’s notes apart', () => {
    const { result } = renderHook(() => useCodeNotes(ANNA))

    act(() => {
      result.current.add('first', note({ text: 'one' }))
      result.current.add('chat-2', note({ line: 9, endLine: 9, text: 'two' }))
    })

    expect(result.current.pendingFor('first')).toEqual([note({ text: 'one' })])
    expect(result.current.pendingFor('chat-2')).toEqual([
      note({ line: 9, endLine: 9, text: 'two' })
    ])
    expect(result.current.pendingFor('chat-3')).toEqual([])
  })

  it('holds each workspace’s notes apart, and none without a workspace', () => {
    const start: { id: string | null } = { id: ANNA }
    const { result, rerender } = renderHook(({ id }) => useCodeNotes(id), {
      initialProps: start
    })
    act(() => {
      result.current.add('first', note())
    })

    rerender({ id: BOB })
    expect(result.current.pendingFor('first')).toEqual([])

    rerender({ id: null })
    act(() => {
      result.current.add('first', note())
    })
    expect(result.current.pendingFor('first')).toEqual([])

    rerender({ id: ANNA })
    expect(result.current.pendingFor('first')).toEqual([note()])
  })

  // One passage, one remark — the diff's rule.
  it('replaces a note on the same lines, and keeps one on other lines', () => {
    const { result } = renderHook(() => useCodeNotes(ANNA))

    act(() => {
      result.current.add('first', note({ text: 'old' }))
      result.current.add('first', note({ endLine: 6, text: 'longer' }))
      result.current.add('first', note({ text: 'new' }))
    })

    expect(result.current.pendingFor('first').map((held) => held.text)).toEqual(['longer', 'new'])
  })

  it('removes one note, and clears one conversation only', () => {
    const { result } = renderHook(() => useCodeNotes(ANNA))
    act(() => {
      result.current.add('first', note())
      result.current.add('first', note({ line: 9, endLine: 9 }))
      result.current.add('chat-2', note())
    })

    act(() => {
      result.current.remove('first', note({ text: 'whatever it said' }))
    })
    expect(result.current.pendingFor('first')).toEqual([note({ line: 9, endLine: 9 })])

    act(() => {
      result.current.clear('first')
    })
    expect(result.current.pendingFor('first')).toEqual([])
    expect(result.current.pendingFor('chat-2')).toEqual([note()])
  })

  it('names a note by its path and lines', () => {
    expect(codeNoteKey(note())).toBe('src/a.ts:3-5')
  })
})
