import { act, renderHook, type RenderHookResult, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, type Mock, type MockedFunction } from 'vitest'

import type { BoardListing } from '@core/boardSchema.js'

import type { Result } from '../../../preload/index.js'
import { boardCard, boardListing, givenBoard, ok, refusal } from '../test/board.js'
import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { type BoardController, useBoard } from './useBoard.js'

interface Props {
  projectId: string | null
  folder: string
  onError: (m: string | null) => void
}

const A = boardListing([boardCard({ title: 'A' })])
const B = boardListing([boardCard({ title: 'B' })])

function renderBoard(
  overrides: Partial<Props> = {}
): RenderHookResult<BoardController, Props> & { readonly onError: Mock } {
  const onError = vi.fn()
  const view = renderHook(
    (props: Props) => useBoard(props.projectId, props.folder, props.onError),
    {
      initialProps: { projectId: 'planner', folder: '/tmp/board', onError, ...overrides }
    }
  )
  return { ...view, onError }
}

function list(): MockedFunction<typeof window.octopus.board.list> {
  return vi.mocked(octopus().board.list)
}

/** The next read waits for the test to answer it. */
function holdNextRead(): ReturnType<typeof held<Result<BoardListing>>> {
  const answer = held<Result<BoardListing>>()
  list().mockReturnValueOnce(answer.promise)
  return answer
}

