import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { emitAgentEvent, TURN_DONE } from '../test/chat.js'
import { octopus } from '../test/octopus.js'
import { SETTLE_MS, useTurnSettled } from './useTurnSettled.js'

const WORKSPACE = 'planner/anna'

function setHidden(hidden: boolean): void {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden)
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useTurnSettled', () => {
  it('calls back once a turn in the workspace has settled, once for a burst', () => {
    vi.useFakeTimers()
    const settled = vi.fn()
    renderHook(() => {
      useTurnSettled(WORKSPACE, true, settled)
    })

    emitAgentEvent({ type: 'error', message: 'failed' })
    emitAgentEvent(TURN_DONE)
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS - 1)
    })
    expect(settled).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('ignores what is not the end of a turn, and other workspaces', () => {
    vi.useFakeTimers()
    const settled = vi.fn()
    renderHook(() => {
      useTurnSettled(WORKSPACE, true, settled)
    })

    emitAgentEvent({ type: 'text', text: 'hello' })
    const [subscriber] = vi.mocked(octopus().chats.onEvent).mock.calls.at(-1) ?? []
    act(() => {
      subscriber?.({ chatId: 'chat-1', workspaceId: 'planner/bob', event: TURN_DONE })
      vi.advanceTimersByTime(SETTLE_MS)
    })

    expect(settled).not.toHaveBeenCalled()
  })

  it('listens to nothing while disabled or without a workspace', () => {
    renderHook(() => {
      useTurnSettled(WORKSPACE, false, vi.fn())
    })
    renderHook(() => {
      useTurnSettled(null, true, vi.fn())
    })

    expect(octopus().chats.onEvent).not.toHaveBeenCalled()
  })

  // A read waiting when the tab is hidden would land on a pane nobody sees.
  it('drops a pending read when it stops listening', () => {
    vi.useFakeTimers()
    const settled = vi.fn()
    const { rerender } = renderHook(
      ({ enabled }) => {
        useTurnSettled(WORKSPACE, enabled, settled)
      },
      { initialProps: { enabled: true } }
    )

    emitAgentEvent(TURN_DONE)
    rerender({ enabled: false })
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS)
    })

    expect(settled).not.toHaveBeenCalled()
  })

  it('calls the newest callback without listening again', () => {
    vi.useFakeTimers()
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(
      ({ callback }) => {
        useTurnSettled(WORKSPACE, true, callback)
      },
      { initialProps: { callback: first } }
    )

    rerender({ callback: second })
    emitAgentEvent(TURN_DONE)
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS)
    })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(octopus().chats.onEvent).toHaveBeenCalledTimes(1)
  })

  /*
   * Agents are left to work exactly when nobody is looking, and every turn end
   * behind a minimised window used to cost the open tab its whole read — a
   * dozen git processes for the diff — for a pane nobody could see.
   */
  it('holds turns that end while the window is hidden, and reads once when it is shown', () => {
    vi.useFakeTimers()
    const settled = vi.fn()
    renderHook(() => {
      useTurnSettled(WORKSPACE, true, settled)
    })
    setHidden(true)

    emitAgentEvent(TURN_DONE)
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS)
    })
    emitAgentEvent(TURN_DONE)
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS * 10)
    })
    expect(settled).not.toHaveBeenCalled()

    setHidden(false)
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('drops what it held for a hidden window once it stops listening', () => {
    vi.useFakeTimers()
    const settled = vi.fn()
    const { unmount } = renderHook(() => {
      useTurnSettled(WORKSPACE, true, settled)
    })
    setHidden(true)
    emitAgentEvent(TURN_DONE)
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS)
    })

    unmount()
    setHidden(false)

    expect(settled).not.toHaveBeenCalled()
  })
})
