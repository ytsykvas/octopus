import { act, renderHook, type RenderHookResult, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, type Mock, type MockedFunction } from 'vitest'

import type { BoardChangedEvent, BoardListing } from '@core/boardSchema.js'

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

  describe('changes on disk', () => {
    /** Catches the board's subscription, so a test can report a change on disk. */
    function listenFor(): {
      readonly fire: (event: BoardChangedEvent) => void
      readonly unsubscribe: Mock
    } {
      let saved: ((event: BoardChangedEvent) => void) | null = null
      const unsubscribe = vi.fn()
      vi.mocked(octopus().board.onChanged).mockImplementation((handler) => {
        saved = handler
        return unsubscribe
      })
      return {
        fire: (event) => {
          saved?.(event)
        },
        unsubscribe
      }
    }

    it('reads the board again when its folder changed', async () => {
      const disk = listenFor()
      renderBoard()
      await waitFor(() => {
        expect(list()).toHaveBeenCalledTimes(1)
      })

      act(() => {
        disk.fire({ projectId: 'planner' })
      })

      await waitFor(() => {
        expect(list()).toHaveBeenCalledTimes(2)
      })
    })

    it("ignores a change in another project's folder", async () => {
      const disk = listenFor()
      renderBoard()
      await waitFor(() => {
        expect(list()).toHaveBeenCalledTimes(1)
      })

      act(() => {
        disk.fire({ projectId: 'esl' })
      })
      await act(() => Promise.resolve())

      expect(list()).toHaveBeenCalledTimes(1)
    })

    it('stops listening when it unmounts', () => {
      const disk = listenFor()
      const { unmount } = renderBoard()

      unmount()

      expect(disk.unsubscribe).toHaveBeenCalled()
    })

    it('listens to nothing without a project', async () => {
      renderBoard({ projectId: null })
      await act(() => Promise.resolve())

      expect(octopus().board.onChanged).not.toHaveBeenCalled()
    })

    it('listens to nothing without a folder', async () => {
      renderBoard({ folder: '' })
      await act(() => Promise.resolve())

      expect(octopus().board.onChanged).not.toHaveBeenCalled()
    })
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

    it('answers every write that outlived its board as if it were refused', async () => {
      givenBoard([boardCard()])
      const created = held<Result<string>>()
      const updated = held<Result<undefined>>()
      const moved = held<Result<string>>()
      const removed = held<Result<undefined>>()
      vi.mocked(octopus().board.create).mockReturnValueOnce(created.promise)
      vi.mocked(octopus().board.update).mockReturnValueOnce(updated.promise)
      vi.mocked(octopus().board.move).mockReturnValueOnce(moved.promise)
      vi.mocked(octopus().board.remove).mockReturnValueOnce(removed.promise)
      const { result, rerender, onError } = renderBoard()
      await waitFor(() => {
        expect(result.current.listing).not.toBeNull()
      })
      const writes = Promise.all([
        result.current.create({ status: 'backlog', title: 'Fix login' }),
        result.current.update('backlog/Fix login.md', { priority: 'high' }),
        result.current.move('backlog/Fix login.md', { status: 'done', index: 0 }),
        result.current.remove('backlog/Fix login.md')
      ])

      rerender({ projectId: 'ledger', folder: '/tmp/board', onError })
      created.resolve(ok('backlog/Fix login.md'))
      updated.resolve(ok(undefined))
      moved.resolve(ok('done/Fix login.md'))
      removed.resolve(ok(undefined))

      expect(await act(() => writes)).toEqual([null, false, null, false])
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

    it('renames a card', async () => {
      givenBoard([boardCard()])
      const { result } = renderBoard()
      await waitFor(() => {
        expect(result.current.listing).not.toBeNull()
      })

      const renamed = await act(() => result.current.rename('backlog/Fix login.md', 'Fix sign-in'))

      expect(renamed).toBe(true)
      expect(octopus().board.rename).toHaveBeenCalledWith(
        'planner',
        'backlog/Fix login.md',
        'Fix sign-in'
      )
      expect(list()).toHaveBeenCalledTimes(2)
    })

    it('adds a comment', async () => {
      givenBoard([boardCard()])
      const { result } = renderBoard()
      await waitFor(() => {
        expect(result.current.listing).not.toBeNull()
      })

      const added = await act(() =>
        result.current.comment('backlog/Fix login.md', 'Asked the manager.')
      )

      expect(added).toBe(true)
      expect(octopus().board.comment).toHaveBeenCalledWith(
        'planner',
        'backlog/Fix login.md',
        'Asked the manager.'
      )
    })

    it('saves a description', async () => {
      givenBoard([boardCard()])
      const { result, onError } = renderBoard()
      await waitFor(() => {
        expect(result.current.listing).not.toBeNull()
      })

      const failure = await act(() =>
        result.current.saveDescription('backlog/Fix login.md', { text: 'New', base: 'Old' })
      )

      expect(failure).toBeNull()
      expect(octopus().board.saveDescription).toHaveBeenCalledWith(
        'planner',
        'backlog/Fix login.md',
        { text: 'New', base: 'Old' }
      )
      expect(onError).toHaveBeenLastCalledWith(null)
      expect(list()).toHaveBeenCalledTimes(2)
    })

    it('hands a changed description back without the banner', async () => {
      givenBoard([boardCard()])
      const changed = refusal('cardChanged', { name: 'Fix login.md' })
      vi.mocked(octopus().board.saveDescription).mockResolvedValueOnce(changed)
      const { result, onError } = renderBoard()
      await waitFor(() => {
        expect(result.current.listing).not.toBeNull()
      })

      const failure = await act(() =>
        result.current.saveDescription('backlog/Fix login.md', { text: 'New', base: 'Old' })
      )

      expect(failure).toBe(changed)
      expect(onError).not.toHaveBeenCalled()
      expect(list()).toHaveBeenCalledTimes(2)
    })

    it('reports any other refusal of a description', async () => {
      givenBoard([boardCard()])
      const missing = refusal('cardMissing', { name: 'Fix login.md' })
      vi.mocked(octopus().board.saveDescription).mockResolvedValueOnce(missing)
      const { result, onError } = renderBoard()
      await waitFor(() => {
        expect(result.current.listing).not.toBeNull()
      })

      const failure = await act(() =>
        result.current.saveDescription('backlog/Fix login.md', { text: 'New', base: 'Old' })
      )

      expect(failure).toBe(missing)
      expect(onError).toHaveBeenCalledWith('“Fix login.md” is no longer on disk.')
    })

    it('answers a rename, a description and a comment that outlived their board as if nothing were refused', async () => {
      givenBoard([boardCard()])
      const renamed = held<Result<undefined>>()
      const saved = held<Result<undefined>>()
      const commented = held<Result<undefined>>()
      vi.mocked(octopus().board.rename).mockReturnValueOnce(renamed.promise)
      vi.mocked(octopus().board.saveDescription).mockReturnValueOnce(saved.promise)
      vi.mocked(octopus().board.comment).mockReturnValueOnce(commented.promise)
      const { result, rerender, onError } = renderBoard()
      await waitFor(() => {
        expect(result.current.listing).not.toBeNull()
      })
      const writes = Promise.all([
        result.current.rename('backlog/Fix login.md', 'Fix sign-in'),
        result.current.saveDescription('backlog/Fix login.md', { text: 'New', base: 'Old' }),
        result.current.comment('backlog/Fix login.md', 'Asked.')
      ])

      rerender({ projectId: 'ledger', folder: '/tmp/board', onError })
      renamed.resolve(refusal('cardMissing', { name: 'Fix login.md' }))
      saved.resolve(refusal('cardMissing', { name: 'Fix login.md' }))
      commented.resolve(refusal('cardMissing', { name: 'Fix login.md' }))

      expect(await act(() => writes)).toEqual([false, null, false])
      expect(onError).not.toHaveBeenCalled()
    })

    it('reports a rename refused without a code', async () => {
      givenBoard([boardCard()])
      vi.mocked(octopus().board.rename).mockResolvedValueOnce({ ok: false, error: 'Disk full' })
      const { result, onError } = renderBoard()
      await waitFor(() => {
        expect(result.current.listing).not.toBeNull()
      })

      const renamed = await act(() => result.current.rename('backlog/Fix login.md', 'Fix sign-in'))

      expect(renamed).toBe(false)
      expect(onError).toHaveBeenLastCalledWith('Something went wrong: Disk full')
    })

    it('writes no rename, description or comment without a folder', async () => {
      const { result } = renderBoard({ folder: '' })

      const renamed = await act(() => result.current.rename('a', 'T'))
      const commented = await act(() => result.current.comment('a', 'x'))
      const saved = await act(() => result.current.saveDescription('a', { text: '', base: null }))

      expect([renamed, commented, saved]).toEqual([false, false, null])
      expect(octopus().board.rename).not.toHaveBeenCalled()
      expect(octopus().board.comment).not.toHaveBeenCalled()
      expect(octopus().board.saveDescription).not.toHaveBeenCalled()
    })
  })
})
