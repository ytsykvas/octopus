import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NOTHING_STREAMING, STREAM_FLUSH_MS, useStreaming } from './useStreaming.js'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
})

/*
 * Each fragment used to be its own React update, and each update parsed the
 * growing reply as markdown again — a cost that grew with the answer.
 */
describe('gathering what is streamed', () => {
  it('draws the fragments together once the flush comes round', () => {
    const { result } = renderHook(() => useStreaming('c-1'))

    act(() => {
      result.current.append('text', 'a')
      result.current.append('text', 'b')
      result.current.append('thinking', 'weighing')
      result.current.append('text', 'c')
    })
    expect(result.current.streaming).toBe(NOTHING_STREAMING)

    act(() => {
      vi.advanceTimersByTime(STREAM_FLUSH_MS)
    })
    expect(result.current.streaming).toEqual({ text: 'abc', thinking: 'weighing' })
  })

  it('adds the next flush to what is already drawn', () => {
    const { result } = renderHook(() => useStreaming('c-1'))

    act(() => {
      result.current.append('text', 'Look')
      vi.advanceTimersByTime(STREAM_FLUSH_MS)
      result.current.append('text', 'ing')
      vi.advanceTimersByTime(STREAM_FLUSH_MS)
    })

    expect(result.current.streaming.text).toBe('Looking')
  })
})

describe('ending the block being written', () => {
  // The finished block carries the whole text, so a fragment drawn after it
  // would stand under it as a second copy of its last words.
  it('drops a fragment still waiting, so it never comes back', () => {
    const { result } = renderHook(() => useStreaming('c-1'))

    act(() => {
      result.current.append('text', 'Look')
      vi.advanceTimersByTime(STREAM_FLUSH_MS)
      result.current.append('text', 'ing')
      result.current.discard()
      vi.advanceTimersByTime(STREAM_FLUSH_MS)
    })

    expect(result.current.streaming).toBe(NOTHING_STREAMING)
  })

  it('clears what is drawn and leaves a waiting flush alone when reset', () => {
    const { result } = renderHook(() => useStreaming('c-1'))

    act(() => {
      result.current.append('text', 'Look')
      vi.advanceTimersByTime(STREAM_FLUSH_MS)
      result.current.reset()
    })
    expect(result.current.streaming).toBe(NOTHING_STREAMING)
  })
})

describe('the conversation going away', () => {
  it('drops a waiting flush when the pane moves to another conversation', () => {
    const { result, rerender } = renderHook(({ key }) => useStreaming(key), {
      initialProps: { key: 'c-1' }
    })

    act(() => {
      result.current.append('text', 'for the first one')
    })
    rerender({ key: 'c-2' })
    act(() => {
      vi.advanceTimersByTime(STREAM_FLUSH_MS)
    })

    expect(result.current.streaming).toBe(NOTHING_STREAMING)
  })

  it('drops a waiting flush when the pane closes', () => {
    const { result, unmount } = renderHook(() => useStreaming('c-1'))

    act(() => {
      result.current.append('text', 'unread')
    })
    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
