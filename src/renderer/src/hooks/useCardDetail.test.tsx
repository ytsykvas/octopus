import { act, renderHook, type RenderHookResult, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, type MockedFunction } from 'vitest'

import type { CardDetail } from '@core/boardSchema.js'

import type { Result } from '../../../preload/index.js'
import { cardDetail, ok, refusal } from '../test/board.js'
import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { type CardDetailState, type OpenCard, useCardDetail } from './useCardDetail.js'

interface Props {
  projectId: string | null
  open: OpenCard | null
  revision: number
}

const OPEN: OpenCard = { ref: 'backlog/Fix login.md', session: 1 }

function renderDetail(
  overrides: Partial<Props> = {}
): RenderHookResult<CardDetailState, Props> & { readonly props: Props } {
  const props: Props = { projectId: 'planner', open: OPEN, revision: 1, ...overrides }
  const view = renderHook((p: Props) => useCardDetail(p.projectId, p.open, p.revision), {
    initialProps: props
  })
  return { ...view, props }
}

function read(): MockedFunction<typeof window.octopus.board.read> {
  return vi.mocked(octopus().board.read)
}

/** The next read waits for the test to answer it. */
function holdNextRead(): ReturnType<typeof held<Result<CardDetail>>> {
  const answer = held<Result<CardDetail>>()
  read().mockReturnValueOnce(answer.promise)
  return answer
}

async function settled(
  answer: ReturnType<typeof holdNextRead>,
  value: Result<CardDetail>
): Promise<void> {
  await act(async () => {
    answer.resolve(value)
    await answer.promise
  })
}

describe('useCardDetail', () => {
  it('reads the open card', async () => {
    read().mockResolvedValue(ok(cardDetail()))

    const { result } = renderDetail()

    await waitFor(() => {
      expect(result.current.detail?.description).toBe(
        '# Fix login\n\nThe form forgets the e-mail.\n'
      )
    })
    expect(result.current.failure).toBeNull()
    expect(read()).toHaveBeenCalledWith('planner', 'backlog/Fix login.md')
  })

  it('reads nothing without a card', async () => {
    const { result } = renderDetail({ open: null })
    await act(() => Promise.resolve())

    expect(read()).not.toHaveBeenCalled()
    expect(result.current).toEqual({ detail: null, failure: null })
  })

  it('reads nothing without a project', async () => {
    const { result } = renderDetail({ projectId: null })
    await act(() => Promise.resolve())

    expect(read()).not.toHaveBeenCalled()
    expect(result.current).toEqual({ detail: null, failure: null })
  })

  it('keeps the detail while the same card is read again', async () => {
    read().mockResolvedValueOnce(ok(cardDetail()))
    const { result, rerender, props } = renderDetail()
    await waitFor(() => {
      expect(result.current.detail).not.toBeNull()
    })
    const again = holdNextRead()

    rerender({ ...props, revision: 2 })

    expect(result.current.detail?.title).toBe('Fix login')
    expect(read()).toHaveBeenCalledTimes(2)
    await settled(again, ok(cardDetail()))
  })

  it('keeps the detail of a card that moved, and reads it at its new ref', async () => {
    read().mockResolvedValueOnce(ok(cardDetail()))
    const { result, rerender, props } = renderDetail()
    await waitFor(() => {
      expect(result.current.detail).not.toBeNull()
    })
    const next = holdNextRead()

    rerender({ ...props, open: { ref: 'done/Fix login.md', session: 1 } })

    expect(result.current.detail?.title).toBe('Fix login')
    expect(read()).toHaveBeenLastCalledWith('planner', 'done/Fix login.md')
    await settled(next, ok(cardDetail({ ref: 'done/Fix login.md' })))
  })

  it('shows nothing of another opening, even of the same card', async () => {
    read().mockResolvedValueOnce(ok(cardDetail()))
    const { result, rerender, props } = renderDetail()
    await waitFor(() => {
      expect(result.current.detail).not.toBeNull()
    })
    const next = holdNextRead()

    rerender({ ...props, open: { ...OPEN, session: 2 } })

    expect(result.current.detail).toBeNull()
    await settled(next, ok(cardDetail()))
  })

  it('shows nothing of the previous project', async () => {
    read().mockResolvedValueOnce(ok(cardDetail()))
    const { result, rerender, props } = renderDetail()
    await waitFor(() => {
      expect(result.current.detail).not.toBeNull()
    })
    const next = holdNextRead()

    rerender({ ...props, projectId: 'ledger' })

    expect(result.current.detail).toBeNull()
    await settled(next, ok(cardDetail()))
  })

  it('goes quiet about a card removed outside', async () => {
    read().mockResolvedValue(refusal('cardMissing', { name: 'Fix login.md' }))

    const { result } = renderDetail()

    await waitFor(() => {
      expect(read()).toHaveBeenCalledTimes(1)
    })
    await act(() => Promise.resolve())
    expect(result.current).toEqual({ detail: null, failure: null })
  })

  it('forgets the detail of a card removed outside since', async () => {
    read()
      .mockResolvedValueOnce(ok(cardDetail()))
      .mockResolvedValueOnce(refusal('cardMissing', { name: 'Fix login.md' }))
    const { result, rerender, props } = renderDetail()
    await waitFor(() => {
      expect(result.current.detail).not.toBeNull()
    })

    rerender({ ...props, revision: 2 })

    await waitFor(() => {
      expect(result.current.detail).toBeNull()
    })
    expect(result.current.failure).toBeNull()
  })

  it('holds any other failure for the panel', async () => {
    const outside = refusal('cardOutside', { name: 'x.md' })
    read().mockResolvedValue(outside)

    const { result } = renderDetail()

    await waitFor(() => {
      expect(result.current.failure).toEqual(outside)
    })
    expect(result.current.detail).toBeNull()
  })

  it('forgets the failure once the card reads again', async () => {
    read()
      .mockResolvedValueOnce(refusal('cardOutside', { name: 'x.md' }))
      .mockResolvedValueOnce(ok(cardDetail()))
    const { result, rerender, props } = renderDetail()
    await waitFor(() => {
      expect(result.current.failure).not.toBeNull()
    })

    rerender({ ...props, revision: 2 })

    await waitFor(() => {
      expect(result.current.detail).not.toBeNull()
    })
    expect(result.current.failure).toBeNull()
  })

  it('drops an answer a newer read overtook', async () => {
    const first = holdNextRead()
    read().mockResolvedValueOnce(ok(cardDetail({ title: 'B' })))
    const { result, rerender, props } = renderDetail()

    rerender({ ...props, revision: 2 })
    await waitFor(() => {
      expect(result.current.detail?.title).toBe('B')
    })
    await settled(first, ok(cardDetail({ title: 'A' })))

    expect(result.current.detail?.title).toBe('B')
  })

  it('does not read again for an equal opening', async () => {
    read().mockResolvedValue(ok(cardDetail()))
    const { result, rerender, props } = renderDetail()
    await waitFor(() => {
      expect(result.current.detail).not.toBeNull()
    })

    rerender({ ...props, open: { ...OPEN } })
    await act(() => Promise.resolve())

    expect(read()).toHaveBeenCalledTimes(1)
  })
})
