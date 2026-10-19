import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FileTreeSnapshot } from '@core/fileTree.js'

import { emitAgentEvent } from '../test/chat.js'
import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { useFileTree } from './useFileTree.js'
import { SETTLE_MS } from './useWorkspaceSettled.js'

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

  it('reads an ignored folder when asked, into the tree', async () => {
    answering()
    vi.mocked(octopus().files.directory).mockResolvedValue({
      ok: true,
      value: { entries: [{ name: 'pkg', kind: 'directory' }], truncated: true }
    })
    const { result } = renderHook(() => useFileTree(WORKSPACE, true, NONE))
    await waitFor(() => {
      expect(result.current.index).not.toBeNull()
    })

    act(() => {
      result.current.openFolder('node_modules')
    })
    expect(result.current.listings.get('node_modules')).toEqual({ status: 'loading' })

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

    // Its read starts only once the tree is in, so a newer read can overtake it.
    it('keeps what a newer read found when an older one finishes late', async () => {
      answering()
      const slow = held<ReturnType<typeof listing>>()
      vi.mocked(octopus().files.directory)
        .mockReturnValueOnce(slow.promise)
        .mockResolvedValue(listing('newer'))
      const { result } = renderHook(() => useFileTree(WORKSPACE, true, OPEN))
      await waitFor(() => {
        expect(octopus().files.directory).toHaveBeenCalledOnce()
      })

      act(() => {
        result.current.refresh()
      })
      await waitFor(() => {
        expect(result.current.index?.get('node_modules')?.map((node) => node.name)).toEqual([
          'newer'
        ])
      })
      await act(async () => {
        slow.resolve(listing('older'))
        await slow.promise
      })

      expect(result.current.index?.get('node_modules')?.map((node) => node.name)).toEqual(['newer'])
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

  // Opened before the first read of the tree came back; that read must not
  // drop it.
  it('marks an ignored folder that could not be read, opened while the tree was reading', async () => {
    answering()
    vi.mocked(octopus().files.directory).mockResolvedValue({ ok: false, error: 'gone' })
    const { result } = renderHook(() => useFileTree(WORKSPACE, true, OPEN))

    act(() => {
      result.current.openFolder('node_modules')
    })

    await waitFor(() => {
      expect(result.current.listings.get('node_modules')).toEqual({ status: 'failed' })
    })
    // Asked for by the click; the read that was under way does not ask again.
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
    act(() => {
      result.current.openFolder('node_modules')
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
    act(() => {
      result.current.openFolder('node_modules')
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
    let finish: (value: { ok: false; error: string }) => void = () => undefined
    vi.mocked(octopus().files.directory).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const { result, rerender } = renderHook(({ id }) => useFileTree(id, true, NONE), {
      initialProps: { id: WORKSPACE }
    })
    act(() => {
      result.current.openFolder('node_modules')
    })

    rerender({ id: 'planner/bob' })
    await act(async () => {
      finish({ ok: false, error: 'late' })
      await Promise.resolve()
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
    const { result } = renderHook(() => useFileTree(WORKSPACE, true, NONE))
    await waitFor(() => {
      expect(result.current.index).not.toBeNull()
    })
    act(() => {
      result.current.openFolder('node_modules')
    })
    await waitFor(() => {
      expect(result.current.listings.get('node_modules')?.status).toBe('ready')
    })

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
    act(() => {
      result.current.openFolder('node_modules')
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
    const { result } = renderHook(() => useFileTree(WORKSPACE, true, OPEN))
    await waitFor(() => {
      expect(result.current.index).not.toBeNull()
    })
    act(() => {
      result.current.openFolder('node_modules/pkg')
      result.current.openFolder('node_modules')
    })

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

  it('ignores a folder or a refresh asked for with no workspace', () => {
    const { result } = renderHook(() => useFileTree(null, true, NONE))

    act(() => {
      result.current.openFolder('node_modules')
      result.current.refresh()
    })

    expect(octopus().files.directory).not.toHaveBeenCalled()
    expect(octopus().files.tree).not.toHaveBeenCalled()
  })
})
