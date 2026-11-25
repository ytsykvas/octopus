import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { type BoardColumnSet, DEFAULT_COLUMNS } from '@core/boardColumns.js'

import { refusal } from '../test/board.js'
import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { useBoardColumns } from './useBoardColumns.js'

const IDEAS: BoardColumnSet = {
  columns: [...DEFAULT_COLUMNS, { kind: 'custom', id: 'Ideas', name: 'Ideas' }],
  own: true
}
const refused = {
  ok: false,
  error: 'still there',
  code: 'columnNotEmpty',
  params: { project: 'planner', count: '2' }
} as const

describe('useBoardColumns', () => {
  it('reads the columns it was asked for when it mounts', async () => {
    const { result } = renderHook(() => useBoardColumns('planner'))

    await waitFor(() => {
      expect(result.current.set).toEqual({ columns: DEFAULT_COLUMNS, own: false })
    })
    expect(octopus().board.columns).toHaveBeenCalledWith('planner')
  })

  it('reads again for another project', async () => {
    const { rerender } = renderHook(({ id }) => useBoardColumns(id), {
      initialProps: { id: null as string | null }
    })
    await waitFor(() => {
      expect(octopus().board.columns).toHaveBeenCalledWith(null)
    })

    rerender({ id: 'planner' })

    await waitFor(() => {
      expect(octopus().board.columns).toHaveBeenLastCalledWith('planner')
    })
  })

  it('keeps the columns of the project it shows when the last one answers late', async () => {
    const late = held<Awaited<ReturnType<typeof window.octopus.board.columns>>>()
    vi.mocked(octopus().board.columns)
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce({ ok: true, value: IDEAS })
    const { result, rerender } = renderHook(({ id }) => useBoardColumns(id), {
      initialProps: { id: null as string | null }
    })

    rerender({ id: 'planner' })
    await waitFor(() => {
      expect(result.current.set).toEqual(IDEAS)
    })
    await act(async () => {
      late.resolve({ ok: true, value: { columns: DEFAULT_COLUMNS, own: false } })
      await late.promise
    })

    expect(result.current.set).toEqual(IDEAS)
  })

  it('says why the columns could not be read', async () => {
    vi.mocked(octopus().board.columns).mockResolvedValue(refusal('worktreeMissing'))

    const { result } = renderHook(() => useBoardColumns('gone'))

    await waitFor(() => {
      expect(result.current.error).toBe('That workspace is no longer there.')
    })
  })

  it('takes the columns an edit answers with', async () => {
    vi.mocked(octopus().board.editColumns).mockResolvedValue({ ok: true, value: IDEAS })
    const { result } = renderHook(() => useBoardColumns('planner'))

    let done = false
    await act(async () => {
      done = await result.current.edit({ kind: 'add', name: 'Ideas' })
    })

    expect(done).toBe(true)
    expect(octopus().board.editColumns).toHaveBeenCalledWith('planner', {
      kind: 'add',
      name: 'Ideas'
    })
    expect(result.current.set).toEqual(IDEAS)
  })

  it('keeps the columns and says why an edit was refused, until one works', async () => {
    vi.mocked(octopus().board.columns).mockResolvedValue({ ok: true, value: IDEAS })
    vi.mocked(octopus().board.editColumns).mockResolvedValueOnce(refused)
    const { result } = renderHook(() => useBoardColumns(null))
    await waitFor(() => {
      expect(result.current.set).toEqual(IDEAS)
    })

    let done = true
    await act(async () => {
      done = await result.current.edit({ kind: 'remove', id: 'Ideas' })
    })

    expect(done).toBe(false)
    expect(result.current.set).toEqual(IDEAS)
    expect(result.current.error).toMatch(/Move them out first/)

    await act(async () => {
      await result.current.edit({ kind: 'reorder', ids: [] })
    })
    expect(result.current.error).toBeNull()
  })

  it('sends a project back to the default columns', async () => {
    vi.mocked(octopus().board.columns).mockResolvedValue({ ok: true, value: IDEAS })
    const { result } = renderHook(() => useBoardColumns('planner'))
    await waitFor(() => {
      expect(result.current.set).toEqual(IDEAS)
    })

    await act(async () => {
      await result.current.reset('planner')
    })

    expect(octopus().board.resetColumns).toHaveBeenCalledWith('planner')
    expect(result.current.set).toEqual({ columns: DEFAULT_COLUMNS, own: false })
  })
})
