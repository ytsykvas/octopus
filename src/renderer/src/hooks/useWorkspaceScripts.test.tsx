import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedScript } from '@core/repoSource.js'

import { octopus } from '../test/octopus.js'
import { useWorkspaceScripts } from './useWorkspaceScripts.js'

/** A script of the project's own, named after the workspace it belongs to. */
function scriptOf(id: string): ResolvedScript {
  return {
    kind: 'setup',
    source: 'project',
    from: `/scripts/${id}.sh`,
    run: { type: 'file', path: `/scripts/${id}.sh` },
    contents: '#!/bin/sh\n'
  }
}

beforeEach(() => {
  // The stub is installed for every renderer test by `test/setup.ts`; this only
  // teaches it what to answer.
  vi.mocked(octopus().workspaces.scripts).mockImplementation((id: string) =>
    Promise.resolve({ ok: true, value: { approved: true, scripts: { setup: scriptOf(id) } } })
  )
})

describe('useWorkspaceScripts', () => {
  it('asks about every workspace, not only the one on screen', async () => {
    // A runner outlives the switch away from its project, and it keeps running
    // its own script rather than the open project's.
    const { result } = renderHook(() => useWorkspaceScripts(['planner/anna', 'ledger/carol'], null))

    await waitFor(() => {
      expect(result.current.scripts.size).toBe(2)
    })
    expect(result.current.scripts.get('ledger/carol')?.scripts.setup?.from).toBe(
      '/scripts/ledger/carol.sh'
    )
  })

  it('asks nothing when there are no workspaces', async () => {
    const { result } = renderHook(() => useWorkspaceScripts([], null))

    await waitFor(() => {
      expect(result.current.scripts.size).toBe(0)
    })
    expect(octopus().workspaces.scripts).not.toHaveBeenCalled()
  })

  it('leaves out a workspace it could not be told about', async () => {
    vi.mocked(octopus().workspaces.scripts).mockResolvedValue({ ok: false, error: 'gone' })

    const { result } = renderHook(() => useWorkspaceScripts(['planner/anna'], null))

    await waitFor(() => {
      expect(octopus().workspaces.scripts).toHaveBeenCalled()
    })
    expect(result.current.scripts.size).toBe(0)
  })

  it('reads again when a project settings dialog closes', async () => {
    // Where a script is written for the first time, which changes the answer
    // without changing the list.
    const { rerender } = renderHook(
      ({ key }: { key: string | null }) => useWorkspaceScripts(['planner/anna'], key),
      { initialProps: { key: null as string | null } }
    )

    await waitFor(() => {
      expect(octopus().workspaces.scripts).toHaveBeenCalledTimes(1)
    })

    rerender({ key: 'planner' })
    await waitFor(() => {
      expect(octopus().workspaces.scripts).toHaveBeenCalledTimes(2)
    })
  })

  it('reads again on demand, which is what an approval needs', async () => {
    const { result } = renderHook(() => useWorkspaceScripts(['planner/anna'], null))

    await waitFor(() => {
      expect(octopus().workspaces.scripts).toHaveBeenCalledTimes(1)
    })

    result.current.refresh()
    await waitFor(() => {
      expect(octopus().workspaces.scripts).toHaveBeenCalledTimes(2)
    })
  })

  it('does not keep an answer that arrived after the list changed', async () => {
    const { rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useWorkspaceScripts(ids, null),
      {
        initialProps: { ids: ['planner/anna'] }
      }
    )

    rerender({ ids: ['planner/bob'] })

    await waitFor(() => {
      expect(octopus().workspaces.scripts).toHaveBeenCalledWith('planner/bob')
    })
  })
})
