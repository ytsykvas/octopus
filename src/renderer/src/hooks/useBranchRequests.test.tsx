import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BranchRequest } from '@core/pullRequestShapes.js'

import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { useBranchRequests } from './useBranchRequests.js'

const PLANNER = 'planner'

const request = (overrides: Partial<BranchRequest> = {}): BranchRequest => ({
  branch: 'ytsykvas/anna',
  number: 812,
  state: 'open',
  checks: 'passed',
  url: 'https://github.com/o/p/pull/812',
  ...overrides
})

function answer(...requests: BranchRequest[]): void {
  vi.mocked(octopus().projects.pullRequests).mockResolvedValue({ ok: true, value: requests })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('what each branch of a project has become', () => {
  /*
   * One call for the whole project rather than one per workspace: the mark is
   * wanted on every row of the list at once, and a read per row would be a
   * network call per row on every refresh.
   */
  it('asks once for the project and keys the answer by branch', async () => {
    answer(request(), request({ branch: 'ytsykvas/bob', number: 813 }))
    const { result } = renderHook(() => useBranchRequests(PLANNER))

    await waitFor(() => {
      expect(result.current.byBranch.size).toBe(2)
    })
    expect(result.current.byBranch.get('ytsykvas/anna')?.number).toBe(812)
    expect(octopus().projects.pullRequests).toHaveBeenCalledExactlyOnceWith(PLANNER)
  })

  it('asks nothing with no project open', () => {
    renderHook(() => useBranchRequests(null))

    expect(octopus().projects.pullRequests).not.toHaveBeenCalled()
  })

  /*
   * A list showing the previous project's marks for a frame would be putting a
   * green branch beside a workspace that has no request at all — which is why
   * the comparison happens during render rather than in an effect.
   */
  it('forgets one project the moment another is opened', async () => {
    answer(request())
    const { result, rerender } = renderHook(({ id }: { id: string }) => useBranchRequests(id), {
      initialProps: { id: PLANNER }
    })

    await waitFor(() => {
      expect(result.current.byBranch.size).toBe(1)
    })

    rerender({ id: 'esl' })
    expect(result.current.byBranch.size).toBe(0)
  })

  it('asks again when asked to', async () => {
    answer(request())
    const { result } = renderHook(() => useBranchRequests(PLANNER))

    await waitFor(() => {
      expect(result.current.byBranch.size).toBe(1)
    })

    act(() => {
      result.current.refresh()
    })

    await waitFor(() => {
      expect(octopus().projects.pullRequests).toHaveBeenCalledTimes(2)
    })
  })

  // The answer belongs to a list that is no longer on screen.
  it('drops an answer that arrives after the project was closed', async () => {
    const gate = held<{ ok: true; value: BranchRequest[] }>()
    vi.mocked(octopus().projects.pullRequests).mockReturnValue(gate.promise)

    const { result, unmount } = renderHook(() => useBranchRequests(PLANNER))
    unmount()

    gate.resolve({ ok: true, value: [request()] })
    await Promise.resolve()

    expect(result.current.byBranch.size).toBe(0)
  })

  it('looks again while the project stays open', async () => {
    vi.useFakeTimers()
    answer(request())
    renderHook(() => useBranchRequests(PLANNER))

    await vi.advanceTimersByTimeAsync(70_000)

    expect(vi.mocked(octopus().projects.pullRequests).mock.calls.length).toBeGreaterThan(1)
  })

  it('stops looking once the project is closed', async () => {
    vi.useFakeTimers()
    answer(request())
    const { unmount } = renderHook(() => useBranchRequests(PLANNER))

    await vi.advanceTimersByTimeAsync(70_000)
    const asked = vi.mocked(octopus().projects.pullRequests).mock.calls.length
    unmount()

    await vi.advanceTimersByTimeAsync(200_000)
    expect(octopus().projects.pullRequests).toHaveBeenCalledTimes(asked)
  })

  /*
   * There is no room on a list row to explain a failure, the tab says it
   * properly when it is opened, and a repository with no GitHub remote is an
   * ordinary thing. What the reader sees is no marks — which is also what a
   * project with no requests looks like.
   */
  it('says nothing about a project GitHub would not answer for, and tries again', async () => {
    vi.useFakeTimers()
    vi.mocked(octopus().projects.pullRequests).mockResolvedValue({
      ok: false,
      error: 'gh: no remote',
      code: 'notConnected'
    })
    const { result } = renderHook(() => useBranchRequests(PLANNER))

    await vi.advanceTimersByTimeAsync(70_000)

    expect(result.current.byBranch.size).toBe(0)
    // Retried on the same clock rather than given up on for the session.
    expect(vi.mocked(octopus().projects.pullRequests).mock.calls.length).toBeGreaterThan(1)
  })
})