describe('useBoard', () => {
  it("reads the project's board once the folder is set", async () => {
    givenBoard([boardCard()])

    const { result, onError } = renderBoard()

    await waitFor(() => {
      expect(result.current.listing?.cards).toHaveLength(1)
    })
    expect(list()).toHaveBeenCalledWith('planner')
    expect(result.current.revision).toBe(1)
    expect(result.current.failure).toBeNull()
    expect(onError).not.toHaveBeenCalled()
  })

  it('reads nothing without a folder', async () => {
    const { result } = renderBoard({ folder: '' })
    await act(() => Promise.resolve())

    expect(list()).not.toHaveBeenCalled()
    expect(result.current.listing).toBeNull()
    expect(result.current.revision).toBe(0)
  })

  it('reads nothing without a project', async () => {
    const { result } = renderBoard({ projectId: null })
    await act(() => Promise.resolve())

    expect(list()).not.toHaveBeenCalled()
    expect(result.current.listing).toBeNull()
    expect(result.current.revision).toBe(0)
  })

  it('reads nothing when asked to refresh without a folder', async () => {
    const { result } = renderBoard({ folder: '' })

    await act(() => result.current.refresh())

    expect(list()).not.toHaveBeenCalled()
  })

  it('keeps a first failure for the screen, not the banner', async () => {
    list().mockResolvedValue(
      refusal('boardFolderUnreadable', { path: '/tmp/board', reason: 'EACCES' })
    )

    const { result, onError } = renderBoard()

    await waitFor(() => {
      expect(result.current.failure?.code).toBe('boardFolderUnreadable')
    })
    expect(result.current.listing).toBeNull()
    expect(onError).not.toHaveBeenCalled()
  })

  it('clears the failure once a read works', async () => {
    list()
      .mockResolvedValueOnce(
        refusal('boardFolderUnreadable', { path: '/tmp/board', reason: 'EACCES' })
      )
      .mockResolvedValueOnce(ok(boardListing([boardCard()])))
    const { result, onError } = renderBoard()
    await waitFor(() => {
      expect(result.current.failure).not.toBeNull()
    })

    await act(() => result.current.refresh())

    expect(result.current.failure).toBeNull()
    expect(result.current.listing?.cards).toHaveLength(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('keeps the cards and reports a later failure', async () => {
    list()
      .mockResolvedValueOnce(ok(A))
      .mockResolvedValueOnce(refusal('cardMissing', { name: 'Fix login.md' }))
    const { result, onError } = renderBoard()
    await waitFor(() => {
      expect(result.current.listing).not.toBeNull()
    })
    const shown = result.current.listing

    await act(() => result.current.refresh())

    expect(result.current.listing).toBe(shown)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('“Fix login.md” is no longer on disk.')
  })

  it('reports a later failure that carries no code', async () => {
    list().mockResolvedValueOnce(ok(A)).mockResolvedValueOnce({ ok: false, error: 'disk said no' })
    const { result, onError } = renderBoard()
    await waitFor(() => {
      expect(result.current.listing).not.toBeNull()
    })

    await act(() => result.current.refresh())

    expect(onError).toHaveBeenCalledWith('Something went wrong: disk said no')
    expect(result.current.listing?.cards[0]?.title).toBe('A')
  })

  it('clears the banner once a read works again', async () => {
    list()
      .mockResolvedValueOnce(ok(A))
      .mockResolvedValueOnce(refusal('cardMissing', { name: 'Fix login.md' }))
      .mockResolvedValueOnce(ok(A))
    const { result, onError } = renderBoard()
    await waitFor(() => {
      expect(result.current.listing).not.toBeNull()
    })

    await act(() => result.current.refresh())
    await act(() => result.current.refresh())

    expect(onError).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenLastCalledWith(null)
    expect(result.current.revision).toBe(2)
  })

  it('drops the cards of a folder that vanished', async () => {
    list().mockResolvedValueOnce(ok(A)).mockResolvedValueOnce(refusal('boardFolderUnset'))
    const { result, onError } = renderBoard()
    await waitFor(() => {
      expect(result.current.listing).not.toBeNull()
    })

    await act(() => result.current.refresh())

    expect(result.current.listing).toBeNull()
    expect(result.current.failure?.code).toBe('boardFolderUnset')
    expect(onError).not.toHaveBeenCalled()
  })

  it('drops the cards of a folder that cannot be read any more', async () => {
    list()
      .mockResolvedValueOnce(ok(A))
      .mockResolvedValueOnce(
        refusal('boardFolderUnreadable', { path: '/tmp/board', reason: 'ENOENT' })
      )
    const { result } = renderBoard()
    await waitFor(() => {
      expect(result.current.listing).not.toBeNull()
    })

    await act(() => result.current.refresh())

    expect(result.current.listing).toBeNull()
    expect(result.current.failure?.code).toBe('boardFolderUnreadable')
  })

  it('clears the banner when the folder vanishes after a reported failure', async () => {
    list()
      .mockResolvedValueOnce(ok(A))
      .mockResolvedValueOnce(refusal('cardMissing', { name: 'Fix login.md' }))
      .mockResolvedValueOnce(refusal('boardFolderUnset'))
    const { result, onError } = renderBoard()
    await waitFor(() => {
      expect(result.current.listing).not.toBeNull()
    })

    await act(() => result.current.refresh())
    await act(() => result.current.refresh())

    expect(onError).toHaveBeenLastCalledWith(null)
    expect(result.current.failure?.code).toBe('boardFolderUnset')
  })

  it('keeps the same listing object when nothing changed', async () => {
    list()
      .mockResolvedValueOnce(ok(boardListing([boardCard()])))
      .mockResolvedValueOnce(ok(boardListing([boardCard()])))
    const { result } = renderBoard()
    await waitFor(() => {
      expect(result.current.revision).toBe(1)
    })
    const before = result.current.listing

    await act(() => result.current.refresh())

    expect(result.current.listing).toBe(before)
    expect(result.current.revision).toBe(2)
  })

  it('takes a new listing object when something changed', async () => {
    list().mockResolvedValueOnce(ok(A)).mockResolvedValueOnce(ok(B))
    const { result } = renderBoard()
    await waitFor(() => {
      expect(result.current.revision).toBe(1)
    })
    const before = result.current.listing

    await act(() => result.current.refresh())

    expect(result.current.listing).not.toBe(before)
    expect(result.current.listing?.cards[0]?.title).toBe('B')
  })

  it('drops an answer that a newer read overtook', async () => {
    const first = holdNextRead()
    const { result } = renderBoard()
    list().mockResolvedValueOnce(ok(B))

    await act(() => result.current.refresh())
    await act(async () => {
      first.resolve(ok(A))
      await first.promise
    })

    expect(result.current.listing?.cards[0]?.title).toBe('B')
    expect(result.current.revision).toBe(1)
  })

  it('drops the answer of a project left before it came', async () => {
    const first = holdNextRead()
    const { result, rerender, onError } = renderBoard()
    list().mockResolvedValueOnce(ok(B))

    rerender({ projectId: 'ledger', folder: '/tmp/board', onError })
    await act(async () => {
      first.resolve(ok(A))
      await first.promise
    })

    await waitFor(() => {
      expect(result.current.listing?.cards[0]?.title).toBe('B')
    })
    expect(list()).toHaveBeenLastCalledWith('ledger')
  })

  it('shows nothing of the previous project while the next one is read', async () => {
    givenBoard([boardCard()])
    const { result, rerender, onError } = renderBoard()
    await waitFor(() => {
      expect(result.current.listing).not.toBeNull()
    })
    const next = holdNextRead()

    rerender({ projectId: 'ledger', folder: '/tmp/board', onError })

    expect(result.current.listing).toBeNull()
    expect(result.current.revision).toBe(0)
    await act(async () => {
      next.resolve(ok(B))
      await next.promise
    })
  })

  it('reads again when the window gets the focus', async () => {
    givenBoard([boardCard()])
    const { result } = renderBoard()
    await waitFor(() => {
      expect(result.current.listing).not.toBeNull()
    })

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => {
      expect(list()).toHaveBeenCalledTimes(2)
    })
  })

  it('does not listen for the focus without a folder', () => {
    renderBoard({ folder: '' })

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(list()).not.toHaveBeenCalled()
  })

  it('does not read again when handed a new onError', async () => {
    givenBoard([boardCard()])
    const { result, rerender } = renderBoard()
    await waitFor(() => {
      expect(result.current.listing).not.toBeNull()
    })

    rerender({ projectId: 'planner', folder: '/tmp/board', onError: vi.fn() })

    expect(list()).toHaveBeenCalledTimes(1)
  })

  // The banner belongs to the whole window: a board no longer shown must not write to it.
  it('drops a refresh answered after the screen is gone', async () => {
    givenBoard([boardCard()])
    const { result, unmount, onError } = renderBoard()
    await waitFor(() => {
      expect(result.current.listing).not.toBeNull()
    })
    const late = holdNextRead()
    let refreshed: Promise<void> = Promise.resolve()
    act(() => {
      refreshed = result.current.refresh()
    })

    unmount()
    await act(async () => {
      late.resolve(refusal('cardMissing', { name: 'Fix login.md' }))
      await refreshed
    })

    expect(onError).not.toHaveBeenCalled()
  })

  it('drops a refresh answered after the folder was cleared', async () => {
    givenBoard([boardCard()])
    const { result, rerender, onError } = renderBoard()
    await waitFor(() => {
      expect(result.current.listing).not.toBeNull()
    })
    const late = holdNextRead()
    let refreshed: Promise<void> = Promise.resolve()
    act(() => {
      refreshed = result.current.refresh()
    })

    rerender({ projectId: 'planner', folder: '', onError })
    await act(async () => {
      late.resolve(refusal('cardMissing', { name: 'Fix login.md' }))
      await refreshed
    })

    expect(onError).not.toHaveBeenCalled()
  })

  describe('writes', () => {
    it('creates a card and reads the board again', async () => {
      givenBoard([])
      const { result, onError } = renderBoard()
      await waitFor(() => {
        expect(result.current.listing).not.toBeNull()
      })

      const made = await act(() => result.current.create({ status: 'backlog', title: 'Fix login' }))

      expect(made).toBe('backlog/Fix login.md')
      expect(octopus().board.create).toHaveBeenCalledWith('planner', {
        status: 'backlog',
        title: 'Fix login'
      })
      expect(list()).toHaveBeenCalledTimes(2)
      expect(onError).toHaveBeenLastCalledWith(null)
    })

    it('reads the board again after a refused write', async () => {
      givenBoard([])
      vi.mocked(octopus().board.create).mockResolvedValueOnce(
        refusal('cardNameTaken', { name: 'Fix login.md' })
      )
      const { result, onError } = renderBoard()
      await waitFor(() => {
        expect(result.current.listing).not.toBeNull()
      })

      const made = await act(() => result.current.create({ status: 'backlog', title: 'Fix login' }))

      expect(made).toBeNull()
      expect(onError).toHaveBeenCalledWith('A file named “Fix login.md” is already there.')
      expect(list()).toHaveBeenCalledTimes(2)
    })

    it('drops a write answered after the project changed', async () => {
      givenBoard([boardCard()])
      const sent = held<Result<string>>()
      vi.mocked(octopus().board.create).mockReturnValueOnce(sent.promise)
      const { result, rerender, onError } = renderBoard()
      await waitFor(() => {
        expect(result.current.listing).not.toBeNull()
      })
      let made: Promise<string | null> = Promise.resolve(null)
      act(() => {
        made = result.current.create({ status: 'backlog', title: 'Fix login' })
      })
      const next = holdNextRead()

      rerender({ projectId: 'ledger', folder: '/tmp/board', onError })
      await act(async () => {
        sent.resolve(refusal('cardNameTaken', { name: 'Fix login.md' }))
        await made
      })
      await act(async () => {
        next.resolve(ok(B))
        await next.promise
      })

      expect(result.current.listing?.cards[0]?.title).toBe('B')
      expect(onError).not.toHaveBeenCalled()
    })

    it('drops a refusal whose board left while it was read again', async () => {
      givenBoard([boardCard()])
      vi.mocked(octopus().board.create).mockResolvedValueOnce(
        refusal('cardNameTaken', { name: 'Fix login.md' })
      )
      const { result, rerender, onError } = renderBoard()
      await waitFor(() => {
        expect(result.current.listing).not.toBeNull()
      })
      const reread = holdNextRead()
      let made: Promise<string | null> = Promise.resolve(null)
      act(() => {
        made = result.current.create({ status: 'backlog', title: 'Fix login' })
      })
      await waitFor(() => {
        expect(list()).toHaveBeenCalledTimes(2)
      })

      rerender({ projectId: 'ledger', folder: '/tmp/board', onError })
      await act(async () => {
        reread.resolve(ok(A))
        await made
      })

      expect(onError).not.toHaveBeenCalled()
    })

    it('keeps a refusal in the banner when the read after it clears an earlier failure', async () => {
      list()
        .mockResolvedValueOnce(ok(A))
        .mockResolvedValueOnce(refusal('cardMissing', { name: 'Fix login.md' }))
        .mockResolvedValueOnce(ok(A))
      vi.mocked(octopus().board.create).mockResolvedValueOnce(
        refusal('cardNameTaken', { name: 'Fix login.md' })
      )
      const { result, onError } = renderBoard()
      await waitFor(() => {
        expect(result.current.listing).not.toBeNull()
      })
      await act(() => result.current.refresh())

      await act(() => result.current.create({ status: 'backlog', title: 'Fix login' }))

      expect(onError).toHaveBeenLastCalledWith('A file named “Fix login.md” is already there.')
    })

    it('writes nothing without a folder', async () => {
      const { result } = renderBoard({ folder: '' })

      const made = await act(() => result.current.create({ status: 'backlog', title: 'Fix login' }))

      expect(made).toBeNull()
      expect(octopus().board.create).not.toHaveBeenCalled()
    })

    it('updates a card', async () => {
      givenBoard([boardCard()])
      const { result } = renderBoard()
      await waitFor(() => {
        expect(result.current.listing).not.toBeNull()
      })

      const updated = await act(() =>
        result.current.update('backlog/Fix login.md', { priority: 'high' })
      )

      expect(updated).toBe(true)
      expect(octopus().board.update).toHaveBeenCalledWith('planner', 'backlog/Fix login.md', {
        priority: 'high'
      })
      expect(list()).toHaveBeenCalledTimes(2)
    })

    it('answers false for a refused update', async () => {
      givenBoard([boardCard()])
      vi.mocked(octopus().board.update).mockResolvedValueOnce(
        refusal('cardMissing', { name: 'Fix login.md' })
      )
      const { result } = renderBoard()
      await waitFor(() => {
        expect(result.current.listing).not.toBeNull()
      })

      const updated = await act(() =>
        result.current.update('backlog/Fix login.md', { priority: 'high' })
      )

      expect(updated).toBe(false)
    })

    it('hands back the new ref of a moved card', async () => {
      givenBoard([boardCard()])
      const { result } = renderBoard()
      await waitFor(() => {
        expect(result.current.listing).not.toBeNull()
      })

      const moved = await act(() =>
        result.current.move('backlog/Fix login.md', { status: 'done', index: 0 })
      )

      expect(moved).toBe('done/Fix login.md')
      expect(octopus().board.move).toHaveBeenCalledWith('planner', 'backlog/Fix login.md', {
        status: 'done',
        index: 0
      })
    })

    it('answers null for a refused move', async () => {
      givenBoard([boardCard()])
      vi.mocked(octopus().board.move).mockResolvedValueOnce(
        refusal('cardMissing', { name: 'Fix login.md' })
      )
      const { result, onError } = renderBoard()
      await waitFor(() => {
        expect(result.current.listing).not.toBeNull()
      })

      const moved = await act(() =>
        result.current.move('backlog/Fix login.md', { status: 'done', index: 0 })
      )

      expect(moved).toBeNull()
      expect(onError).toHaveBeenCalledWith('“Fix login.md” is no longer on disk.')
    })

    it('removes a card', async () => {
      givenBoard([boardCard()])
      const { result } = renderBoard()
      await waitFor(() => {
        expect(result.current.listing).not.toBeNull()
      })

      const removed = await act(() => result.current.remove('backlog/Fix login.md'))

      expect(removed).toBe(true)
      expect(octopus().board.remove).toHaveBeenCalledWith('planner', 'backlog/Fix login.md')
    })

    it('writes nothing without a folder, whatever the write', async () => {
      const { result } = renderBoard({ folder: '' })

      const updated = await act(() => result.current.update('a', {}))
      const moved = await act(() => result.current.move('a', { status: 'done', index: 0 }))
      const removed = await act(() => result.current.remove('a'))

      expect([updated, moved, removed]).toEqual([false, null, false])
      expect(octopus().board.update).not.toHaveBeenCalled()
      expect(octopus().board.move).not.toHaveBeenCalled()
      expect(octopus().board.remove).not.toHaveBeenCalled()
    })
  })
})
