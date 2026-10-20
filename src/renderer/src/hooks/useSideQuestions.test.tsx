import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SIDE_HISTORY_LIMIT, type SideAnswer } from '@core/sideQuestions.js'

import type { Result } from '../../../preload/index.js'
import { octopus } from '../test/octopus.js'
import { type SideItem, sideHistory, useSideQuestions } from './useSideQuestions.js'

/** A side question the test settles by hand. */
function held(): { resolve: (result: Result<SideAnswer | null>) => void } {
  let resolve: (result: Result<SideAnswer | null>) => void = () => undefined
  vi.mocked(octopus().chats.sideQuestion).mockImplementationOnce(
    () =>
      new Promise((settle) => {
        resolve = settle
      })
  )
  return {
    resolve: (result) => {
      resolve(result)
    }
  }
}

const answered = (question: string, answer: string): SideItem => ({
  id: 0,
  question,
  state: 'answered',
  answer,
  synthetic: false
})

describe('the history a question is asked with', () => {
  it('replays only answered exchanges, the newest last', () => {
    expect(
      sideHistory([
        answered('a', '1'),
        { id: 1, question: 'b', state: 'failed', error: 'x' },
        { id: 2, question: 'c', state: 'pending' },
        answered('d', '4')
      ])
    ).toEqual([
      { question: 'a', response: '1' },
      { question: 'd', response: '4' }
    ])
  })

  it('stops at the most recent the CLI replays', () => {
    const items = Array.from({ length: SIDE_HISTORY_LIMIT + 5 }, (_, index) =>
      answered(`q${String(index)}`, `a${String(index)}`)
    )

    const history = sideHistory(items)

    expect(history).toHaveLength(SIDE_HISTORY_LIMIT)
    expect(history[0]?.question).toBe('q5')
  })
})

describe('useSideQuestions', () => {
  it('opens the drawer, asks with the thread so far, and draws the answer', async () => {
    vi.mocked(octopus().chats.sideQuestion)
      .mockResolvedValueOnce({ ok: true, value: { text: 'Kyiv.', synthetic: false } })
      .mockResolvedValueOnce({ ok: true, value: { text: 'Open-Meteo.', synthetic: true } })
    const { result } = renderHook(() => useSideQuestions())

    await act(() => result.current.ask('chat-1', 'which city?'))
    await act(() => result.current.ask('chat-1', 'which API?'))

    const thread = result.current.threadFor('chat-1')
    expect(thread.open).toBe(true)
    expect(thread.items).toMatchObject([
      { question: 'which city?', state: 'answered', answer: 'Kyiv.' },
      { question: 'which API?', state: 'answered', answer: 'Open-Meteo.', synthetic: true }
    ])
    expect(octopus().chats.sideQuestion).toHaveBeenLastCalledWith('chat-1', 'which API?', [
      { question: 'which city?', response: 'Kyiv.' }
    ])
  })

  it('shows the question at once, before the answer is in', async () => {
    const pending = held()
    const { result } = renderHook(() => useSideQuestions())

    let asked = Promise.resolve()
    act(() => {
      asked = result.current.ask('chat-1', 'why?')
    })

    await waitFor(() => {
      expect(result.current.threadFor('chat-1').items).toMatchObject([
        { question: 'why?', state: 'pending' }
      ])
    })
    await act(async () => {
      pending.resolve({ ok: true, value: null })
      await asked
    })
    expect(result.current.threadFor('chat-1').items).toMatchObject([{ state: 'empty' }])
  })

  it('says why in the window’s words when the question could not be answered', async () => {
    vi.mocked(octopus().chats.sideQuestion).mockResolvedValueOnce({
      ok: false,
      error: 'aborted',
      code: 'sideQuestionTimedOut'
    })
    const { result } = renderHook(() => useSideQuestions())

    await act(() => result.current.ask('chat-1', 'why?'))

    expect(result.current.threadFor('chat-1').items).toMatchObject([
      { state: 'failed', error: 'The side question took too long and was given up. Try again.' }
    ])
  })

  it('marks an answer that arrives while the drawer is shut, until it is opened', async () => {
    const pending = held()
    const { result } = renderHook(() => useSideQuestions())

    let asked = Promise.resolve()
    act(() => {
      asked = result.current.ask('chat-1', 'why?')
    })
    act(() => {
      result.current.setOpen('chat-1', false)
    })
    await act(async () => {
      pending.resolve({ ok: true, value: { text: 'because', synthetic: false } })
      await asked
    })

    expect(result.current.threadFor('chat-1').unread).toBe(true)
    act(() => {
      result.current.setOpen('chat-1', true)
    })
    expect(result.current.threadFor('chat-1').unread).toBe(false)
  })

  it('drops an answer to a thread cleared or forgotten while it was out', async () => {
    const first = held()
    const second = held()
    const { result } = renderHook(() => useSideQuestions())

    let askedFirst = Promise.resolve()
    let askedSecond = Promise.resolve()
    act(() => {
      askedFirst = result.current.ask('chat-1', 'one')
      askedSecond = result.current.ask('chat-2', 'two')
    })
    act(() => {
      result.current.clear('chat-1')
      result.current.forget('chat-2')
    })
    await act(async () => {
      first.resolve({ ok: true, value: { text: 'late', synthetic: false } })
      second.resolve({ ok: true, value: { text: 'late', synthetic: false } })
      await Promise.all([askedFirst, askedSecond])
    })

    expect(result.current.threadFor('chat-1').items).toEqual([])
    expect(result.current.threadFor('chat-2').items).toEqual([])
  })

  it('keeps a thread per conversation', async () => {
    vi.mocked(octopus().chats.sideQuestion).mockResolvedValue({
      ok: true,
      value: { text: 'a', synthetic: false }
    })
    const { result } = renderHook(() => useSideQuestions())

    await act(() => result.current.ask('chat-1', 'q'))

    expect(result.current.threadFor('chat-1').items).toHaveLength(1)
    expect(result.current.threadFor('chat-2').items).toEqual([])
    expect(result.current.threadFor(null).items).toEqual([])
  })

  it('forgets nothing it never held', () => {
    const { result } = renderHook(() => useSideQuestions())
    const before = result.current

    act(() => {
      result.current.forget('chat-9')
    })

    expect(result.current.threadFor).toBe(before.threadFor)
  })
})
