import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MentionFile } from '@core/fileSearch.js'

import { useFileMentions } from './useFileMentions.js'

const AUTH: MentionFile = { path: 'src/auth.ts', absolute: '/w/src/auth.ts' }
const ROUTES: MentionFile = { path: 'src/routes.ts', absolute: '/w/src/routes.ts' }

afterEach(() => {
  vi.useRealTimers()
})

describe('searching for what is typed after an @', () => {
  // Past the debounce on a clock the test holds, so the silence means
  // something: asserted straight away the search is not due yet either way.
  it('asks for nothing while there is no mention', async () => {
    vi.useFakeTimers()
    const search = vi.fn(() => Promise.resolve([AUTH]))

    const { result } = renderHook(() => useFileMentions(null, search))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(search).not.toHaveBeenCalled()
    expect(result.current).toEqual([])
  })

  // The Enter pressed between a keystroke and its answer found no list to take
  // and sent the message with the half-typed name in it.
  it('keeps the last answer up while the next one is on its way', async () => {
    const settle: Record<string, (files: MentionFile[]) => void> = {}
    const search = vi.fn(
      (query: string) =>
        new Promise<MentionFile[]>((resolve) => {
          settle[query] = resolve
        })
    )

    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useFileMentions(query, search),
      { initialProps: { query: 'a' } }
    )
    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('a')
    })
    await act(async () => {
      settle.a?.([AUTH])
      await Promise.resolve()
    })
    expect(result.current).toEqual([AUTH])

    rerender({ query: 'au' })

    // Asked for and not answered yet — and still there.
    expect(result.current).toEqual([AUTH])
    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('au')
    })
    expect(result.current).toEqual([AUTH])

    await act(async () => {
      settle.au?.([ROUTES])
      await Promise.resolve()
    })
    expect(result.current).toEqual([ROUTES])
  })

  it('answers with the files for the query', async () => {
    const search = vi.fn(() => Promise.resolve([AUTH]))

    const { result } = renderHook(() => useFileMentions('au', search))

    await waitFor(() => {
      expect(result.current).toEqual([AUTH])
    })
    expect(search).toHaveBeenCalledExactlyOnceWith('au')
  })

  // A burst of keystrokes is one search, not one per letter.
  it('asks once for a burst of keystrokes', async () => {
    const search = vi.fn((query: string) => Promise.resolve(query === 'aut' ? [AUTH] : []))

    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useFileMentions(query, search),
      { initialProps: { query: 'a' } }
    )
    rerender({ query: 'au' })
    rerender({ query: 'aut' })

    await waitFor(() => {
      expect(result.current).toEqual([AUTH])
    })
    expect(search).toHaveBeenCalledExactlyOnceWith('aut')
  })

  // A late answer for `a` must never show under `ab`.
  it('drops an answer that arrives after the query moved on', async () => {
    const settle: Record<string, (files: MentionFile[]) => void> = {}
    const search = vi.fn(
      (query: string) =>
        new Promise<MentionFile[]>((resolve) => {
          settle[query] = resolve
        })
    )

    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useFileMentions(query, search),
      { initialProps: { query: 'a' } }
    )
    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('a')
    })

    rerender({ query: 'ab' })
    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('ab')
    })

    await act(async () => {
      settle.a?.([AUTH])
      await Promise.resolve()
    })
    expect(result.current).toEqual([])

    await act(async () => {
      settle.ab?.([ROUTES])
      await Promise.resolve()
    })
    expect(result.current).toEqual([ROUTES])
  })

  // Answers do not come back in the order they were asked for. The slow one for
  // `a` landing after the quick one for `ab` must not take its place.
  it('keeps the newer answer when an older one arrives after it', async () => {
    const settle: Record<string, (files: MentionFile[]) => void> = {}
    const search = vi.fn(
      (query: string) =>
        new Promise<MentionFile[]>((resolve) => {
          settle[query] = resolve
        })
    )

    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useFileMentions(query, search),
      { initialProps: { query: 'a' } }
    )
    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('a')
    })
    rerender({ query: 'ab' })
    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('ab')
    })

    await act(async () => {
      settle.ab?.([ROUTES])
      await Promise.resolve()
    })
    await act(async () => {
      settle.a?.([AUTH])
      await Promise.resolve()
    })

    expect(result.current).toEqual([ROUTES])
  })

  // The answer was for a query that is gone, so it stops matching on its own.
  it('shows nothing once the mention is gone', async () => {
    const search = vi.fn(() => Promise.resolve([AUTH]))

    const initialProps: { query: string | null } = { query: 'au' }
    const { result, rerender } = renderHook(
      ({ query }: { query: string | null }) => useFileMentions(query, search),
      { initialProps }
    )
    await waitFor(() => {
      expect(result.current).toEqual([AUTH])
    })

    rerender({ query: null })

    expect(result.current).toEqual([])
  })
})
