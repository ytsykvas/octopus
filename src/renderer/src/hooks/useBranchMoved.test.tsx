import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WorkspacePushedEvent } from '@core/service.js'

import { octopus } from '../test/octopus.js'
import { useBranchMoved } from './useBranchMoved.js'

const WORKSPACE = 'planner/anna'
const HEAD = 'a'.repeat(40)

/** What main sends when a workspace's branch moves on the remote. */
function move(workspaceId: string, head = HEAD): void {
  const [deliver] = vi.mocked(octopus().workspaces.onPushed).mock.calls.at(-1) ?? []
  const event: WorkspacePushedEvent = { workspaceId, projectId: 'planner', head }
  act(() => {
    deliver?.(event)
  })
}

function setHidden(hidden: boolean): void {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden)
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useBranchMoved', () => {
  it('calls back with the commit when the workspace’s own branch moves', () => {
    vi.useFakeTimers()
    const moved = vi.fn()
    renderHook(() => {
      useBranchMoved(WORKSPACE, true, moved)
    })

    move('planner/bob')
    move(WORKSPACE)
    act(() => {
      vi.advanceTimersByTime(0)
    })

    expect(moved).toHaveBeenCalledTimes(1)
    expect(moved).toHaveBeenCalledWith(HEAD)
  })

  it('listens to nothing while disabled or without a workspace', () => {
    renderHook(() => {
      useBranchMoved(WORKSPACE, false, vi.fn())
    })
    renderHook(() => {
      useBranchMoved(null, true, vi.fn())
    })

    expect(octopus().workspaces.onPushed).not.toHaveBeenCalled()
  })

  // Held, like a turn ending: a read for a window nobody can see waits until
  // somebody can.
  it('waits for a hidden window to be shown', () => {
    vi.useFakeTimers()
    const moved = vi.fn()
    renderHook(() => {
      useBranchMoved(WORKSPACE, true, moved)
    })

    setHidden(true)
    move(WORKSPACE)
    act(() => {
      vi.advanceTimersByTime(0)
    })
    expect(moved).not.toHaveBeenCalled()

    setHidden(false)
    expect(moved).toHaveBeenCalledWith(HEAD)
  })

  it('drops a pending call when it stops listening', () => {
    vi.useFakeTimers()
    const moved = vi.fn()
    const { unmount } = renderHook(() => {
      useBranchMoved(WORKSPACE, true, moved)
    })

    move(WORKSPACE)
    unmount()
    act(() => {
      vi.advanceTimersByTime(0)
    })

    expect(moved).not.toHaveBeenCalled()
  })
})
