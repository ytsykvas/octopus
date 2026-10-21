import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DirectoryListing, FileTreeSnapshot } from '@core/fileTree.js'

import { emitAgentEvent } from '../test/chat.js'
import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { useFileTree } from './useFileTree.js'
import { SETTLE_MS } from './useTurnSettled.js'

const WORKSPACE = 'planner/anna'
const NONE: ReadonlySet<string> = new Set()
const OPEN: ReadonlySet<string> = new Set(['node_modules'])

const SNAPSHOT: FileTreeSnapshot = {
  entries: [
    { path: 'src/a.ts', kind: 'file', ignored: false },
    { path: 'node_modules', kind: 'directory', ignored: true }
  ],
  statuses: { 'src/a.ts': 'modified' },
  truncated: false
}

const answering = (snapshot: FileTreeSnapshot = SNAPSHOT): void => {
  vi.mocked(octopus().files.tree).mockResolvedValue({ ok: true, value: snapshot })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the tree of a workspace', () => {
  it('reads the tree when shown, with each folder told what is inside it', async () => {
    answering()

    const { result } = renderHook(() => useFileTree(WORKSPACE, true, NONE))

    await waitFor(() => {
      expect(result.current.index?.get('')?.map((node) => node.name)).toEqual([
        'node_modules',
        'src'
      ])
    })
    expect(result.current.statuses).toEqual({ 'src/a.ts': 'modified' })
    expect(result.current.folders).toEqual({ src: 'modified' })
    expect(result.current.truncated).toBe(false)
  })

  it('reads nothing while hidden, or before a workspace is chosen', () => {
    renderHook(() => useFileTree(WORKSPACE, false, NONE))
    const { result } = renderHook(() => useFileTree(null, true, NONE))

    expect(octopus().files.tree).not.toHaveBeenCalled()
    expect(result.current.index).toBeNull()
  })

  it('says why the tree could not be read', async () => {
    vi.mocked(octopus().files.tree).mockResolvedValue({ ok: false, error: 'git broke' })

    const { result } = renderHook(() => useFileTree(WORKSPACE, true, NONE))

    await waitFor(() => {
      expect(result.current.error).toContain('git broke')
    })
  })

  it('reads an ignored folder once it is opened, into the tree', async () => {
    answering()
    vi.mocked(octopus().files.directory).mockResolvedValue({
      ok: true,
      value: { entries: [{ name: 'pkg', kind: 'directory' }], truncated: true }
    })
    const { result, rerender } = renderHook(({ open }) => useFileTree(WORKSPACE, true, open), {
      initialProps: { open: NONE }
    })
    await waitFor(() => {
      expect(result.current.index).not.toBeNull()
    })
    expect(octopus().files.directory).not.toHaveBeenCalled()

    rerender({ open: OPEN })

    await waitFor(() => {
      expect(result.current.listings.get('node_modules')).toEqual({
        status: 'ready',
        truncated: true
      })
    })
    expect(octopus().files.directory).toHaveBeenCalledWith(WORKSPACE, 'node_modules')
    expect(result.current.index?.get('node_modules')).toEqual([
      {
        name: 'pkg',
        path: 'node_modules/pkg',
        kind: 'directory',
        ignored: true,
        childrenFromDisk: true
      }
    ])
  })

  /*
   * The open folders are the panel's and outlive this hook — kept per
   * workspace, across a switch and back — while the listings are this hook's
   * and start empty. A folder already open when the tree is first read is
   * read with it, or its row says "Reading…" for good.
   */
  describe('a folder already open when the tree is read', () => {
    const listing = (name: string) =>
      ({
        ok: true,
        value: { entries: [{ name, kind: 'directory' }], truncated: false }
      }) as const

    it('is read from disk with the tree, and one open inside it too', async () => {
      answering()
      vi.mocked(octopus().files.directory).mockImplementation((_, path) =>
        Promise.resolve(listing(path === 'node_modules' ? 'pkg' : 'lib'))
      )

      const { result } = renderHook(() =>
        useFileTree(WORKSPACE, true, new Set(['node_modules', 'node_modules/pkg']))
      )

      await waitFor(() => {
        expect(result.current.index?.get('node_modules/pkg')?.map((node) => node.name)).toEqual([
          'lib'
        ])
      })
      expect(result.current.index?.get('node_modules')?.map((node) => node.name)).toEqual(['pkg'])
    })

    it('is read again after a switch to another workspace and back', async () => {
      answering()
      vi.mocked(octopus().files.directory).mockResolvedValue(listing('pkg'))
      const { result, rerender } = renderHook(({ id }) => useFileTree(id, true, OPEN), {
        initialProps: { id: WORKSPACE }
      })
      await waitFor(() => {
        expect(result.current.listings.get('node_modules')?.status).toBe('ready')
      })

      rerender({ id: 'planner/bob' })
      await waitFor(() => {
        expect(octopus().files.directory).toHaveBeenCalledWith('planner/bob', 'node_modules')
      })
      rerender({ id: WORKSPACE })

      await waitFor(() => {
        expect(result.current.listings.get('node_modules')?.status).toBe('ready')
      })
      expect(result.current.index?.get('node_modules')?.map((node) => node.name)).toEqual(['pkg'])
    })

    // A refresh re-reads what is held; one still on its way is not asked twice,
    // nor is it asked again by a render while it is under way.
    it('is read once when a refresh comes while its read is under way', async () => {
      answering()
      const slow = held<ReturnType<typeof listing>>()
      vi.mocked(octopus().files.directory).mockReturnValue(slow.promise)
      const { result } = renderHook(() => useFileTree(WORKSPACE, true, OPEN))
      await waitFor(() => {
        expect(octopus().files.directory).toHaveBeenCalledOnce()
      })

      const trees = vi.mocked(octopus().files.tree).mock.calls.length
      act(() => {
        result.current.refresh()
      })
      await waitFor(() => {
        expect(octopus().files.tree).toHaveBeenCalledTimes(trees + 1)
      })
      await act(async () => {
        await Promise.resolve()
      })
      expect(octopus().files.directory).toHaveBeenCalledOnce()

      await act(async () => {
        slow.resolve(listing('pkg'))
        await slow.promise
      })
      expect(result.current.index?.get('node_modules')?.map((node) => node.name)).toEqual(['pkg'])
    })

    // Landed while the refresh was reading the tree: that read did not re-read
    // it, and must not drop the listing it finds held, or it is read again.
    it('keeps a listing that lands while a refresh reads the tree', async () => {
      const tree = held<{ ok: true; value: FileTreeSnapshot }>()
      vi.mocked(octopus().files.tree)
        .mockResolvedValueOnce({ ok: true, value: SNAPSHOT })
        .mockReturnValueOnce(tree.promise)
      const slow = held<ReturnType<typeof listing>>()
      vi.mocked(octopus().files.directory).mockReturnValue(slow.promise)
      const { result } = renderHook(() => useFileTree(WORKSPACE, true, OPEN))
      await waitFor(() => {
        expect(octopus().files.directory).toHaveBeenCalledOnce()
      })

      act(() => {
        result.current.refresh()
      })
      await act(async () => {
        slow.resolve(listing('pkg'))
        await slow.promise
      })
      expect(result.current.listings.get('node_modules')?.status).toBe('ready')
      await act(async () => {
        tree.resolve({ ok: true, value: SNAPSHOT })
        await tree.promise
      })

      expect(result.current.index?.get('node_modules')?.map((node) => node.name)).toEqual(['pkg'])
      expect(octopus().files.directory).toHaveBeenCalledOnce()
    })

    // A folder git lists has its children from git; reading it from disk too
    // would be a wasted read on every turn.
    it('is left to git when git lists what is inside it', async () => {
      answering()

      const { result } = renderHook(() => useFileTree(WORKSPACE, true, new Set(['src'])))

      await waitFor(() => {
        expect(result.current.index).not.toBeNull()
      })
      expect(octopus().files.directory).not.toHaveBeenCalled()
    })
  })

  it('marks an ignored folder that could not be read, asked for once', async () => {
    answering()
    vi.mocked(octopus().files.directory).mockResolvedValue({ ok: false, error: 'gone' })
    const { result } = renderHook(() => useFileTree(WORKSPACE, true, OPEN))

    await waitFor(() => {
      expect(result.current.listings.get('node_modules')).toEqual({ status: 'failed' })
    })
    expect(octopus().files.directory).toHaveBeenCalledOnce()
  })

  it('reads the tree again after a turn ends, and the folders opened with it', async () => {
    answering()
    vi.mocked(octopus().files.directory).mockResolvedValue({
      ok: true,
      value: { entries: [], truncated: false }
    })
    const { result } = renderHook(() => useFileTree(WORKSPACE, true, OPEN))
    await waitFor(() => {
      expect(result.current.index).not.toBeNull()
    })
    await waitFor(() => {
      expect(result.current.listings.get('node_modules')?.status).toBe('ready')
    })

    vi.mocked(octopus().files.directory).mockResolvedValueOnce({ ok: false, error: 'gone' })
    vi.useFakeTimers()
    emitAgentEvent({ type: 'error', message: 'stopped' })
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS)
    })
    vi.useRealTimers()

    await waitFor(() => {
      expect(result.current.listings.get('node_modules')).toEqual({ status: 'failed' })
    })
    expect(octopus().files.tree).toHaveBeenCalledTimes(2)
  })

  it('reads again on refresh, the folders opened so far included', async () => {
    answering()
    vi.mocked(octopus().files.directory).mockResolvedValue({
      ok: true,
      value: { entries: [], truncated: false }
    })
    const { result } = renderHook(() => useFileTree(WORKSPACE, true, OPEN))
    await waitFor(() => {
      expect(result.current.index).not.toBeNull()
    })
    await waitFor(() => {
      expect(result.current.listings.get('node_modules')?.status).toBe('ready')
    })

    answering({ ...SNAPSHOT, truncated: true })
    vi.mocked(octopus().files.directory).mockResolvedValue({
      ok: true,
      value: { entries: [], truncated: true }
    })
    act(() => {
      result.current.refresh()
    })

    await waitFor(() => {
      expect(result.current.truncated).toBe(true)
    })
    expect(result.current.listings.get('node_modules')).toEqual({
      status: 'ready',
      truncated: true
    })
  })

  // Another workspace was opened while git was reading.
  it('drops a reply that arrives after the workspace changed', async () => {
    let finish: (value: { ok: true; value: FileTreeSnapshot }) => void = () => undefined
    vi.mocked(octopus().files.tree).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    answering({ ...SNAPSHOT, statuses: {} })
    const { result, rerender } = renderHook(({ id }) => useFileTree(id, true, NONE), {
      initialProps: { id: WORKSPACE }
    })

    rerender({ id: 'planner/bob' })
    await waitFor(() => {
      expect(result.current.index).not.toBeNull()
    })
    await act(async () => {
      finish({ ok: true, value: SNAPSHOT })
      await Promise.resolve()
    })

    expect(result.current.statuses).toEqual({})
  })

  it('drops a reply that arrives after the workspace was put down', async () => {
    let finish: (value: { ok: true; value: FileTreeSnapshot }) => void = () => undefined
    vi.mocked(octopus().files.tree).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const { result, rerender } = renderHook<ReturnType<typeof useFileTree>, { id: string | null }>(
      ({ id }) => useFileTree(id, true, NONE),
      { initialProps: { id: WORKSPACE } }
    )

    rerender({ id: null })
    await act(async () => {
      finish({ ok: true, value: SNAPSHOT })
      await Promise.resolve()
    })

    expect(result.current.index).toBeNull()
  })

  it('drops a folder read that lands after the workspace changed', async () => {
    answering()
    const late = held<{ ok: false; error: string }>()
    vi.mocked(octopus().files.directory).mockImplementation((id) =>
      id === WORKSPACE ? late.promise : new Promise(() => undefined)
    )
    const { result, rerender } = renderHook(({ id }) => useFileTree(id, true, OPEN), {
      initialProps: { id: WORKSPACE }
    })
    await waitFor(() => {
      expect(octopus().files.directory).toHaveBeenCalledWith(WORKSPACE, 'node_modules')
    })

    rerender({ id: 'planner/bob' })
    // The same folder in the next workspace is its own read, not the one under way.
    await waitFor(() => {
      expect(octopus().files.directory).toHaveBeenCalledWith('planner/bob', 'node_modules')
    })
    await act(async () => {
      late.resolve({ ok: false, error: 'late' })
      await late.promise
    })

    expect(result.current.listings.size).toBe(0)
  })

  // Opened once and closed again, a folder of thousands must not be read on
  // every turn from then on.
  it('lets go of a folder that is closed, rather than reading it again', async () => {
    answering()
    vi.mocked(octopus().files.directory).mockResolvedValue({
      ok: true,
      value: { entries: [], truncated: false }
    })
    const { result, rerender } = renderHook(({ open }) => useFileTree(WORKSPACE, true, open), {
      initialProps: { open: OPEN }
    })
    await waitFor(() => {
      expect(result.current.listings.get('node_modules')?.status).toBe('ready')
    })

    rerender({ open: NONE })
    act(() => {
      result.current.refresh()
    })

    await waitFor(() => {
      expect(result.current.listings.has('node_modules')).toBe(false)
    })
    expect(octopus().files.directory).toHaveBeenCalledTimes(1)
  })

  // `git add -f` or an edited .gitignore: the folder is git's again.
  it("goes back to git's own rows for a folder that is no longer ignored", async () => {
    answering()
    vi.mocked(octopus().files.directory).mockResolvedValue({
      ok: true,
      value: { entries: [{ name: 'stale.js', kind: 'file' }], truncated: false }
    })
    const { result } = renderHook(() => useFileTree(WORKSPACE, true, OPEN))
    await waitFor(() => {
      expect(result.current.index).not.toBeNull()
    })
    await waitFor(() => {
      expect(result.current.index?.get('node_modules')?.[0]?.name).toBe('stale.js')
    })

    answering({
      entries: [{ path: 'node_modules/kept.js', kind: 'file', ignored: false }],
      statuses: {},
      truncated: false
    })
    act(() => {
      result.current.refresh()
    })

    await waitFor(() => {
      expect(result.current.index?.get('node_modules')?.map((node) => node.name)).toEqual([
        'kept.js'
      ])
    })
  })

  // Deleted whole, or taken back into git: the listing is let go with the row,
  // or every turn would read a folder nobody is shown again, and fail on one
  // that is gone.
  it('stops reading an open folder git no longer names whole', async () => {
    answering()
    vi.mocked(octopus().files.directory).mockResolvedValue({
      ok: true,
      value: { entries: [], truncated: false }
    })
    const { result } = renderHook(() => useFileTree(WORKSPACE, true, OPEN))
    await waitFor(() => {
      expect(result.current.listings.get('node_modules')?.status).toBe('ready')
    })

    answering({ entries: [], statuses: {}, truncated: false })
    act(() => {
      result.current.refresh()
    })
    await waitFor(() => {
      expect(result.current.listings.has('node_modules')).toBe(false)
    })
    const reads = vi.mocked(octopus().files.directory).mock.calls.length

    act(() => {
      result.current.refresh()
    })
    await waitFor(() => {
      expect(octopus().files.tree).toHaveBeenCalledTimes(3)
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(octopus().files.directory).toHaveBeenCalledTimes(reads)
  })

  // `node_modules/pkg` removed by a reinstall while `node_modules` stays
  // ignored: git still names the outer folder whole, so only the outer
  // listing can say the inner one is gone.
  it.each([
    ['gone', []],
    ['a file now', [{ name: 'pkg', kind: 'file' as const }]]
  ])('stops reading a folder inside a read one once it is %s', async (_, after) => {
    answering()
    let installed = true
    vi.mocked(octopus().files.directory).mockImplementation((_, path) =>
      Promise.resolve(
        path === 'node_modules'
          ? {
              ok: true,
              value: {
                entries: installed ? [{ name: 'pkg', kind: 'directory' }] : after,
                truncated: false
              }
            }
          : installed
            ? {
                ok: true,
                value: {
                  entries: path === 'node_modules/pkg' ? [{ name: 'lib', kind: 'directory' }] : [],
                  truncated: false
                }
              }
            : { ok: false, error: 'gone' }
      )
    )
    // And a folder inside that one, which goes with it.
    const open = new Set(['node_modules', 'node_modules/pkg', 'node_modules/pkg/lib'])
    const { result } = renderHook(() => useFileTree(WORKSPACE, true, open))
    await waitFor(() => {
      expect(result.current.listings.get('node_modules/pkg/lib')?.status).toBe('ready')
    })

    installed = false
    act(() => {
      result.current.refresh()
    })
    await waitFor(() => {
      expect(result.current.listings.has('node_modules/pkg')).toBe(false)
    })
    expect(result.current.listings.has('node_modules/pkg/lib')).toBe(false)
    expect(result.current.listings.get('node_modules')?.status).toBe('ready')
    const reads = vi
      .mocked(octopus().files.directory)
      .mock.calls.filter(([, path]) => path.startsWith('node_modules/pkg')).length

    act(() => {
      result.current.refresh()
    })
    await waitFor(() => {
      expect(octopus().files.tree).toHaveBeenCalledTimes(3)
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(
      vi
        .mocked(octopus().files.directory)
        .mock.calls.filter(([, path]) => path.startsWith('node_modules/pkg'))
    ).toHaveLength(reads)

    // Installed again: the outer listing read on this turn names it, so it is
    // read on this turn too, not on the one after.
    installed = true
    act(() => {
      result.current.refresh()
    })
    await waitFor(() => {
      expect(result.current.listings.get('node_modules/pkg/lib')?.status).toBe('ready')
    })
    expect(octopus().files.tree).toHaveBeenCalledTimes(4)
  })

  // Still loading, a listing says nothing about what is inside it yet.
  it('reads a folder inside one whose listing is still on its way', async () => {
    const tree = held<{ ok: true; value: FileTreeSnapshot }>()
    vi.mocked(octopus().files.tree).mockReturnValue(tree.promise)
    const outer = held<{ ok: true; value: DirectoryListing }>()
    vi.mocked(octopus().files.directory).mockImplementation((_, path) =>
      path === 'node_modules'
        ? outer.promise
        : Promise.resolve({ ok: true, value: { entries: [], truncated: false } })
    )
    const open = new Set(['node_modules', 'node_modules/pkg'])
    const { result } = renderHook(() => useFileTree(WORKSPACE, true, open))

    await act(async () => {
      tree.resolve({ ok: true, value: SNAPSHOT })
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(result.current.listings.get('node_modules/pkg')?.status).toBe('ready')
    })
    expect(result.current.listings.has('node_modules')).toBe(false)
  })

  // A parent that could not be read says nothing about what is inside it.
  it('keeps a folder inside one that could not be read this time', async () => {
    answering()
    let readable = true
    vi.mocked(octopus().files.directory).mockImplementation((_, path) =>
      Promise.resolve(
        path === 'node_modules' && !readable
          ? { ok: false, error: 'busy' }
          : {
              ok: true,
              value: {
                entries: path === 'node_modules' ? [{ name: 'pkg', kind: 'directory' }] : [],
                truncated: false
              }
            }
      )
    )
    const open = new Set(['node_modules', 'node_modules/pkg'])
    const { result } = renderHook(() => useFileTree(WORKSPACE, true, open))
    await waitFor(() => {
      expect(result.current.listings.get('node_modules/pkg')?.status).toBe('ready')
    })

    readable = false
    act(() => {
      result.current.refresh()
    })

    await waitFor(() => {
      expect(result.current.listings.get('node_modules')?.status).toBe('failed')
    })
    expect(result.current.listings.get('node_modules/pkg')?.status).toBe('ready')
  })

  it('lays a folder read inside a read folder into the tree', async () => {
    answering()
    vi.mocked(octopus().files.directory).mockImplementation((_, path) =>
      Promise.resolve({
        ok: true,
        value: {
          entries: path === 'node_modules' ? [{ name: 'pkg', kind: 'directory' }] : [],
          truncated: false
        }
      })
    )
    const { result } = renderHook(() =>
      useFileTree(WORKSPACE, true, new Set(['node_modules', 'node_modules/pkg']))
    )

    await waitFor(() => {
      expect(result.current.index?.get('node_modules/pkg')).toEqual([])
    })
  })

  // Two reads in one workspace, the older answering last: it must not win.
  it('keeps the newer of two overlapping reads', async () => {
    answering()
    const { result } = renderHook(() => useFileTree(WORKSPACE, true, NONE))
    await waitFor(() => {
      expect(result.current.index).not.toBeNull()
    })
    let finish: (value: { ok: true; value: FileTreeSnapshot }) => void = () => undefined
    vi.mocked(octopus().files.tree).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )

    act(() => {
      result.current.refresh()
    })
    answering({ ...SNAPSHOT, statuses: { 'src/a.ts': 'added' } })
    act(() => {
      result.current.refresh()
    })
    await waitFor(() => {
      expect(result.current.statuses).toEqual({ 'src/a.ts': 'added' })
    })
    await act(async () => {
      finish({ ok: true, value: { ...SNAPSHOT, statuses: { 'src/a.ts': 'deleted' } } })
      await Promise.resolve()
    })

    expect(result.current.statuses).toEqual({ 'src/a.ts': 'added' })
  })

  /*
   * Left open inside a folder closed since, it is in the open set and held, and
   * was read after every turn for a listing no row draws — the cost the closed
   * folder's own drop exists to avoid. Opened again, the parent brings it back
   * read afresh rather than stuck reading.
   */
  it('reads a folder left open inside a closed one only once that one is opened again', async () => {
    answering()
    vi.mocked(octopus().files.directory).mockImplementation((_, path) =>
      Promise.resolve({
        ok: true,
        value: {
          entries: path === 'node_modules' ? [{ name: 'pkg', kind: 'directory' as const }] : [],
          truncated: false
        }
      })
    )
    const both = new Set(['node_modules', 'node_modules/pkg'])
    const { result, rerender } = renderHook(({ open }) => useFileTree(WORKSPACE, true, open), {
      initialProps: { open: both }
    })
    await waitFor(() => {
      expect(result.current.listings.get('node_modules/pkg')?.status).toBe('ready')
    })
    const reads = (): number =>
      vi
        .mocked(octopus().files.directory)
        .mock.calls.filter(([, path]) => path === 'node_modules/pkg').length
    expect(reads()).toBe(1)

    rerender({ open: new Set(['node_modules/pkg']) })
    act(() => {
      result.current.refresh()
    })
    await waitFor(() => {
      expect(result.current.listings.has('node_modules/pkg')).toBe(false)
    })
    expect(reads()).toBe(1)

    rerender({ open: both })
    await waitFor(() => {
      expect(result.current.listings.get('node_modules/pkg')?.status).toBe('ready')
    })
    expect(reads()).toBe(2)
  })

  // Like the tree, a folder is read only while the tab is shown.
  it('reads no folder while the tab is hidden', async () => {
    answering()
    vi.mocked(octopus().files.directory).mockResolvedValue({
      ok: true,
      value: { entries: [], truncated: false }
    })
    const { result, rerender } = renderHook(
      ({ shown, open }) => useFileTree(WORKSPACE, shown, open),
      { initialProps: { shown: true, open: NONE } }
    )
    await waitFor(() => {
      expect(result.current.index).not.toBeNull()
    })

    rerender({ shown: false, open: OPEN })
    await act(async () => {
      await Promise.resolve()
    })
    expect(octopus().files.directory).not.toHaveBeenCalled()

    rerender({ shown: true, open: OPEN })
    await waitFor(() => {
      expect(result.current.listings.get('node_modules')?.status).toBe('ready')
    })
  })

  it('reads nothing for an open folder or a refresh with no workspace', () => {
    const { result } = renderHook(() => useFileTree(null, true, OPEN))

    act(() => {
      result.current.refresh()
    })

    expect(octopus().files.directory).not.toHaveBeenCalled()
    expect(octopus().files.tree).not.toHaveBeenCalled()
  })
})
