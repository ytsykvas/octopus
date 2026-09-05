import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { PullRequestComment } from '@core/pullRequestShapes.js'

import { type PullRequestQuote, toQuote, usePullRequestQuotes } from './usePullRequestQuotes.js'

const ANNA = 'planner/anna'
const BOB = 'planner/bob'

const quote = (overrides: Partial<PullRequestQuote> = {}): PullRequestQuote => ({
  key: 'inline:PRRC_1',
  reference: '#7',
  author: 'olena',
  place: 'src/core/git.ts:42',
  quote: '@@ -1 +1 @@',
  body: 'Why the second case?',
  ...overrides
})

describe('what a comment becomes on its way to the composer', () => {
  it('names the file and the line of an inline note', () => {
    const comment: PullRequestComment = {
      kind: 'inline',
      threadId: 'PRRT_1',
      id: 'PRRC_1',
      author: 'olena',
      body: 'Why the second case?',
      createdAt: '2026-08-20T11:00:00Z',
      url: 'https://github.com/o/p/pull/7#discussion_r1',
      path: 'src/core/git.ts',
      line: 42,
      quote: '@@ -1 +1 @@',
      resolved: false
    }

    expect(toQuote(comment, 7)).toEqual(quote())
  })

  /* A note the diff has moved past has no line any more, and the file on its
     own is still where it was written. */
  it('names the file alone for a note that has gone out of date', () => {
    const comment: PullRequestComment = {
      kind: 'inline',
      threadId: 'PRRT_1',
      id: 'PRRC_1',
      author: null,
      body: 'still worth reading',
      createdAt: '2026-08-20T11:00:00Z',
      url: 'u',
      path: 'src/core/git.ts',
      line: null,
      quote: '@@',
      resolved: true
    }

    expect(toQuote(comment, 7)).toMatchObject({ place: 'src/core/git.ts', author: null })
  })

  // A comment on the request as a whole is about no file at all.
  it('has no place for a comment that is not about a line', () => {
    const comment: PullRequestComment = {
      kind: 'issue',
      id: 'IC_1',
      author: 'ivan',
      body: 'Shipping this today.',
      createdAt: '2026-08-20T11:00:00Z',
      url: 'u'
    }

    expect(toQuote(comment, 7)).toMatchObject({ key: 'issue:IC_1', place: null, quote: null })
  })
})

describe('the remarks waiting to be sent', () => {
  it('starts with none', () => {
    const { result } = renderHook(() => usePullRequestQuotes(ANNA))

    expect(result.current.pending).toEqual([])
  })

  it('keeps a remark in the order it was added', () => {
    const { result } = renderHook(() => usePullRequestQuotes(ANNA))

    act(() => {
      result.current.add(quote({ key: 'a' }))
      result.current.add(quote({ key: 'b' }))
    })

    expect(result.current.pending.map((held) => held.key)).toEqual(['a', 'b'])
  })

  /* The button is disabled once a remark is waiting, so this is the race rather
     than the ordinary path — and the same remark twice is one remark. */
  it('holds one copy of a remark however often it is added', () => {
    const { result } = renderHook(() => usePullRequestQuotes(ANNA))

    act(() => {
      result.current.add(quote())
      result.current.add(quote({ body: 'edited since' }))
    })

    expect(result.current.pending).toHaveLength(1)
  })

  it('gives one back', () => {
    const { result } = renderHook(() => usePullRequestQuotes(ANNA))

    act(() => {
      result.current.add(quote({ key: 'a' }))
      result.current.add(quote({ key: 'b' }))
      result.current.remove(quote({ key: 'a' }))
    })

    expect(result.current.pending.map((held) => held.key)).toEqual(['b'])
  })

  it('lets go of everything once the message has gone', () => {
    const { result } = renderHook(() => usePullRequestQuotes(ANNA))

    act(() => {
      result.current.add(quote())
      result.current.clear()
    })

    expect(result.current.pending).toEqual([])
  })

  /* Kept per workspace, so switching away and back finds the remarks where they
     were left and never shows another branch's review. */
  it("keeps one workspace's remarks out of another's", () => {
    const { result, rerender } = renderHook(({ id }) => usePullRequestQuotes(id), {
      initialProps: { id: ANNA }
    })

    act(() => {
      result.current.add(quote())
    })

    rerender({ id: BOB })
    expect(result.current.pending).toEqual([])

    rerender({ id: ANNA })
    expect(result.current.pending).toHaveLength(1)
  })

  // Nothing to attach a remark to, so nothing is kept — and nothing throws.
  it('holds nothing without a workspace', () => {
    const { result } = renderHook(() => usePullRequestQuotes(null))

    act(() => {
      result.current.add(quote())
    })

    expect(result.current.pending).toEqual([])
  })
})
