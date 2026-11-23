import { act, renderHook, type RenderHookResult, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, type Mock, type MockedFunction } from 'vitest'

import type { CardDetail } from '@core/boardSchema.js'

import type { Result } from '../../../preload/index.js'
import { cardDetail, ok, refusal } from '../test/board.js'
import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { useCardDetail } from './useCardDetail.js'

interface Props {
  projectId: string | null
  ref: string | null
  revision: number
  onError: (message: string | null) => void
}

function renderDetail(
  overrides: Partial<Props> = {}
): RenderHookResult<CardDetail | null, Props> & { readonly onError: Mock } {
  const onError = vi.fn()
  const view = renderHook(
    (props: Props) => useCardDetail(props.projectId, props.ref, props.revision, props.onError),
    {
      initialProps: {
        projectId: 'planner',
        ref: 'backlog/Fix login.md',
        revision: 1,
        onError,
        ...overrides
      }
    }
  )
  return { ...view, onError }
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

describe('useCardDetail', () => {
  it('reads the open card', async () => {
    read().mockResolvedValue(ok(cardDetail()))

    const { result } = renderDetail()

    await waitFor(() => {
      expect(result.current?.description).toBe('# Fix login\n\nThe form forgets the e-mail.\n')
    })
    expect(read()).toHaveBeenCalledWith('planner', 'backlog/Fix login.md')
  })

  it('reads nothing without a card', async () => {
    const { result } = renderDetail({ ref: null })
    await act(() => Promise.resolve())

    expect(read()).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })

  it('reads nothing without a project', async () => {
    const { result } = renderDetail({ projectId: null })
    await act(() => Promise.resolve())

    expect(read()).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })

  it('keeps the detail while the same card is read again', async () => {
    read().mockResolvedValueOnce(ok(cardDetail()))
    const { result, rerender, onError } = renderDetail()
    await waitFor(() => {
      expect(result.current).not.toBeNull()
    })
    const again = holdNextRead()

    rerender({ projectId: 'planner', ref: 'backlog/Fix login.md', revision: 2, onError })

    expect(result.current?.description).toBe('# Fix login\n\nThe form forgets the e-mail.\n')
    expect(read()).toHaveBeenCalledTimes(2)
    await act(async () => {
      again.resolve(ok(cardDetail()))
      await again.promise
    })
  })

  it('shows nothing of the previous card', async () => {
    read().mockResolvedValueOnce(ok(cardDetail()))
    const { result, rerender, onError } = renderDetail()
    await waitFor(() => {
      expect(result.current).not.toBeNull()
    })
    const next = holdNextRead()

    rerender({ projectId: 'planner', ref: 'done/B.md', revision: 1, onError })

    expect(result.current).toBeNull()
    await act(async () => {
      next.resolve(ok(cardDetail({ ref: 'done/B.md' })))
      await next.promise
    })
  })

  it('shows nothing of the previous project', async () => {
    read().mockResolvedValueOnce(ok(cardDetail()))
    const { result, rerender, onError } = renderDetail()
    await waitFor(() => {
      expect(result.current).not.toBeNull()
    })
    const next = holdNextRead()

    rerender({ projectId: 'ledger', ref: 'backlog/Fix login.md', revision: 1, onError })

    expect(result.current).toBeNull()
    await act(async () => {
      next.resolve(ok(cardDetail()))
      await next.promise
    })
  })

  it('goes quiet about a card removed outside', async () => {
    read().mockResolvedValue(refusal('cardMissing', { name: 'Fix login.md' }))

    const { result, onError } = renderDetail()

    await waitFor(() => {
      expect(read()).toHaveBeenCalledTimes(1)
    })
    await act(() => Promise.resolve())
    expect(result.current).toBeNull()
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports any other failure', async () => {
    read().mockResolvedValue(refusal('cardOutside', { name: 'x.md' }))

    const { onError } = renderDetail()

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('“x.md” is not inside the board folder.')
    })
  })

  it('drops an answer a newer read overtook', async () => {
    const first = holdNextRead()
    read().mockResolvedValueOnce(ok(cardDetail({ title: 'B' })))
    const { result, rerender, onError } = renderDetail()

    rerender({ projectId: 'planner', ref: 'backlog/Fix login.md', revision: 2, onError })
    await waitFor(() => {
      expect(result.current?.title).toBe('B')
    })
    await act(async () => {
      first.resolve(ok(cardDetail({ title: 'A' })))
      await first.promise
    })

    expect(result.current?.title).toBe('B')
  })

  it('does not read again when handed a new onError', async () => {
    read().mockResolvedValue(ok(cardDetail()))
    const { result, rerender } = renderDetail()
    await waitFor(() => {
      expect(result.current).not.toBeNull()
    })

    rerender({ projectId: 'planner', ref: 'backlog/Fix login.md', revision: 1, onError: vi.fn() })
    await act(() => Promise.resolve())

    expect(read()).toHaveBeenCalledTimes(1)
  })
})
