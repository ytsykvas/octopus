import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PullRequestCheck, PullRequestDetail } from '@core/pullRequestShapes.js'

import { emitAgentEvent } from '../test/chat.js'
import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { usePullRequestDetail } from './usePullRequestDetail.js'

const ANNA = 'planner/anna'

function detail(overrides: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    state: 'open',
    title: 'Rename the thing',
    url: 'https://github.com/o/p/pull/7',
    draft: false,
    checks: [],
    comments: [],
    decision: null,
    mergeable: 'mergeable',
    mergeState: 'clean',
    capped: false,
    ...overrides
  }
}

const check = (state: PullRequestCheck['state']): PullRequestCheck => ({
  name: 'build',
  workflow: null,
  state,
  url: null,
  startedAt: null,
  completedAt: null
})

function answer(value: PullRequestDetail): void {
  vi.mocked(octopus().workspaces.pullRequestDetail).mockResolvedValue({ ok: true, value })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the checks and the review of one request', () => {
  it('asks for the request it was given', async () => {
    answer(detail())
    const { result } = renderHook(() => usePullRequestDetail(ANNA, 7, true))

    await waitFor(() => {
      expect(result.current.detail).not.toBeNull()
    })
    expect(octopus().workspaces.pullRequestDetail).toHaveBeenCalledWith(ANNA, 7)
  })

  // A branch with no request has nothing to ask about, and a tab nobody is
  // looking at is the reason `enabled` exists at all.
  it('asks nothing without a request, and nothing behind another tab', () => {
    renderHook(() => usePullRequestDetail(ANNA, null, true))
    renderHook(() => usePullRequestDetail(ANNA, 7, false))
    renderHook(() => usePullRequestDetail(null, 7, true))

    expect(octopus().workspaces.pullRequestDetail).not.toHaveBeenCalled()
  })

  /*
   * The failure this one has to be able to report on its own: the branch was
   * described fine, and only its checks are missing. The pane keeps the number
   * and the link and says what it could not read.
   */
  it('reports a refusal without pretending there is no request', async () => {
    vi.mocked(octopus().workspaces.pullRequestDetail).mockResolvedValue({
      ok: false,
      error: 'gh: not logged in',
      code: 'notConnected'
    })
    const { result } = renderHook(() => usePullRequestDetail(ANNA, 7, true))

    await waitFor(() => {
      expect(result.current.error).toContain('GitHub')
    })
    expect(result.current.detail).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('asks again when asked to', async () => {
    answer(detail())
    const { result } = renderHook(() => usePullRequestDetail(ANNA, 7, true))

    await waitFor(() => {
      expect(result.current.detail).not.toBeNull()
    })

    act(() => {
      result.current.refresh()
    })

    await waitFor(() => {
      expect(octopus().workspaces.pullRequestDetail).toHaveBeenCalledTimes(2)
    })
  })

  /*
   * A pane showing the previous request's checks for a frame would be reporting
   * on a branch that is not the one on screen — which is why the comparison
   * happens during render rather than in an effect.
   */
  it('forgets what it knew the moment another request is asked about', async () => {
    answer(detail())
    const { result, rerender } = renderHook(
      ({ number }: { number: number }) => usePullRequestDetail(ANNA, number, true),
      { initialProps: { number: 7 } }
    )

    await waitFor(() => {
      expect(result.current.detail).not.toBeNull()
    })

    rerender({ number: 8 })
    expect(result.current.detail).toBeNull()
  })

  // An answer that arrives after the request changed under it belongs to a
  // number nobody is looking at any more.
  it('drops an answer that arrives after the tab has gone', async () => {
    const gate = held<{ ok: true; value: PullRequestDetail }>()
    vi.mocked(octopus().workspaces.pullRequestDetail).mockReturnValue(gate.promise)

    const { result, unmount } = renderHook(() => usePullRequestDetail(ANNA, 7, true))
    unmount()

    gate.resolve({ ok: true, value: detail() })
    await Promise.resolve()

    expect(result.current.detail).toBeNull()
  })
})

describe('waiting for something to settle', () => {
  it('looks again while a check is still running', async () => {
    vi.useFakeTimers()
    answer(detail({ checks: [check('pending')] }))
    renderHook(() => usePullRequestDetail(ANNA, 7, true))

    await vi.advanceTimersByTimeAsync(20_000)

    expect(vi.mocked(octopus().workspaces.pullRequestDetail).mock.calls.length).toBeGreaterThan(1)
  })

  /*
   * GitHub computes mergeability asynchronously, so the first read after every
   * push says it does not know — and a request whose repository runs no CI has
   * no pending check to wait on either. Waiting on the checks alone would leave
   * both of those unknown for ever.
   */
  it('looks again while GitHub is still working out whether it can be merged', async () => {
    vi.useFakeTimers()
    answer(detail({ mergeable: 'unknown' }))
    renderHook(() => usePullRequestDetail(ANNA, 7, true))

    await vi.advanceTimersByTimeAsync(20_000)

    expect(vi.mocked(octopus().workspaces.pullRequestDetail).mock.calls.length).toBeGreaterThan(1)
  })

  /*
   * A check that has **failed** is not pending, so the poll stopped exactly
   * when a fix was on its way — and an agent pushing that fix in its own
   * worktree raised nothing this hook listened to. The diff pane already
   * re-reads when a turn ends in the workspace; this is the same
   * subscription, and the same settle.
   */
  it('looks again when a turn ends in this workspace', async () => {
    vi.useFakeTimers()
    answer(detail({ checks: [check('failed')] }))
    renderHook(() => usePullRequestDetail(ANNA, 7, true))
    await vi.advanceTimersByTimeAsync(0)
    expect(octopus().workspaces.pullRequestDetail).toHaveBeenCalledTimes(1)

    emitAgentEvent({ type: 'result', ok: true, durationMs: 1, costUsd: 0 } as never)
    // The settle fires `refresh`, which is a state update: outside `act` the
    // re-render that re-runs the reading effect is not flushed under fake
    // timers, so the read would be counted a tick too early.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(octopus().workspaces.pullRequestDetail).toHaveBeenCalledTimes(2)
  })

  // Any chat in the workspace writes to the same worktree; a turn ending in
  // another workspace says nothing about this branch.
  it('ignores a turn that ended in another workspace', async () => {
    vi.useFakeTimers()
    answer(detail({ checks: [check('failed')] }))
    renderHook(() => usePullRequestDetail('planner/bob', 7, true))
    await vi.advanceTimersByTimeAsync(0)

    emitAgentEvent({ type: 'result', ok: true, durationMs: 1, costUsd: 0 } as never)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(octopus().workspaces.pullRequestDetail).toHaveBeenCalledTimes(1)
  })

  // Only a turn ending says anything about the branch; what the agent said
  // along the way does not, and a read per streamed line would be a poll in
  // disguise.
  it('ignores an event that is not the end of a turn', async () => {
    vi.useFakeTimers()
    answer(detail({ checks: [check('failed')] }))
    renderHook(() => usePullRequestDetail(ANNA, 7, true))
    await vi.advanceTimersByTimeAsync(0)

    emitAgentEvent({ type: 'text', text: 'pushing now' } as never)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(octopus().workspaces.pullRequestDetail).toHaveBeenCalledTimes(1)
  })

  /*
   * On its own, because the pair below cannot tell the two arms apart — the
   * `result` in it schedules the read either way. A turn that failed may well
   * have pushed before it did, which is the whole reason `error` is in the
   * guard beside `result`.
   */
  it('reads again when a turn ends in failure', async () => {
    vi.useFakeTimers()
    answer(detail({ checks: [check('failed')] }))
    renderHook(() => usePullRequestDetail(ANNA, 7, true))
    await vi.advanceTimersByTimeAsync(0)

    emitAgentEvent({ type: 'error', message: 'claude exited with code 1' } as never)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(octopus().workspaces.pullRequestDetail).toHaveBeenCalledTimes(2)
  })

  // Two turns ending within the settle read once, not twice: the second
  // arrival replaces the first timer rather than joining it.
  it('reads once for two turns that end together', async () => {
    vi.useFakeTimers()
    answer(detail({ checks: [check('failed')] }))
    renderHook(() => usePullRequestDetail(ANNA, 7, true))
    await vi.advanceTimersByTimeAsync(0)

    emitAgentEvent({ type: 'result', ok: true, durationMs: 1, costUsd: 0 } as never)
    emitAgentEvent({ type: 'error', message: 'and then this' } as never)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(octopus().workspaces.pullRequestDetail).toHaveBeenCalledTimes(2)
  })

  // Behind a hidden tab there is nobody to show it to, and the reading effect
  // asks again when the tab comes back.
  it('does not read for a turn that ended while the tab was hidden', async () => {
    vi.useFakeTimers()
    answer(detail({ checks: [check('failed')] }))
    const { rerender } = renderHook(({ enabled }) => usePullRequestDetail(ANNA, 7, enabled), {
      initialProps: { enabled: true }
    })
    await vi.advanceTimersByTimeAsync(0)
    rerender({ enabled: false })

    emitAgentEvent({ type: 'result', ok: true, durationMs: 1, costUsd: 0 } as never)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(octopus().workspaces.pullRequestDetail).toHaveBeenCalledTimes(1)
  })

  // A settle still pending when the pane goes is dropped with it, not fired
  // into a hook that no longer exists.
  it('drops a pending re-read when it unmounts', async () => {
    vi.useFakeTimers()
    answer(detail({ checks: [check('failed')] }))
    const { unmount } = renderHook(() => usePullRequestDetail(ANNA, 7, true))
    await vi.advanceTimersByTimeAsync(0)

    emitAgentEvent({ type: 'result', ok: true, durationMs: 1, costUsd: 0 } as never)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount()

    // The timer itself, not the read it would have caused: the reading effect
    // is torn down with the hook, so a count of calls says the same thing
    // whether or not the settle was cleared.
    expect(vi.getTimerCount()).toBe(0)
  })

  // A push from the built-in terminal raises no chat event, so the one thing
  // that tells a fresh answer from a stale one is when it was read.
  it('says when it last read', async () => {
    answer(detail())
    const { result } = renderHook(() => usePullRequestDetail(ANNA, 7, true))

    await waitFor(() => {
      expect(result.current.detail).not.toBeNull()
    })
    expect(result.current.readAt).toEqual(expect.any(String))
  })

  it('stops once everything has settled', async () => {
    vi.useFakeTimers()
    answer(detail({ checks: [check('passed')] }))
    renderHook(() => usePullRequestDetail(ANNA, 7, true))

    await vi.advanceTimersByTimeAsync(60_000)

    expect(octopus().workspaces.pullRequestDetail).toHaveBeenCalledTimes(1)
  })

  // The timer belongs to the pane. Left running, it would keep asking GitHub
  // about a workspace nobody has open.
  it('stops looking once the tab is gone', async () => {
    vi.useFakeTimers()
    answer(detail({ checks: [check('pending')] }))
    const { unmount } = renderHook(() => usePullRequestDetail(ANNA, 7, true))

    await vi.advanceTimersByTimeAsync(20_000)
    const asked = vi.mocked(octopus().workspaces.pullRequestDetail).mock.calls.length
    unmount()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(octopus().workspaces.pullRequestDetail).toHaveBeenCalledTimes(asked)
  })
})
