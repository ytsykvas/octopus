import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BranchRequest } from '@core/pullRequestShapes.js'

import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { failOnUpdatesOutsideAct } from '../test/updatesOutsideAct.js'
import { RUNNING_INTERVAL_MS, useBranchRequests } from './useBranchRequests.js'

// Every read here answers through a promise, and one answered after a test had
// ended failed a CI run with every test green.
failOnUpdatesOutsideAct()

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
  vi.mocked(octopus().projects.pullRequests).mockResolvedValue({
    ok: true,
    value: { requests, capped: false }
  })
}

/** The same, from a read that came back full — so older ones may be missing. */
function cappedAnswer(...requests: BranchRequest[]): void {
  vi.mocked(octopus().projects.pullRequests).mockResolvedValue({
    ok: true,
    value: { requests, capped: true }
  })
}

/**
 * A read that never comes back, for a test about the moment before it does.
 *
 * With the answer free to arrive, it would land after the test had ended.
 */
function unanswered(): void {
  vi.mocked(octopus().projects.pullRequests).mockReturnValue(new Promise(() => undefined))
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

    unanswered()
    rerender({ id: 'esl' })
    expect(result.current.byBranch.size).toBe(0)
  })

  it('asks again when asked to', async () => {
    answer(request())
    const { result } = renderHook(() => useBranchRequests(PLANNER))

    await waitFor(() => {
      expect(result.current.byBranch.size).toBe(1)
    })

    answer(request(), request({ branch: 'ytsykvas/bob', number: 813 }))
    act(() => {
      result.current.refresh()
    })

    // The second answer on screen, not only the second call made: a call is
    // over before its answer lands.
    await waitFor(() => {
      expect(result.current.byBranch.size).toBe(2)
    })
  })

  /*
   * The answer belongs to a list that is no longer on screen. What would give a
   * kept answer away is the clock: an answer taken in schedules the next read,
   * and the project would be polled for the rest of the session.
   */
  it('drops an answer that arrives after the project was closed', async () => {
    vi.useFakeTimers()
    const gate = held<{ ok: true; value: { requests: BranchRequest[]; capped: boolean } }>()
    vi.mocked(octopus().projects.pullRequests).mockReturnValue(gate.promise)

    const { unmount } = renderHook(() => useBranchRequests(PLANNER))
    unmount()

    gate.resolve({ ok: true, value: { requests: [request()], capped: false } })
    await vi.advanceTimersByTimeAsync(200_000)

    expect(octopus().projects.pullRequests).toHaveBeenCalledOnce()
  })

  it('looks again while the project stays open', async () => {
    vi.useFakeTimers()
    answer(request())
    renderHook(() => useBranchRequests(PLANNER))

    await act(() => vi.advanceTimersByTimeAsync(70_000))

    expect(vi.mocked(octopus().projects.pullRequests).mock.calls.length).toBeGreaterThan(1)
  })

  // A row spinning for a minute after the tab said the run was over is what
  // this clock is for: while a check runs the read comes round at the tab's pace.
  it('looks again sooner while a check is still running', async () => {
    vi.useFakeTimers()
    answer(request({ checks: 'running' }))
    renderHook(() => useBranchRequests(PLANNER))

    await act(() => vi.advanceTimersByTimeAsync(RUNNING_INTERVAL_MS + 100))

    expect(vi.mocked(octopus().projects.pullRequests).mock.calls.length).toBeGreaterThan(1)
  })

  it('keeps the slow clock when nothing is running', async () => {
    vi.useFakeTimers()
    answer(request({ checks: 'passed' }))
    renderHook(() => useBranchRequests(PLANNER))

    await act(() => vi.advanceTimersByTimeAsync(RUNNING_INTERVAL_MS + 100))

    expect(octopus().projects.pullRequests).toHaveBeenCalledOnce()
  })

  it('stops looking once the project is closed', async () => {
    vi.useFakeTimers()
    answer(request())
    const { unmount } = renderHook(() => useBranchRequests(PLANNER))

    await act(() => vi.advanceTimersByTimeAsync(70_000))
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

    await act(() => vi.advanceTimersByTimeAsync(70_000))

    expect(result.current.byBranch.size).toBe(0)
    // Retried on the same clock rather than given up on for the session.
    expect(vi.mocked(octopus().projects.pullRequests).mock.calls.length).toBeGreaterThan(1)
  })
})

describe('whether the answer was all of them', () => {
  /*
   * The read asks for the hundred most recent requests of the whole repository,
   * so a workspace whose request is older is simply not in the answer — and
   * absent reads exactly like "has none". A caller that cannot tell the two
   * apart will say the wrong thing with complete confidence.
   */
  it('says so when the list came back full', async () => {
    cappedAnswer(request())
    const { result } = renderHook(() => useBranchRequests(PLANNER))

    await waitFor(() => {
      expect(result.current.capped).toBe(true)
    })
  })

  it('says nothing of the sort when it did not', async () => {
    answer(request())
    const { result } = renderHook(() => useBranchRequests(PLANNER))

    await waitFor(() => {
      expect(result.current.byBranch.size).toBe(1)
    })
    expect(result.current.capped).toBe(false)
  })

  // The marks are dropped when the project changes, and so is the doubt: it
  // belongs to a read of the project that is no longer showing.
  it('forgets the doubt with the project it belonged to', async () => {
    cappedAnswer(request())
    const { result, rerender } = renderHook(({ id }) => useBranchRequests(id), {
      initialProps: { id: PLANNER }
    })

    await waitFor(() => {
      expect(result.current.capped).toBe(true)
    })

    unanswered()
    rerender({ id: 'ledger' })

    expect(result.current.capped).toBe(false)
  })
})

describe('whether anything has answered yet', () => {
  /*
   * Before the first answer, `capped` is only where it starts. A caller reading
   * it as "not capped" offered Create PR on a large repository and withdrew it
   * the moment the read landed.
   */
  it('says not until the first answer lands', async () => {
    const gate = held<{ ok: true; value: { requests: BranchRequest[]; capped: boolean } }>()
    vi.mocked(octopus().projects.pullRequests).mockReturnValue(gate.promise)
    const { result } = renderHook(() => useBranchRequests(PLANNER))

    expect(result.current.answered).toBe(false)

    await act(async () => {
      gate.resolve({ ok: true, value: { requests: [], capped: true } })
      await gate.promise
    })
    expect(result.current.answered).toBe(true)
  })

  // A repository with no GitHub remote never answers otherwise, and waiting on
  // it would keep the header's shortcut away for the whole session.
  it('counts a refusal as an answer', async () => {
    vi.mocked(octopus().projects.pullRequests).mockResolvedValue({
      ok: false,
      error: 'gh: no remote',
      code: 'notConnected'
    })
    const { result } = renderHook(() => useBranchRequests(PLANNER))

    await waitFor(() => {
      expect(result.current.answered).toBe(true)
    })
  })

  it('starts over with the next project', async () => {
    answer(request())
    const { result, rerender } = renderHook(({ id }) => useBranchRequests(id), {
      initialProps: { id: PLANNER }
    })

    await waitFor(() => {
      expect(result.current.answered).toBe(true)
    })

    unanswered()
    rerender({ id: 'ledger' })

    expect(result.current.answered).toBe(false)
  })
})
