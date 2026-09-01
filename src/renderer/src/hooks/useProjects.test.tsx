import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, type Mock, vi } from 'vitest'

import type { Project } from '@core/store.js'

import type { Result } from '../../../preload/index.js'
import type { ConfirmRequest, ConfirmResult } from './useConfirm.js'
import { useProjects } from './useProjects.js'

type Confirm = (request: ConfirmRequest) => Promise<ConfirmResult>
type OnError = (message: string) => void

const planner: Project = {
  id: 'planner',
  name: 'Planner',
  repoPath: '/repos/planner',
  baseBranch: 'main',
  branchPrefix: 'ytsykvas',
  envFile: '.env',
  approvedSettings: [],
  approvedScripts: [],
  envProfile: 'default',
  trustRepoScripts: false,
  color: 'blue'
}

const website: Project = {
  id: 'website',
  name: 'Website',
  repoPath: '/repos/website',
  baseBranch: 'main',
  branchPrefix: 'ytsykvas',
  envFile: '.env',
  approvedSettings: [],
  approvedScripts: [],
  envProfile: 'default',
  trustRepoScripts: false,
  color: 'green'
}

const answering = (answer: ConfirmResult): Mock<Confirm> =>
  vi.fn<Confirm>(() => Promise.resolve(answer))

const accepts = (): Mock<Confirm> => answering({ confirmed: true, checked: false })
const declines = (): Mock<Confirm> => answering({ confirmed: false, checked: false })

/** A promise the test settles by hand, so it can look at the state while it is pending. */
const deferred = <T,>(): { promise: Promise<T>; settle: (value: T) => void } => {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return {
    promise,
    settle: (value) => {
      resolve(value)
    }
  }
}

const listReturns = (...projects: Project[]): void => {
  vi.mocked(window.octopus.projects.list).mockResolvedValue({ ok: true, value: projects })
}

