import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NOTHING_STREAMING, STREAM_FLUSH_MS, streamOf, useStreaming } from './useStreaming.js'

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
    expect(result.current.stream.read()).toBe(NOTHING_STREAMING)
    expect(result.current.streaming).toBe(false)

    act(() => {
      vi.advanceTimersByTime(STREAM_FLUSH_MS)
    })
    expect(result.current.stream.read()).toEqual({ text: 'abc', thinking: 'weighing' })
    expect(result.current.streaming).toBe(true)
  })

  it('adds the next flush to what is already drawn', () => {
    const { result } = renderHook(() => useStreaming('c-1'))

    act(() => {
      result.current.append('text', 'Look')
      vi.advanceTimersByTime(STREAM_FLUSH_MS)
      result.current.append('text', 'ing')
      vi.advanceTimersByTime(STREAM_FLUSH_MS)
    })

    expect(result.current.stream.read().text).toBe('Looking')
  })

  /*
   * The pane used to be rendered for every flush, since what streamed in was
   * its state; the readers of the store are told instead, and the hook's own
   * state moves only when writing starts and ends.
   */
  it('tells the store’s readers of each flush, and renders the hook for the first alone', () => {
    const renders = vi.fn()
    const { result } = renderHook(() => {
      renders()
      return useStreaming('c-1')
    })
    const told = vi.fn()
    result.current.stream.subscribe(told)
    const before = renders.mock.calls.length

    act(() => {
      result.current.append('text', 'Look')
      vi.advanceTimersByTime(STREAM_FLUSH_MS)
      result.current.append('text', 'ing')
      vi.advanceTimersByTime(STREAM_FLUSH_MS)
    })

    expect(told).toHaveBeenCalledTimes(2)
    expect(renders.mock.calls.length).toBe(before + 1)
  })
})

/*
 * Behind another tab or a file, a reply was parsed twenty times a second for
 * nobody. It is gathered instead, and drawn together when the pane comes
 * forward.
 */
describe('a pane nobody can see', () => {
  it('gathers the fragments without drawing them, and draws them once it is seen', () => {
    const { result, rerender } = renderHook(({ drawn }) => useStreaming('c-1', drawn), {
      initialProps: { drawn: false }
    })

    act(() => {
      result.current.append('text', 'Look')
      result.current.append('text', 'ing')
      vi.advanceTimersByTime(STREAM_FLUSH_MS * 4)
    })
    expect(result.current.stream.read()).toBe(NOTHING_STREAMING)
    expect(vi.getTimerCount()).toBe(0)

    rerender({ drawn: true })
    act(() => {
      vi.advanceTimersByTime(STREAM_FLUSH_MS)
    })
    expect(result.current.stream.read().text).toBe('Looking')
  })

  // The pane's event subscription is built on `append`; a new one on every
  // toggle tore it down and up, dropping a rewind's re-read on the way.
  it('keeps the same append across being hidden and shown', () => {
    const { result, rerender } = renderHook(({ drawn }) => useStreaming('c-1', drawn), {
      initialProps: { drawn: true }
    })
    const { append } = result.current

    rerender({ drawn: false })
    expect(result.current.append).toBe(append)

    rerender({ drawn: true })
    expect(result.current.append).toBe(append)
  })

  it('schedules nothing on coming forward with nothing gathered', () => {
    const { rerender } = renderHook(({ drawn }) => useStreaming('c-1', drawn), {
      initialProps: { drawn: false }
    })

    rerender({ drawn: true })

    expect(vi.getTimerCount()).toBe(0)
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

    expect(result.current.stream.read()).toBe(NOTHING_STREAMING)
    expect(result.current.streaming).toBe(false)
  })

  it('says nothing is being written once reset, and leaves a waiting flush alone', () => {
    const { result } = renderHook(() => useStreaming('c-1'))

    act(() => {
      result.current.append('text', 'Look')
      vi.advanceTimersByTime(STREAM_FLUSH_MS)
      result.current.reset()
    })
    expect(result.current.streaming).toBe(false)
  })
})

describe('the conversation going away', () => {
  it('drops a waiting flush, and what was drawn, when the pane moves to another conversation', () => {
    const { result, rerender } = renderHook(({ key }) => useStreaming(key), {
      initialProps: { key: 'c-1' }
    })

    act(() => {
      result.current.append('text', 'drawn for the first one')
      vi.advanceTimersByTime(STREAM_FLUSH_MS)
      result.current.append('text', 'and waiting')
    })
    const before = result.current.stream
    rerender({ key: 'c-2' })
    act(() => {
      vi.advanceTimersByTime(STREAM_FLUSH_MS)
    })

    expect(result.current.stream).not.toBe(before)
    expect(result.current.stream.read()).toBe(NOTHING_STREAMING)
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

describe('a store that says one thing', () => {
  it('says it to whoever reads, and never tells anybody anything', () => {
    const store = streamOf({ text: 'still', thinking: '' })
    const told = vi.fn()
    const leave = store.subscribe(told)

    expect(store.read().text).toBe('still')
    leave()
    expect(told).not.toHaveBeenCalled()
  })
})
