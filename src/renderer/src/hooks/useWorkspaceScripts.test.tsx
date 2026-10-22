import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedScript, ScriptsInWorkspace } from '@core/repoSource.js'

import type { Result } from '../../../preload/index.js'

import { emitAgentEvent, TURN_DONE } from '../test/chat.js'
import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { useWorkspaceScripts } from './useWorkspaceScripts.js'

/** A script of the project's own, named after the workspace it belongs to. */
function scriptOf(id: string): ResolvedScript {
  return {
    kind: 'setup',
    source: 'project',
    from: `/scripts/${id}.sh`,
    path: `/scripts/${id}.sh`,
    contents: '#!/bin/sh\n'
  }
}

beforeEach(() => {
  // The stub is installed for every renderer test by `test/setup.ts`; this only
  // teaches it what to answer.
  vi.mocked(octopus().workspaces.scripts).mockImplementation((id: string) =>
    Promise.resolve({
      ok: true,
      value: { approved: true, digest: 'digest', scripts: { setup: scriptOf(id) } }
    })
  )
})

describe('useWorkspaceScripts', () => {
  it('asks about every workspace, not only the one on screen', async () => {
    // A runner outlives the switch away from its project, and it keeps running
    // its own script rather than the open project's.
    const { result } = renderHook(() =>
      useWorkspaceScripts(['planner/anna', 'ledger/carol'], null, null)
    )

    await waitFor(() => {
      expect(result.current.scripts.size).toBe(2)
    })
    expect(result.current.scripts.get('ledger/carol')?.scripts.setup?.from).toBe(
      '/scripts/ledger/carol.sh'
    )
  })

  it('asks nothing when there are no workspaces', async () => {
    const { result } = renderHook(() => useWorkspaceScripts([], null, null))

    await waitFor(() => {
      expect(result.current.scripts.size).toBe(0)
    })
    expect(octopus().workspaces.scripts).not.toHaveBeenCalled()
  })

  it('leaves out a workspace it could not be told about', async () => {
    vi.mocked(octopus().workspaces.scripts).mockResolvedValue({ ok: false, error: 'gone' })

    const { result } = renderHook(() => useWorkspaceScripts(['planner/anna'], null, null))

    await waitFor(() => {
      expect(result.current.failures.has('planner/anna')).toBe(true)
    })
    expect(result.current.scripts.size).toBe(0)
  })

  it('reads again when a project settings dialog closes', async () => {
    // Where a script is written for the first time, which changes the answer
    // without changing the list.
    const { result, rerender } = renderHook(
      ({ key }: { key: string | null }) => useWorkspaceScripts(['planner/anna'], key, null),
      { initialProps: { key: null as string | null } }
    )

    await waitFor(() => {
      expect(result.current.scripts.size).toBe(1)
    })
    expect(octopus().workspaces.scripts).toHaveBeenCalledTimes(1)

    rerender({ key: 'planner' })
    await waitFor(() => {
      expect(octopus().workspaces.scripts).toHaveBeenCalledTimes(2)
    })
    // The second read's answer has to land before the test ends, or it
    // is applied to a window that is already gone.
    await waitFor(() => {
      expect(result.current.scripts.size).toBe(1)
    })
  })

  // A turn that ended there while it was hidden was never heard; nothing else moved.
  it('reads the workspace opened alone, and keeps the others', async () => {
    const initialProps: { shown: string | null } = { shown: 'planner/anna' }
    const { result, rerender } = renderHook(
      ({ shown }) => useWorkspaceScripts(['planner/anna', 'planner/bob'], null, shown),
      { initialProps }
    )
    await waitFor(() => {
      expect(result.current.scripts.size).toBe(2)
    })
    vi.mocked(octopus().workspaces.scripts).mockClear()

    rerender({ shown: 'planner/bob' })

    await waitFor(() => {
      expect(octopus().workspaces.scripts).toHaveBeenCalledExactlyOnceWith('planner/bob')
    })
    await waitFor(() => {
      expect(result.current.scripts.size).toBe(2)
    })

    // Closed, nothing is on screen to read.
    rerender({ shown: null })
    expect(octopus().workspaces.scripts).toHaveBeenCalledOnce()
  })

  it('reads the workspace on screen alone once a turn ends there', async () => {
    const { result } = renderHook(() =>
      useWorkspaceScripts(['planner/anna', 'planner/bob'], null, 'planner/anna')
    )
    await waitFor(() => {
      expect(result.current.scripts.size).toBe(2)
    })
    vi.mocked(octopus().workspaces.scripts).mockClear()
    vi.mocked(octopus().workspaces.scripts).mockResolvedValueOnce({ ok: false, error: 'gone' })

    emitAgentEvent(TURN_DONE, 'chat-1', 'planner/anna')

    await waitFor(() => {
      expect(result.current.failures.has('planner/anna')).toBe(true)
    })
    expect(octopus().workspaces.scripts).toHaveBeenCalledExactlyOnceWith('planner/anna')
    expect([...result.current.scripts.keys()]).toEqual(['planner/bob'])

    // And an answer clears the failure it replaces.
    emitAgentEvent(TURN_DONE, 'chat-1', 'planner/anna')
    await waitFor(() => {
      expect(result.current.failures.has('planner/anna')).toBe(false)
    })
    expect(result.current.scripts.has('planner/anna')).toBe(true)
  })

  it('reads whole again when a switch cut a whole read short', async () => {
    const reading = held<Result<ScriptsInWorkspace>>()
    vi.mocked(octopus().workspaces.scripts).mockReturnValueOnce(reading.promise)

    const { result, rerender } = renderHook(
      ({ shown }: { shown: string }) =>
        useWorkspaceScripts(['planner/anna', 'planner/bob'], null, shown),
      { initialProps: { shown: 'planner/anna' } }
    )
    rerender({ shown: 'planner/bob' })
    act(() => {
      reading.resolve({ ok: true, value: { approved: true, digest: 'd', scripts: {} } })
    })

    await waitFor(() => {
      expect(result.current.scripts.size).toBe(2)
    })
  })

  it('reads again on demand, which is what an approval needs', async () => {
    const { result } = renderHook(() => useWorkspaceScripts(['planner/anna'], null, null))

    await waitFor(() => {
      expect(result.current.scripts.size).toBe(1)
    })
    expect(octopus().workspaces.scripts).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.refresh()
    })
    await waitFor(() => {
      expect(octopus().workspaces.scripts).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(result.current.scripts.size).toBe(1)
    })
  })

  it('drops an answer that arrives after the list has moved on', async () => {
    /*
     * The guard this covers looked tested and was not: both stubs resolved on
     * the same tick, so there was no race to lose and deleting the `aborted`
     * check changed nothing. Held open, the late answer for the first list
     * overwrites the second — and `RightPanel` then hands a runner another
     * workspace's script.
     */
    let releaseFirst: (() => void) | null = null
    vi.mocked(octopus().workspaces.scripts).mockImplementation((id: string) =>
      id === 'planner/anna'
        ? new Promise((resolve) => {
            releaseFirst = () => {
              resolve({
                ok: true,
                value: { approved: true, digest: 'digest', scripts: { setup: scriptOf(id) } }
              })
            }
          })
        : Promise.resolve({
            ok: true,
            value: { approved: true, digest: 'digest', scripts: { setup: scriptOf(id) } }
          })
    )

    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useWorkspaceScripts(ids, null, null),
      { initialProps: { ids: ['planner/anna'] } }
    )

    rerender({ ids: ['planner/bob'] })
    await waitFor(() => {
      expect(result.current.scripts.has('planner/bob')).toBe(true)
    })

    // The first read answers now, for a list nobody is showing any more.
    act(() => {
      releaseFirst?.()
    })

    await waitFor(() => {
      expect(result.current.scripts.has('planner/bob')).toBe(true)
    })
    expect(result.current.scripts.has('planner/anna')).toBe(false)
  })

  it('does not keep an answer that arrived after the list changed', async () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useWorkspaceScripts(ids, null, null),
      {
        initialProps: { ids: ['planner/anna'] }
      }
    )

    rerender({ ids: ['planner/bob'] })

    // Waits for the answer itself, not for the question: this is the last test
    // in the file, and an answer still on its way when it ends is applied after
    // the window has been torn down — an unhandled error `test:race` turns red.
    await waitFor(() => {
      expect(result.current.scripts.has('planner/bob')).toBe(true)
    })
    expect(result.current.scripts.has('planner/anna')).toBe(false)
  })
})
