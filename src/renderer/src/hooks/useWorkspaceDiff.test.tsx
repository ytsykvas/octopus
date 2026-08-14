import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceDiff } from '@core/diff.js'
import type { AgentEvent } from '@core/events.js'

import { fileDiff, workspaceDiff } from '../test/diff.js'
import { octopus } from '../test/octopus.js'
import { useWorkspaceDiff } from './useWorkspaceDiff.js'

const WORKSPACE = 'planner/anna'

/** Delivers an event the way the bridge does, to whoever subscribed. */
function emit(event: AgentEvent, workspaceId = WORKSPACE): void {
  const [subscriber] = vi.mocked(octopus().chats.onEvent).mock.calls.at(-1) ?? []
  act(() => {
    subscriber?.({ chatId: 'chat-1', workspaceId, event })
  })
}

const DONE: AgentEvent = {
  type: 'result',
  ok: true,
  costUsd: null,
  durationMs: 1,
  inputTokens: null,
  outputTokens: null,
  terminalReason: null
}

const answering = (diff: WorkspaceDiff): void => {
  vi.mocked(octopus().workspaces.diff).mockResolvedValue({ ok: true, value: diff })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('what a workspace has changed', () => {
  it('reads as soon as there is a workspace to read', async () => {
    answering(workspaceDiff([fileDiff('a.ts')]))

    const { result } = renderHook(() => useWorkspaceDiff(WORKSPACE, true))

    await waitFor(() => {
      expect(result.current.diff?.files).toHaveLength(1)
    })
    expect(result.current.loading).toBe(false)
  })

  it('reads nothing before a workspace is chosen', () => {
    renderHook(() => useWorkspaceDiff(null, true))

    expect(octopus().workspaces.diff).not.toHaveBeenCalled()
  })

  // Nothing to read means nothing is pending either, or the pane would sit on
  // "reading the changes" for a workspace it will never ask about.
  it('is not waiting on anything when there is no workspace', () => {
    const { result } = renderHook(() => useWorkspaceDiff(null, true))

    expect(result.current.loading).toBe(false)
  })

  it('reads again when the agent finishes a turn', async () => {
    vi.useFakeTimers()
    answering(workspaceDiff([]))
    renderHook(() => useWorkspaceDiff(WORKSPACE, true))
    await vi.waitFor(() => {
      expect(octopus().workspaces.diff).toHaveBeenCalledTimes(1)
    })

    emit(DONE)
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(octopus().workspaces.diff).toHaveBeenCalledTimes(2)
  })

  // A turn that failed may well have written files before it did.
  it('reads again when a turn ends in an error', async () => {
    vi.useFakeTimers()
    answering(workspaceDiff([]))
    renderHook(() => useWorkspaceDiff(WORKSPACE, true))
    await vi.waitFor(() => {
      expect(octopus().workspaces.diff).toHaveBeenCalledTimes(1)
    })

    emit({ type: 'error', message: 'stopped' })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(octopus().workspaces.diff).toHaveBeenCalledTimes(2)
  })

  it('ignores a turn finishing in another workspace', async () => {
    vi.useFakeTimers()
    answering(workspaceDiff([]))
    renderHook(() => useWorkspaceDiff(WORKSPACE, true))
    await vi.waitFor(() => {
      expect(octopus().workspaces.diff).toHaveBeenCalledTimes(1)
    })

    emit(DONE, 'planner/bob')
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(octopus().workspaces.diff).toHaveBeenCalledTimes(1)
  })

  // Every streamed fragment would otherwise be a git read.
  it('ignores everything that is not a turn ending', async () => {
    vi.useFakeTimers()
    answering(workspaceDiff([]))
    renderHook(() => useWorkspaceDiff(WORKSPACE, true))
    await vi.waitFor(() => {
      expect(octopus().workspaces.diff).toHaveBeenCalledTimes(1)
    })

    emit({ type: 'text_delta', text: 'still going' })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(octopus().workspaces.diff).toHaveBeenCalledTimes(1)
  })

  it('reads nothing while another tab is showing', () => {
    renderHook(() => useWorkspaceDiff(WORKSPACE, false))

    expect(octopus().workspaces.diff).not.toHaveBeenCalled()
  })

  // Behind a hidden tab there is nobody to show it to; the read happens when
  // the tab comes back rather than for every turn that ends behind it.
  it('ignores a turn that ends behind a hidden tab', async () => {
    vi.useFakeTimers()
    answering(workspaceDiff([]))
    renderHook(() => useWorkspaceDiff(WORKSPACE, false))

    emit(DONE)
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(octopus().workspaces.diff).not.toHaveBeenCalled()
  })

  it('reads when the tab comes back', async () => {
    answering(workspaceDiff([]))
    const { rerender } = renderHook(({ visible }) => useWorkspaceDiff(WORKSPACE, visible), {
      initialProps: { visible: false }
    })

    rerender({ visible: true })

    await waitFor(() => {
      expect(octopus().workspaces.diff).toHaveBeenCalledWith(WORKSPACE)
    })
  })

  it('reads again on request', async () => {
    answering(workspaceDiff([]))
    const { result } = renderHook(() => useWorkspaceDiff(WORKSPACE, true))
    await waitFor(() => {
      expect(octopus().workspaces.diff).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      await result.current.refresh()
    })

    expect(octopus().workspaces.diff).toHaveBeenCalledTimes(2)
  })

  it('has nothing to read again before a workspace is chosen', async () => {
    const { result } = renderHook(() => useWorkspaceDiff(null, true))

    await act(async () => {
      await result.current.refresh()
    })

    expect(octopus().workspaces.diff).not.toHaveBeenCalled()
  })

  it('explains a failure rather than showing a stale diff', async () => {
    vi.mocked(octopus().workspaces.diff).mockResolvedValue({
      ok: false,
      error: 'merge-base failed',
      code: 'baseUnknown',
      params: { branch: 'main' }
    })

    const { result } = renderHook(() => useWorkspaceDiff(WORKSPACE, true))

    await waitFor(() => {
      expect(result.current.error).toMatch(/branched off main/)
    })
    expect(result.current.diff).toBeNull()
  })

  it('drops the previous workspace’s diff the moment another is opened', async () => {
    answering(workspaceDiff([fileDiff('a.ts')]))
    const { result, rerender } = renderHook(({ id }) => useWorkspaceDiff(id, true), {
      initialProps: { id: WORKSPACE }
    })
    await waitFor(() => {
      expect(result.current.diff).not.toBeNull()
    })

    rerender({ id: 'planner/bob' })

    expect(result.current.diff).toBeNull()
  })

  /*
   * The reply for a workspace nobody is looking at any more must not land.
   *
   * git is slow enough for this to happen on a real repository: a read is still
   * running when the workspace changes, and writing its answer afterwards would
   * put one workspace's files under another's name. Both routes into the state
   * are covered because they guard differently — the read a workspace starts on
   * arrival is dropped by its own effect being cleaned up, while one a refresh
   * or a finished turn started has no cleanup and is caught on the way in.
   */
  it('drops the read a workspace switch has already made irrelevant', async () => {
    const slow = deferred()
    vi.mocked(octopus().workspaces.diff).mockReturnValueOnce(slow.promise)
    const { result, rerender } = renderHook(({ id }) => useWorkspaceDiff(id, true), {
      initialProps: { id: WORKSPACE }
    })

    answering(workspaceDiff([fileDiff('bob.ts')]))
    rerender({ id: 'planner/bob' })
    await waitFor(() => {
      expect(result.current.diff?.files[0]?.path).toBe('bob.ts')
    })

    await act(async () => {
      slow.settle(workspaceDiff([fileDiff('anna.ts')]))
      await slow.promise
    })

    expect(result.current.diff?.files[0]?.path).toBe('bob.ts')
  })

  it('drops a re-read that finished after the workspace changed', async () => {
    answering(workspaceDiff([fileDiff('anna.ts')]))
    const { result, rerender } = renderHook(({ id }) => useWorkspaceDiff(id, true), {
      initialProps: { id: WORKSPACE }
    })
    await waitFor(() => {
      expect(result.current.diff).not.toBeNull()
    })

    const slow = deferred()
    vi.mocked(octopus().workspaces.diff).mockReturnValueOnce(slow.promise)
    const reading = result.current.refresh()

    answering(workspaceDiff([fileDiff('bob.ts')]))
    rerender({ id: 'planner/bob' })
    await waitFor(() => {
      expect(result.current.diff?.files[0]?.path).toBe('bob.ts')
    })

    await act(async () => {
      slow.settle(workspaceDiff([fileDiff('stale.ts')]))
      await reading
    })

    expect(result.current.diff?.files[0]?.path).toBe('bob.ts')
  })
})

/** A read that has not answered yet, so a test can decide when it does. */
function deferred(): {
  readonly promise: Promise<{ ok: true; value: WorkspaceDiff }>
  readonly settle: (diff: WorkspaceDiff) => void
} {
  let settle: (value: { ok: true; value: WorkspaceDiff }) => void = () => undefined
  const promise = new Promise<{ ok: true; value: WorkspaceDiff }>((resolve) => {
    settle = resolve
  })

  return {
    promise,
    settle: (diff) => {
      settle({ ok: true, value: diff })
    }
  }
}
