import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BranchRequest } from '@core/pullRequestShapes.js'

import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { failOnUpdatesOutsideAct } from '../test/updatesOutsideAct.js'
import { emitBranchMoved } from '../test/workspaces.js'
import { PUSH_SETTLE_MS } from './pullRequestPace.js'
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
  draft: false,
  decision: null,
  mergeable: 'mergeable',
  mergeState: 'clean',
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

  // A fresh map on every read redrew the whole window each minute, every
  // conversation in it, for requests that had not moved.
  it('keeps the same answer when a read brings nothing new', async () => {
    vi.useFakeTimers()
    answer(request())
    const { result } = renderHook(() => useBranchRequests(PLANNER, ['ledger']))
    await act(() => vi.advanceTimersByTimeAsync(0))
    const first = result.current

    await act(() => vi.advanceTimersByTimeAsync(70_000))

    expect(vi.mocked(octopus().projects.pullRequests).mock.calls.length).toBeGreaterThan(2)
    expect(result.current.byProject).toBe(first.byProject)
    expect(result.current.byBranch).toBe(first.byBranch)
  })

  it('takes the new answer when a read brings one', async () => {
    vi.useFakeTimers()
    answer(request())
    const { result } = renderHook(() => useBranchRequests(PLANNER))
    await act(() => vi.advanceTimersByTimeAsync(0))
    const first = result.current.byProject

    answer(request({ state: 'merged' }))
    await act(() => vi.advanceTimersByTimeAsync(70_000))

    expect(result.current.byProject).not.toBe(first)
    expect(result.current.byBranch.get('ytsykvas/anna')?.state).toBe('merged')
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

  /*
   * A push puts nothing running at first: GitHub takes a few seconds to put a
   * check on the new commit, so the read made at the push said "passed" about
   * the commit before, and the row waited a minute to start spinning.
   */
  it('reads at a push, and keeps the fast clock for a while after it', async () => {
    vi.useFakeTimers()
    answer(request({ checks: 'passed' }))
    renderHook(() => useBranchRequests(PLANNER))
    const asked = (): number => vi.mocked(octopus().projects.pullRequests).mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(asked()).toBe(1)

    emitBranchMoved('planner/anna', 'a'.repeat(40), PLANNER)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(asked()).toBe(2)

    await act(() => vi.advanceTimersByTimeAsync(RUNNING_INTERVAL_MS + 100))
    expect(asked()).toBe(3)

    // Fifteen-second steps until the window closes, then the minute again.
    await act(() => vi.advanceTimersByTimeAsync(PUSH_SETTLE_MS - RUNNING_INTERVAL_MS))
    expect(asked()).toBe(8)
    await act(() => vi.advanceTimersByTimeAsync(59_000))
    expect(asked()).toBe(8)
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(asked()).toBe(9)
  })

  it('ignores a push in a project it is not showing', async () => {
    vi.useFakeTimers()
    answer(request({ checks: 'passed' }))
    renderHook(() => useBranchRequests(PLANNER))
    await act(() => vi.advanceTimersByTimeAsync(0))

    emitBranchMoved('ledger/anna', 'a'.repeat(40), 'ledger')
    await act(() => vi.advanceTimersByTimeAsync(RUNNING_INTERVAL_MS + 100))

    expect(octopus().projects.pullRequests).toHaveBeenCalledOnce()
  })

  /*
   * A push starts a read while the last one may still be on its way. That
   * older one describes the branch before the push, and answering second it
   * used to overwrite the newer answer — and leave a second clock running.
   */
  it('drops the answer of a read a push overtook, and keeps one clock', async () => {
    vi.useFakeTimers()
    const before = held<Awaited<ReturnType<typeof window.octopus.projects.pullRequests>>>()
    const after = held<Awaited<ReturnType<typeof window.octopus.projects.pullRequests>>>()
    vi.mocked(octopus().projects.pullRequests)
      .mockReturnValueOnce(before.promise)
      .mockReturnValueOnce(after.promise)
    answer(request({ checks: 'passed' }))
    const { result } = renderHook(() => useBranchRequests(PLANNER))

    emitBranchMoved('planner/anna', 'a'.repeat(40), PLANNER)
    await act(async () => {
      after.resolve({
        ok: true,
        value: { requests: [request({ checks: 'passed' })], capped: false }
      })
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      before.resolve({
        ok: true,
        value: { requests: [request({ checks: 'running' })], capped: false }
      })
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.byBranch.get('ytsykvas/anna')?.checks).toBe('passed')
    const asked = vi.mocked(octopus().projects.pullRequests).mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(RUNNING_INTERVAL_MS + 100))
    expect(vi.mocked(octopus().projects.pullRequests).mock.calls.length).toBe(asked + 1)
  })

  it('keeps the slow clock when nothing is running', async () => {
    vi.useFakeTimers()
    answer(request({ checks: 'passed' }))
    renderHook(() => useBranchRequests(PLANNER))

    await act(() => vi.advanceTimersByTimeAsync(RUNNING_INTERVAL_MS + 100))

    expect(octopus().projects.pullRequests).toHaveBeenCalledOnce()
  })

  // A mark nobody can see is not worth a GraphQL query a minute, all day.
  it('holds the next look while the window is hidden, and takes it once on the way back', async () => {
    vi.useFakeTimers()
    answer(request())
    renderHook(() => useBranchRequests(PLANNER, ['ledger']))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(octopus().projects.pullRequests).toHaveBeenCalledTimes(2)

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    await act(() => vi.advanceTimersByTimeAsync(600_000))
    expect(octopus().projects.pullRequests).toHaveBeenCalledTimes(2)

    hidden.mockReturnValue(false)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(octopus().projects.pullRequests).toHaveBeenCalledTimes(4)
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

describe('the other projects the status bar counts', () => {
  it('asks about each of them and keeps their answers apart', async () => {
    vi.mocked(octopus().projects.pullRequests).mockImplementation((id) =>
      Promise.resolve({
        ok: true,
        value: { requests: [request({ number: id === PLANNER ? 1 : 2 })], capped: false }
      })
    )
    const { result } = renderHook(() => useBranchRequests(PLANNER, ['ledger']))

    await waitFor(() => {
      expect(result.current.byProject.size).toBe(2)
    })
    expect(result.current.byProject.get('ledger')?.get('ytsykvas/anna')?.number).toBe(2)
    expect(result.current.byBranch.get('ytsykvas/anna')?.number).toBe(1)
  })

  // On the open project's clock, not a second one: two pollers would ask `gh`
  // about the open project twice a minute.
  it('asks about the open project once even when it is also watched', async () => {
    answer(request())
    renderHook(() => useBranchRequests(PLANNER, [PLANNER]))

    await waitFor(() => {
      expect(octopus().projects.pullRequests).toHaveBeenCalledExactlyOnceWith(PLANNER)
    })
  })

  // The fast clock is for the open project's rows, which stop spinning the
  // moment the checks are done. A watched project has no rows; its count can
  // lag a minute, and a few repositories with long CI runs were a GraphQL
  // query every 15 s each, all day.
  it('keeps a watched project on the slow clock while its check runs', async () => {
    vi.useFakeTimers()
    answer(request({ checks: 'running' }))
    renderHook(() => useBranchRequests(PLANNER, ['ledger']))
    const asked = (id: string): number =>
      vi.mocked(octopus().projects.pullRequests).mock.calls.filter(([of]) => of === id).length

    await act(() => vi.advanceTimersByTimeAsync(RUNNING_INTERVAL_MS + 100))
    expect(asked(PLANNER)).toBe(2)
    expect(asked('ledger')).toBe(1)

    await act(() => vi.advanceTimersByTimeAsync(50_000))
    expect(asked('ledger')).toBe(2)
  })

  // The caller builds the list every render; the same projects in a fresh
  // array must not start every read over.
  it('does not start over for the same projects in a fresh list', async () => {
    answer(request())
    const { rerender } = renderHook(({ also }) => useBranchRequests(null, also), {
      initialProps: { also: ['ledger'] }
    })
    await waitFor(() => {
      expect(octopus().projects.pullRequests).toHaveBeenCalledOnce()
    })

    rerender({ also: ['ledger'] })

    expect(octopus().projects.pullRequests).toHaveBeenCalledOnce()
  })

  // The status bar's projects can lag their minute; a push says nothing about them.
  it('re-reads only the project the push was in', async () => {
    vi.useFakeTimers()
    answer(request({ checks: 'passed' }))
    renderHook(() => useBranchRequests(PLANNER, ['ledger']))
    const asked = (id: string): number =>
      vi.mocked(octopus().projects.pullRequests).mock.calls.filter(([of]) => of === id).length
    await act(() => vi.advanceTimersByTimeAsync(0))

    emitBranchMoved('planner/anna', 'a'.repeat(40), PLANNER)
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(asked(PLANNER)).toBe(2)
    expect(asked('ledger')).toBe(1)
  })
})

// Folding the status bar takes the other projects off the clock; one left
// ticking would go on asking `gh` about a project nothing is showing.
it('stops asking about a project once it is no longer watched', async () => {
  vi.useFakeTimers()
  answer(request())
  const { rerender } = renderHook(({ also }) => useBranchRequests(PLANNER, also), {
    initialProps: { also: ['ledger'] as readonly string[] }
  })
  await act(() => vi.advanceTimersByTimeAsync(0))

  rerender({ also: [] })
  vi.mocked(octopus().projects.pullRequests).mockClear()
  await act(() => vi.advanceTimersByTimeAsync(130_000))

  const asked = vi.mocked(octopus().projects.pullRequests).mock.calls.map(([id]) => id)
  expect(asked).not.toContain('ledger')
  expect(asked).toContain(PLANNER)
})