describe('useProjects', () => {
  it('lists the projects the main process knows about', async () => {
    listReturns(planner, website)
    const onError = vi.fn<OnError>()

    const { result } = renderHook(() => useProjects(accepts(), onError))

    await waitFor(() => {
      expect(result.current.all).toEqual([planner, website])
    })
    expect(onError).not.toHaveBeenCalled()
  })

  it('explains in plain words why the list could not be loaded', async () => {
    vi.mocked(window.octopus.projects.list).mockResolvedValue({
      ok: false,
      error: 'fatal: not a git repository',
      code: 'notARepository',
      params: { path: '/repos/gone' }
    })
    const onError = vi.fn<OnError>()

    const { result } = renderHook(() => useProjects(accepts(), onError))

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1)
    })
    // The English text from core is a fallback for logs; the user reads the
    // localised sentence instead.
    expect(onError).toHaveBeenCalledWith('/repos/gone is not a git repository.')
    expect(result.current.all).toEqual([])
  })

  // Closing the window mid-request should not produce a toast for a window
  // that is no longer there.
  it('ignores a list that arrives after it has been unmounted', async () => {
    const listing = deferred<Result<Project[]>>()
    vi.mocked(window.octopus.projects.list).mockReturnValue(listing.promise)
    const onError = vi.fn<OnError>()

    const { result, unmount } = renderHook(() => useProjects(accepts(), onError))
    unmount()
    listing.settle({ ok: false, error: 'too late' })
    await listing.promise

    expect(onError).not.toHaveBeenCalled()
    expect(result.current.all).toEqual([])
  })

  it('picks up a project added outside the app when refreshed', async () => {
    vi.mocked(window.octopus.projects.list)
      .mockResolvedValueOnce({ ok: true, value: [planner] })
      .mockResolvedValue({ ok: true, value: [planner, website] })
    const onError = vi.fn<OnError>()

    const { result } = renderHook(() => useProjects(accepts(), onError))
    await waitFor(() => {
      expect(result.current.all).toEqual([planner])
    })

    await act(() => result.current.refresh())

    expect(result.current.all).toEqual([planner, website])
    expect(onError).not.toHaveBeenCalled()
  })

  it('keeps the list it already has when a refresh fails, and says so', async () => {
    vi.mocked(window.octopus.projects.list)
      .mockResolvedValueOnce({ ok: true, value: [planner] })
      .mockResolvedValue({ ok: false, error: 'state.json is unreadable' })
    const onError = vi.fn<OnError>()

    const { result } = renderHook(() => useProjects(accepts(), onError))
    await waitFor(() => {
      expect(result.current.all).toEqual([planner])
    })

    await act(() => result.current.refresh())

    // A failure core has no code for still reaches the user framed, not bare.
    expect(onError).toHaveBeenCalledWith('Something went wrong: state.json is unreadable')
    expect(result.current.all).toEqual([planner])
  })

  describe('adding from disk', () => {
    it('returns the new project and reloads the list', async () => {
      vi.mocked(window.octopus.projects.list)
        .mockResolvedValueOnce({ ok: true, value: [planner] })
        .mockResolvedValue({ ok: true, value: [planner, website] })
      vi.mocked(window.octopus.projects.add).mockResolvedValue({ ok: true, value: website })
      const onError = vi.fn<OnError>()

      const { result } = renderHook(() => useProjects(accepts(), onError))
      await waitFor(() => {
        expect(result.current.all).toEqual([planner])
      })

      const added = await act(() => result.current.addFromDisk())

      expect(added).toEqual(website)
      expect(result.current.all).toEqual([planner, website])
    })

    it('treats a cancelled directory picker as nothing having happened', async () => {
      listReturns(planner)
      vi.mocked(window.octopus.projects.add).mockResolvedValue({ ok: true, value: null })
      const onError = vi.fn<OnError>()

      const { result } = renderHook(() => useProjects(accepts(), onError))
      await waitFor(() => {
        expect(result.current.all).toEqual([planner])
      })

      const added = await act(() => result.current.addFromDisk())

      expect(added).toBeNull()
      expect(onError).not.toHaveBeenCalled()
      // Only the load on mount: cancelling has nothing to reload.
      expect(window.octopus.projects.list).toHaveBeenCalledTimes(1)
    })

    it('reports a directory that is not a repository and adds nothing', async () => {
      listReturns(planner)
      vi.mocked(window.octopus.projects.add).mockResolvedValue({
        ok: false,
        error: 'not a repository',
        code: 'notARepository',
        params: { path: '/Users/someone/notes' }
      })
      const onError = vi.fn<OnError>()

      const { result } = renderHook(() => useProjects(accepts(), onError))
      await waitFor(() => {
        expect(result.current.all).toEqual([planner])
      })

      const added = await act(() => result.current.addFromDisk())

      expect(added).toBeNull()
      expect(onError).toHaveBeenCalledWith('/Users/someone/notes is not a git repository.')
      expect(result.current.all).toEqual([planner])
    })

    it('stays busy while the directory picker is open, and free once it closes', async () => {
      listReturns(planner)
      const picker = deferred<{ ok: true; value: Project | null }>()
      vi.mocked(window.octopus.projects.add).mockReturnValue(picker.promise)
      const onError = vi.fn<OnError>()

      const { result } = renderHook(() => useProjects(accepts(), onError))
      await waitFor(() => {
        expect(result.current.all).toEqual([planner])
      })

      act(() => {
        void result.current.addFromDisk()
      })
      expect(result.current.busy).toBe(true)

      picker.settle({ ok: true, value: null })

      await waitFor(() => {
        expect(result.current.busy).toBe(false)
      })
    })

    it('stops being busy even when the picker fails', async () => {
      listReturns(planner)
      vi.mocked(window.octopus.projects.add).mockResolvedValue({ ok: false, error: 'picker broke' })
      const onError = vi.fn<OnError>()

      const { result } = renderHook(() => useProjects(accepts(), onError))
      await waitFor(() => {
        expect(result.current.all).toEqual([planner])
      })

      await act(() => result.current.addFromDisk())

      expect(result.current.busy).toBe(false)
    })
  })

  describe('updating a project', () => {
    it('saves the change and reloads the list', async () => {
      vi.mocked(window.octopus.projects.list)
        .mockResolvedValueOnce({ ok: true, value: [planner] })
        .mockResolvedValue({ ok: true, value: [{ ...planner, name: 'Planner v2' }] })
      const onError = vi.fn<OnError>()

      const { result } = renderHook(() => useProjects(accepts(), onError))
      await waitFor(() => {
        expect(result.current.all).toEqual([planner])
      })

      const saved = await act(() => result.current.update('planner', { name: 'Planner v2' }))

      expect(saved).toBe(true)
      expect(window.octopus.projects.update).toHaveBeenCalledWith('planner', { name: 'Planner v2' })
      expect(result.current.all).toEqual([{ ...planner, name: 'Planner v2' }])
    })

    // The dialog keeps itself open on a refusal, which it can only do if the
    // hook tells it the change did not go through.
    it('reports a refusal instead of pretending the change went through', async () => {
      listReturns(planner)
      vi.mocked(window.octopus.projects.update).mockResolvedValue({
        ok: false,
        error: 'A project name cannot be empty',
        code: 'nameEmpty'
      })
      const onError = vi.fn<OnError>()

      const { result } = renderHook(() => useProjects(accepts(), onError))
      await waitFor(() => {
        expect(result.current.all).toEqual([planner])
      })

      const saved = await act(() => result.current.update('planner', { name: '   ' }))

      expect(saved).toBe(false)
      expect(onError).toHaveBeenCalledWith('The name cannot be empty.')
      // A failed update leaves nothing to reload.
      expect(window.octopus.projects.list).toHaveBeenCalledTimes(1)
    })
  })

  describe('removing a project', () => {
    it('asks by name before removing anything', async () => {
      listReturns(planner)
      const confirm = accepts()
      const onError = vi.fn<OnError>()

      const { result } = renderHook(() => useProjects(confirm, onError))
      await waitFor(() => {
        expect(result.current.all).toEqual([planner])
      })

      const removed = await act(() => result.current.remove('planner', 0))

      expect(removed).toBe(true)
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Planner') })
      )
      expect(window.octopus.projects.remove).toHaveBeenCalledWith('planner')
    })

    // Removing a project takes its workspaces and their branches with it, so
    // the question has to say how many.
    it('names the number of workspaces that go with it', async () => {
      listReturns(planner)
      const confirm = accepts()
      const onError = vi.fn<OnError>()

      const { result } = renderHook(() => useProjects(confirm, onError))
      await waitFor(() => {
        expect(result.current.all).toEqual([planner])
      })

      await act(() => result.current.remove('planner', 3))

      const request = confirm.mock.calls[0]?.[0]
      expect(request?.detail).toContain('3')
      expect(request?.detail).toContain('branches')
      expect(request?.destructive).toBe(true)
    })

    it('promises the repository stays on disk when there are no workspaces', async () => {
      listReturns(planner)
      const confirm = accepts()
      const onError = vi.fn<OnError>()

      const { result } = renderHook(() => useProjects(confirm, onError))
      await waitFor(() => {
        expect(result.current.all).toEqual([planner])
      })

      await act(() => result.current.remove('planner', 0))

      const request = confirm.mock.calls[0]?.[0]
      expect(request?.detail).toContain('stays on disk')
      expect(request?.detail).not.toContain('branches')
    })

    it('removes nothing when the question is declined', async () => {
      listReturns(planner)
      const confirm = declines()
      const onError = vi.fn<OnError>()

      const { result } = renderHook(() => useProjects(confirm, onError))
      await waitFor(() => {
        expect(result.current.all).toEqual([planner])
      })

      const removed = await act(() => result.current.remove('planner', 0))

      expect(removed).toBe(false)
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(window.octopus.projects.remove).not.toHaveBeenCalled()
    })

    it('does not ask about a project it has never heard of', async () => {
      listReturns(planner)
      const confirm = accepts()
      const onError = vi.fn<OnError>()

      const { result } = renderHook(() => useProjects(confirm, onError))
      await waitFor(() => {
        expect(result.current.all).toEqual([planner])
      })

      const removed = await act(() => result.current.remove('ghost', 0))

      expect(removed).toBe(false)
      expect(confirm).not.toHaveBeenCalled()
      expect(window.octopus.projects.remove).not.toHaveBeenCalled()
    })

    it('reports a removal that failed and keeps the project in the list', async () => {
      listReturns(planner)
      vi.mocked(window.octopus.projects.remove).mockResolvedValue({
        ok: false,
        error: 'worktree is locked',
        code: 'uncommittedChanges',
        params: { name: 'Planner' }
      })
      const onError = vi.fn<OnError>()

      const { result } = renderHook(() => useProjects(accepts(), onError))
      await waitFor(() => {
        expect(result.current.all).toEqual([planner])
      })

      const removed = await act(() => result.current.remove('planner', 0))

      expect(removed).toBe(false)
      expect(onError).toHaveBeenCalledWith('Planner has uncommitted changes.')
      expect(result.current.all).toEqual([planner])
    })
  })
})
