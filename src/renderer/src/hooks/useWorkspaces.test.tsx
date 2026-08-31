import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, type Mock, vi } from 'vitest'

import type { WorkspaceStatusEvent } from '@core/service.js'
import type { Project } from '@core/store.js'
import type { WorkspaceView } from '@core/workspaces.js'

import type { Result } from '../../../preload/index.js'
import { workspaceView } from '../test/workspaces.js'
import type { ConfirmRequest, ConfirmResult } from './useConfirm.js'
import { useWorkspaces } from './useWorkspaces.js'

type Confirm = (request: ConfirmRequest) => Promise<ConfirmResult>
type OnError = (message: string) => void

const project = (id: string, name: string): Project => ({
  id,
  name,
  repoPath: `/repos/${id}`,
  baseBranch: 'main',
  branchPrefix: 'ytsykvas',
  envFile: '.env',
  approvedSettings: [],
  approvedScripts: [],
  color: 'blue'
})

const planner = project('planner', 'Planner')
const website = project('website', 'Website')

/** The shared fixture, re-pointed at the project that owns the workspace. */
const workspace = (projectId: string, name: string): WorkspaceView =>
  workspaceView(name, {
    id: `${projectId}/${name}`,
    projectId,
    path: `/worktrees/${projectId}/${name}`
  })

const anna = workspace('planner', 'anna')
const bob = workspace('planner', 'bob')
const carol = workspace('website', 'carol')

const answering = (answer: ConfirmResult): Mock<Confirm> =>
  vi.fn<Confirm>(() => Promise.resolve(answer))

const accepts = (): Mock<Confirm> => answering({ confirmed: true, checked: false })
const acceptsAndDeletesBranch = (): Mock<Confirm> => answering({ confirmed: true, checked: true })
const declines = (): Mock<Confirm> => answering({ confirmed: false, checked: false })

/** Waits out a delay the hook is counting, so an assertion outlasts it. */
const after = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Lets every promise already queued run before the assertion that follows. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

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

/**
 * Delivers a status the way main broadcasts it.
 *
 * Wrapped in `act` because it arrives from IPC rather than from React's own
 * event handling — the same reason `emitAgentEvent` is.
 */
const emitStatus = (event: WorkspaceStatusEvent): void => {
  const handlers = vi
    .mocked(window.octopus.workspaces.onStatus)
    .mock.calls.map(([handler]) => handler)

  act(() => {
    for (const handler of handlers) handler(event)
  })
}

/** A conversation's state changing, as main broadcasts it. */
const emitChatStatus = (event: {
  chatId: string
  workspaceId: string
  status: 'idle' | 'running' | 'waiting_permission' | 'error'
}): void => {
  const handlers = vi.mocked(window.octopus.chats.onStatus).mock.calls.map(([handler]) => handler)

  act(() => {
    for (const handler of handlers) handler(event)
  })
}

/** A turn ending in a named workspace, as main broadcasts it. */
const emitTurnEnd = (workspaceId: string, failed = false): void => {
  const handlers = vi.mocked(window.octopus.chats.onEvent).mock.calls.map(([handler]) => handler)

  act(() => {
    for (const handler of handlers) {
      handler({
        chatId: 'chat-1',
        workspaceId,
        event: failed
          ? { type: 'error', message: 'the agent gave up' }
          : {
              type: 'result',
              ok: true,
              costUsd: 0,
              durationMs: 1,
              inputTokens: 0,
              outputTokens: 0,
              terminalReason: 'completed'
            }
      })
    }
  })
}

/** Each project answers with its own workspaces, the way the real bridge does. */
const workspacesPerProject = (owned: Readonly<Record<string, readonly WorkspaceView[]>>): void => {
  vi.mocked(window.octopus.workspaces.list).mockImplementation((projectId: string) =>
    Promise.resolve({ ok: true, value: [...(owned[projectId] ?? [])] })
  )
}

describe('useWorkspaces', () => {
  it('groups the workspaces under the project that owns them', async () => {
    workspacesPerProject({ planner: [anna, bob], website: [carol] })
    const projects = [planner, website]

    const { result } = renderHook(() => useWorkspaces(projects, accepts(), vi.fn<OnError>()))

    await waitFor(() => {
      expect(result.current.flat).toEqual([anna, bob, carol])
    })
    expect(result.current.byProject.get('planner')).toEqual([anna, bob])
    expect(result.current.byProject.get('website')).toEqual([carol])
  })

  /*
   * Patched in rather than re-read: a full read asks git about every workspace
   * of every project, and this arrives several times a turn. The value is the
   * one the core already decided, so there is nothing to work out here.
   */
  /*
   * The same, one level in. The row draws a dot per conversation once a
   * workspace holds several, and those move at moments the workspace's own
   * summary does not — a second conversation finishing leaves a workspace whose
   * first is still running exactly where it was.
   */
  it('takes each conversation’s status from the core as it changes', async () => {
    const busy = workspaceView('anna', {
      chats: [
        {
          id: 'chat-1',
          agent: 'claude' as const,
          title: null,
          status: 'idle' as const,
          started: true
        },
        {
          id: 'chat-2',
          agent: 'claude' as const,
          title: null,
          status: 'idle' as const,
          started: true
        }
      ]
    })
    workspacesPerProject({ planner: [busy] })
    const projects = [planner]

    const { result } = renderHook(() => useWorkspaces(projects, accepts(), vi.fn<OnError>()))
    await waitFor(() => {
      expect(result.current.flat).toHaveLength(1)
    })

    emitChatStatus({ chatId: 'chat-2', workspaceId: busy.id, status: 'running' })

    expect(result.current.flat[0]?.chats.map((item) => item.status)).toEqual(['idle', 'running'])
  })

  // Pushed by the strip that opened it, rather than re-read: `workspaces.list`
  // would put git to work on every workspace of the project to learn something
  // the window already decided.
  it('takes a conversation list handed to it by the pane', async () => {
    workspacesPerProject({ planner: [anna] })
    const projects = [planner]

    const { result } = renderHook(() => useWorkspaces(projects, accepts(), vi.fn<OnError>()))
    await waitFor(() => {
      expect(result.current.flat).toHaveLength(1)
    })

    act(() => {
      result.current.setChats(anna.id, [
        { id: 'chat-1', agent: 'claude', title: null, status: 'running', started: true }
      ])
    })

    expect(result.current.flat[0]?.chats).toEqual([
      { id: 'chat-1', agent: 'claude', title: null, status: 'running', started: true }
    ])
  })

  it('takes a workspace’s status from the core as it changes', async () => {
    workspacesPerProject({ planner: [anna, bob], website: [carol] })
    // Hoisted, or a fresh array each render restarts the read for ever.
    const projects = [planner, website]

    const { result } = renderHook(() => useWorkspaces(projects, accepts(), vi.fn<OnError>()))
    await waitFor(() => {
      expect(result.current.flat).toHaveLength(3)
    })

    emitStatus({ workspaceId: bob.id, status: 'running' })

    expect(result.current.byProject.get('planner')?.[1]?.status).toBe('running')
    // Nothing else moves, and no second reading of the workspaces is asked for.
    expect(result.current.byProject.get('planner')?.[0]?.status).toBe('idle')
    expect(window.octopus.workspaces.list).toHaveBeenCalledTimes(2)
  })

  /*
   * The count used to be read on create, rename, remove and first load, and
   * never again — so the agent could rewrite twenty files while the row went on
   * saying what it said an hour ago. The diff pane beside it re-reads itself
   * when a turn ends, which is what made the disagreement visible; since the
   * same dot also carries the agent's state, the two now sit inside one mark.
   */
  it('re-reads the count when a turn ends', async () => {
    vi.mocked(window.octopus.workspaces.list)
      .mockResolvedValueOnce({ ok: true, value: [anna] })
      .mockResolvedValue({ ok: true, value: [{ ...anna, changedFiles: 8 }] })
    const projects = [planner]

    const { result } = renderHook(() => useWorkspaces(projects, accepts(), vi.fn<OnError>()))
    await waitFor(() => {
      expect(result.current.flat[0]?.changedFiles).toBe(0)
    })

    emitTurnEnd(anna.id)

    await waitFor(() => {
      expect(result.current.flat[0]?.changedFiles).toBe(8)
    })
  })

  // A turn that failed may well have written files before it did.
  it('re-reads after a turn that ended badly too', async () => {
    vi.mocked(window.octopus.workspaces.list)
      .mockResolvedValueOnce({ ok: true, value: [anna] })
      .mockResolvedValue({ ok: true, value: [{ ...anna, changedFiles: 2 }] })
    const projects = [planner]

    const { result } = renderHook(() => useWorkspaces(projects, accepts(), vi.fn<OnError>()))
    await waitFor(() => {
      expect(result.current.flat[0]?.changedFiles).toBe(0)
    })

    emitTurnEnd(anna.id, true)

    await waitFor(() => {
      expect(result.current.flat[0]?.changedFiles).toBe(2)
    })
  })

  // A turn can end twice over — an error and then a result — and one read is
  // the answer to both.
  it('reads once for two endings in quick succession', async () => {
    workspacesPerProject({ planner: [anna] })
    const projects = [planner]

    const { result } = renderHook(() => useWorkspaces(projects, accepts(), vi.fn<OnError>()))
    await waitFor(() => {
      expect(result.current.flat).toEqual([anna])
    })
    const reads = vi.mocked(window.octopus.workspaces.list).mock.calls.length

    emitTurnEnd(anna.id, true)
    emitTurnEnd(anna.id)
    await waitFor(() => {
      expect(window.octopus.workspaces.list).toHaveBeenCalledTimes(reads + 1)
    })

    await settled()
    expect(window.octopus.workspaces.list).toHaveBeenCalledTimes(reads + 1)
  })

  /*
   * Two turns, two projects, and a settle window that holds both.
   *
   * The pending re-read used to be one timer for everything, cleared before the
   * project was even consulted — so the second event cancelled the first's read
   * and scheduled its own, and the first project's rows went on showing the
   * count they had before the agent touched anything. Several agents working at
   * once is this application's whole premise, so this is not a corner.
   */
  it('re-reads both projects when two turns end together', async () => {
    workspacesPerProject({ planner: [anna], website: [carol] })
    const projects = [planner, website]

    const { result } = renderHook(() => useWorkspaces(projects, accepts(), vi.fn<OnError>()))
    await waitFor(() => {
      expect(result.current.flat).toEqual([anna, carol])
    })
    vi.mocked(window.octopus.workspaces.list).mockClear()

    emitTurnEnd(anna.id)
    emitTurnEnd(carol.id)
    await after(400)

    const asked = vi
      .mocked(window.octopus.workspaces.list)
      .mock.calls.map(([projectId]) => projectId)
    expect(asked).toContain('planner')
    expect(asked).toContain('website')
  })

  // A window closed inside the settling delay has nothing left to update, and
  // the read would put git to work on the way to a hook that is gone.
  it('drops a pending re-read when the window closes', async () => {
    workspacesPerProject({ planner: [anna] })
    const projects = [planner]

    const { result, unmount } = renderHook(() =>
      useWorkspaces(projects, accepts(), vi.fn<OnError>())
    )
    await waitFor(() => {
      expect(result.current.flat).toEqual([anna])
    })
    vi.mocked(window.octopus.workspaces.list).mockClear()

    emitTurnEnd(anna.id)
    unmount()
    await after(400)

    expect(window.octopus.workspaces.list).not.toHaveBeenCalled()
  })

  it('asks nothing for a turn in a project it does not know', async () => {
    workspacesPerProject({ planner: [anna] })
    const projects = [planner]

    const { result } = renderHook(() => useWorkspaces(projects, accepts(), vi.fn<OnError>()))
    await waitFor(() => {
      expect(result.current.flat).toEqual([anna])
    })
    const reads = vi.mocked(window.octopus.workspaces.list).mock.calls.length

    emitTurnEnd('website/carol')
    // Past the settling delay, or this would pass without the guard: nothing
    // has been read yet at that point either way.
    await after(400)

    expect(window.octopus.workspaces.list).toHaveBeenCalledTimes(reads)
  })

  // Streamed text arrives many times a turn; a read on each would put git to
  // work per fragment.
  it('reads nothing while the turn is still going', async () => {
    workspacesPerProject({ planner: [anna] })
    const projects = [planner]

    const { result } = renderHook(() => useWorkspaces(projects, accepts(), vi.fn<OnError>()))
    await waitFor(() => {
      expect(result.current.flat).toEqual([anna])
    })
    const reads = vi.mocked(window.octopus.workspaces.list).mock.calls.length

    act(() => {
      for (const handler of vi
        .mocked(window.octopus.chats.onEvent)
        .mock.calls.map(([listener]) => listener)) {
        handler({
          chatId: 'chat-1',
          workspaceId: anna.id,
          event: { type: 'text', text: 'still working' }
        })
      }
    })
    await after(400)

    expect(window.octopus.workspaces.list).toHaveBeenCalledTimes(reads)
  })

  // A read that fails leaves the row saying what it last knew, which is a
  // better answer than emptying the project it belongs to.
  it('keeps the workspaces it has when the re-read fails', async () => {
    vi.mocked(window.octopus.workspaces.list)
      .mockResolvedValueOnce({ ok: true, value: [anna] })
      .mockResolvedValue({ ok: false, error: 'could not list worktrees' })
    const projects = [planner]

    const { result } = renderHook(() => useWorkspaces(projects, accepts(), vi.fn<OnError>()))
    await waitFor(() => {
      expect(result.current.flat).toEqual([anna])
    })

    const reads = vi.mocked(window.octopus.workspaces.list).mock.calls.length
    emitTurnEnd(anna.id)
    await waitFor(() => {
      expect(window.octopus.workspaces.list).toHaveBeenCalledTimes(reads + 1)
    })

    expect(result.current.flat).toEqual([anna])
  })

  it('ignores a status for a workspace it does not hold', async () => {
    workspacesPerProject({ planner: [anna], website: [] })
    const projects = [planner, website]

    const { result } = renderHook(() => useWorkspaces(projects, accepts(), vi.fn<OnError>()))
    await waitFor(() => {
      expect(result.current.flat).toEqual([anna])
    })

    emitStatus({ workspaceId: 'planner/gone', status: 'running' })

    expect(result.current.flat).toEqual([anna])
  })

  // A project whose worktrees cannot be read still has to appear in the
  // sidebar; the alternative is a project that silently vanishes.
  it('shows a project as empty when its workspaces cannot be read', async () => {
    vi.mocked(window.octopus.workspaces.list).mockImplementation((projectId: string) =>
      Promise.resolve(
        projectId === 'planner'
          ? { ok: true, value: [anna] }
          : { ok: false, error: 'not a git repository' }
      )
    )
    const projects = [planner, website]

    const { result } = renderHook(() => useWorkspaces(projects, accepts(), vi.fn<OnError>()))

    await waitFor(() => {
      expect(result.current.byProject.get('website')).toEqual([])
    })
    expect(result.current.flat).toEqual([anna])
  })

  it('loads the workspaces of a project added after mount', async () => {
    workspacesPerProject({ planner: [anna], website: [carol] })

    const { result, rerender } = renderHook(
      ({ projects }: { projects: readonly Project[] }) =>
        useWorkspaces(projects, accepts(), vi.fn<OnError>()),
      { initialProps: { projects: [planner] } }
    )
    await waitFor(() => {
      expect(result.current.flat).toEqual([anna])
    })

    rerender({ projects: [planner, website] })

    await waitFor(() => {
      expect(result.current.flat).toEqual([anna, carol])
    })
  })

  it('picks up a workspace created outside the app when refreshed', async () => {
    vi.mocked(window.octopus.workspaces.list)
      .mockResolvedValueOnce({ ok: true, value: [anna] })
      .mockResolvedValue({ ok: true, value: [anna, bob] })
    const projects = [planner]

    const { result } = renderHook(() => useWorkspaces(projects, accepts(), vi.fn<OnError>()))
    await waitFor(() => {
      expect(result.current.flat).toEqual([anna])
    })

    await act(() => result.current.refresh())

    expect(result.current.flat).toEqual([anna, bob])
  })

  it('empties a project whose workspaces stop being readable', async () => {
    vi.mocked(window.octopus.workspaces.list)
      .mockResolvedValueOnce({ ok: true, value: [anna] })
      .mockResolvedValue({ ok: false, error: 'could not list worktrees' })
    const onError = vi.fn<OnError>()
    const projects = [planner]

    const { result } = renderHook(() => useWorkspaces(projects, accepts(), onError))
    await waitFor(() => {
      expect(result.current.flat).toEqual([anna])
    })

    await act(() => result.current.refresh())

    expect(result.current.flat).toEqual([])
    // Worth knowing: the failure is swallowed here, so the user sees the
    // workspaces disappear without being told why.
    expect(onError).not.toHaveBeenCalled()
  })

  // The same guard that protects an unmounted window also protects a live one:
  // the projects can change while a listing is still in flight, and the answer
  // to the older question must not overwrite the newer list.
  it('ignores a listing that arrives after the projects have changed', async () => {
    const slow = deferred<Result<WorkspaceView[]>>()
    vi.mocked(window.octopus.workspaces.list).mockImplementation((projectId: string) =>
      projectId === 'planner' ? slow.promise : Promise.resolve({ ok: true, value: [carol] })
    )

    const { result, rerender } = renderHook(
      ({ projects }: { projects: readonly Project[] }) =>
        useWorkspaces(projects, accepts(), vi.fn<OnError>()),
      { initialProps: { projects: [planner] as readonly Project[] } }
    )

    rerender({ projects: [website] })
    await waitFor(() => {
      expect(result.current.flat).toEqual([carol])
    })

    await act(async () => {
      slow.settle({ ok: true, value: [anna] })
      await settled()
    })

    expect(result.current.flat).toEqual([carol])
    expect(result.current.byProject.has('planner')).toBe(false)
  })

  describe('creating a workspace', () => {
    it('opens the new workspace for renaming straight away', async () => {
      vi.mocked(window.octopus.workspaces.list)
        .mockResolvedValueOnce({ ok: true, value: [anna] })
        .mockResolvedValue({ ok: true, value: [anna, bob] })
      vi.mocked(window.octopus.workspaces.create).mockResolvedValue({ ok: true, value: bob })
      const onError = vi.fn<OnError>()
      const projects = [planner]

      const { result } = renderHook(() => useWorkspaces(projects, accepts(), onError))
      await waitFor(() => {
        expect(result.current.flat).toEqual([anna])
      })

      await act(() => result.current.create('planner'))

      expect(window.octopus.workspaces.create).toHaveBeenCalledWith('planner')
      expect(result.current.flat).toEqual([anna, bob])
      expect(result.current.editingId).toBe('planner/bob')
      expect(onError).not.toHaveBeenCalled()
    })

    it('explains a refused creation and leaves nothing being renamed', async () => {
      workspacesPerProject({ planner: [anna] })
      vi.mocked(window.octopus.workspaces.create).mockResolvedValue({
        ok: false,
        error: 'branch exists',
        code: 'branchExists',
        params: { branch: 'ytsykvas/bob' }
      })
      const onError = vi.fn<OnError>()
      const projects = [planner]

      const { result } = renderHook(() => useWorkspaces(projects, accepts(), onError))
      await waitFor(() => {
        expect(result.current.flat).toEqual([anna])
      })

      await act(() => result.current.create('planner'))

      expect(onError).toHaveBeenCalledWith('A branch named ytsykvas/bob already exists.')
      expect(result.current.editingId).toBeNull()
    })

    /*
     * Creation now fetches first, which is a real interval — and two presses
     * inside it do worse than make two workspaces: both read the same list of
     * taken names, so the second is handed one the first has claimed and fails
     * on a path that already exists.
     */
    it('ignores a second press while the first is still going', async () => {
      workspacesPerProject({ planner: [anna] })
      // Held open deliberately: the window between the press and the answer is
      // exactly what this is about, and a resolved promise has none.
      type Created = Awaited<ReturnType<typeof window.octopus.workspaces.create>>
      let answer: (created: Created) => void = () => undefined
      vi.mocked(window.octopus.workspaces.create).mockReturnValue(
        new Promise<Created>((resolve) => {
          answer = resolve
        })
      )
      const projects = [planner]

      const { result } = renderHook(() => useWorkspaces(projects, accepts(), vi.fn<OnError>()))
      await waitFor(() => {
        expect(result.current.flat).toEqual([anna])
      })

      let first: Promise<void> = Promise.resolve()
      act(() => {
        first = result.current.create('planner')
      })
      await waitFor(() => {
        expect(result.current.creating).toBe(true)
      })

      await act(() => result.current.create('planner'))
      expect(window.octopus.workspaces.create).toHaveBeenCalledTimes(1)

      await act(async () => {
        answer({ ok: true, value: bob })
        await first
      })
      expect(result.current.creating).toBe(false)
    })

    // Including when it fails: a button left spinning after a refusal is a
    // second thing gone wrong on top of the first.
    it('stops saying it is creating when the creation is refused', async () => {
      workspacesPerProject({ planner: [anna] })
      vi.mocked(window.octopus.workspaces.create).mockResolvedValue({
        ok: false,
        error: 'no remote',
        code: 'fetchFailed',
        params: { remote: 'origin', reason: 'gone' }
      })
      const projects = [planner]

      const { result } = renderHook(() => useWorkspaces(projects, accepts(), vi.fn<OnError>()))
      await waitFor(() => {
        expect(result.current.flat).toEqual([anna])
      })

      await act(() => result.current.create('planner'))
      expect(result.current.creating).toBe(false)
    })

    it('stops the rename when the editor is closed', async () => {
      workspacesPerProject({ planner: [anna] })
      vi.mocked(window.octopus.workspaces.create).mockResolvedValue({ ok: true, value: anna })
      const projects = [planner]

      const { result } = renderHook(() => useWorkspaces(projects, accepts(), vi.fn<OnError>()))
      await waitFor(() => {
        expect(result.current.flat).toEqual([anna])
      })
      await act(() => result.current.create('planner'))
      expect(result.current.editingId).toBe('planner/anna')

      act(() => {
        result.current.setEditingId(null)
      })

      expect(result.current.editingId).toBeNull()
    })
  })

  describe('renaming a workspace', () => {
    it('saves the new name and reloads the list', async () => {
      const renamed = { ...anna, name: 'billing', branch: 'ytsykvas/billing' }
      vi.mocked(window.octopus.workspaces.list)
        .mockResolvedValueOnce({ ok: true, value: [anna] })
        .mockResolvedValue({ ok: true, value: [renamed] })
      const onError = vi.fn<OnError>()
      const projects = [planner]

      const { result } = renderHook(() => useWorkspaces(projects, accepts(), onError))
      await waitFor(() => {
        expect(result.current.flat).toEqual([anna])
      })

      await act(() => result.current.rename('planner/anna', 'billing'))

      expect(window.octopus.workspaces.rename).toHaveBeenCalledWith('planner/anna', 'billing')
      expect(result.current.flat).toEqual([renamed])
      expect(onError).not.toHaveBeenCalled()
    })

    it('reports a rejected name and leaves the list alone', async () => {
      workspacesPerProject({ planner: [anna] })
      vi.mocked(window.octopus.workspaces.rename).mockResolvedValue({
        ok: false,
        error: 'A workspace name cannot be empty',
        code: 'nameEmpty'
      })
      const onError = vi.fn<OnError>()
      const projects = [planner]

      const { result } = renderHook(() => useWorkspaces(projects, accepts(), onError))
      await waitFor(() => {
        expect(result.current.flat).toEqual([anna])
      })

      await act(() => result.current.rename('planner/anna', '  '))

      expect(onError).toHaveBeenCalledWith('The name cannot be empty.')
      // Only the load on mount: there is nothing new to read.
      expect(window.octopus.workspaces.list).toHaveBeenCalledTimes(1)
    })
  })

  describe('removing a workspace', () => {
    it('asks by name, then deletes the worktree and keeps the branch', async () => {
      workspacesPerProject({ planner: [anna] })
      const confirm = accepts()
      const onError = vi.fn<OnError>()
      const projects = [planner]

      const { result } = renderHook(() => useWorkspaces(projects, confirm, onError))
      await waitFor(() => {
        expect(result.current.flat).toEqual([anna])
      })

      await act(() => result.current.remove('planner/anna'))

      const request = confirm.mock.calls[0]?.[0]
      expect(request?.message).toContain('anna')
      expect(request?.detail).toContain('Committed work stays on the branch')
      expect(request?.checkbox?.label).toContain('ytsykvas/anna')
      expect(window.octopus.workspaces.remove).toHaveBeenCalledWith('planner/anna', {
        force: false,
        deleteBranch: false
      })
      expect(onError).not.toHaveBeenCalled()
    })

    // Uncommitted work is the only thing here nothing else keeps a copy of, so
    // the warning replaces the reassuring text rather than sitting beside it.
    it('warns about uncommitted changes and forces the removal through', async () => {
      workspacesPerProject({ planner: [anna] })
      vi.mocked(window.octopus.workspaces.hasChanges).mockResolvedValue({ ok: true, value: true })
      const confirm = accepts()
      const projects = [planner]

      const { result } = renderHook(() => useWorkspaces(projects, confirm, vi.fn<OnError>()))
      await waitFor(() => {
        expect(result.current.flat).toEqual([anna])
      })

      await act(() => result.current.remove('planner/anna'))

      const request = confirm.mock.calls[0]?.[0]
      expect(request?.detail).toContain('uncommitted changes')
      expect(window.octopus.workspaces.remove).toHaveBeenCalledWith('planner/anna', {
        force: true,
        deleteBranch: false
      })
    })

    // If git cannot even be asked, the safe reading is "nothing to lose" — the
    // removal then refuses on its own rather than forcing past real changes.
    it('treats a workspace it cannot inspect as clean', async () => {
      workspacesPerProject({ planner: [anna] })
      vi.mocked(window.octopus.workspaces.hasChanges).mockResolvedValue({
        ok: false,
        error: 'worktree missing'
      })
      const confirm = accepts()
      const projects = [planner]

      const { result } = renderHook(() => useWorkspaces(projects, confirm, vi.fn<OnError>()))
      await waitFor(() => {
        expect(result.current.flat).toEqual([anna])
      })

      await act(() => result.current.remove('planner/anna'))

      expect(confirm.mock.calls[0]?.[0].detail).toContain('Committed work stays on the branch')
      expect(window.octopus.workspaces.remove).toHaveBeenCalledWith('planner/anna', {
        force: false,
        deleteBranch: false
      })
    })

    // A workspace is one task; once it is done with, the branch behind it is
    // too. The box is in front of the user and one click undoes it.
    it('asks with the branch already marked for deletion', async () => {
      workspacesPerProject({ planner: [anna] })
      const confirm = accepts()
      const projects = [planner]

      const { result } = renderHook(() => useWorkspaces(projects, confirm, vi.fn<OnError>()))
      await waitFor(() => {
        expect(result.current.flat).toEqual([anna])
      })

      await act(() => result.current.remove('planner/anna'))

      expect(confirm.mock.calls[0]?.[0].checkbox?.checked).toBe(true)
    })

    it('deletes the branch as well when that box is ticked', async () => {
      workspacesPerProject({ planner: [anna] })
      const projects = [planner]

      const { result } = renderHook(() =>
        useWorkspaces(projects, acceptsAndDeletesBranch(), vi.fn<OnError>())
      )
      await waitFor(() => {
        expect(result.current.flat).toEqual([anna])
      })

      await act(() => result.current.remove('planner/anna'))

      expect(window.octopus.workspaces.remove).toHaveBeenCalledWith('planner/anna', {
        force: false,
        deleteBranch: true
      })
    })

    it('removes nothing when the question is declined', async () => {
      workspacesPerProject({ planner: [anna] })
      const confirm = declines()
      const projects = [planner]

      const { result } = renderHook(() => useWorkspaces(projects, confirm, vi.fn<OnError>()))
      await waitFor(() => {
        expect(result.current.flat).toEqual([anna])
      })

      await act(() => result.current.remove('planner/anna'))

      expect(confirm).toHaveBeenCalledTimes(1)
      expect(window.octopus.workspaces.remove).not.toHaveBeenCalled()
      expect(result.current.flat).toEqual([anna])
    })

    it('does not ask about a workspace it has never heard of', async () => {
      workspacesPerProject({ planner: [anna] })
      const confirm = accepts()
      const projects = [planner]

      const { result } = renderHook(() => useWorkspaces(projects, confirm, vi.fn<OnError>()))
      await waitFor(() => {
        expect(result.current.flat).toEqual([anna])
      })

      await act(() => result.current.remove('planner/ghost'))

      expect(confirm).not.toHaveBeenCalled()
      expect(window.octopus.workspaces.hasChanges).not.toHaveBeenCalled()
      expect(window.octopus.workspaces.remove).not.toHaveBeenCalled()
    })

    it('reports a removal that failed and keeps the workspace in the list', async () => {
      workspacesPerProject({ planner: [anna] })
      vi.mocked(window.octopus.workspaces.remove).mockResolvedValue({
        ok: false,
        error: 'worktree is gone',
        code: 'worktreeMissing'
      })
      const onError = vi.fn<OnError>()
      const projects = [planner]

      const { result } = renderHook(() => useWorkspaces(projects, accepts(), onError))
      await waitFor(() => {
        expect(result.current.flat).toEqual([anna])
      })

      await act(() => result.current.remove('planner/anna'))

      expect(onError).toHaveBeenCalledWith('That workspace is no longer there.')
      expect(result.current.flat).toEqual([anna])
    })
  })
})
