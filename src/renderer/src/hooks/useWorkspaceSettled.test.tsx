import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentEvent } from '@core/events.js'

import { emitAgentEvent } from '../test/chat.js'
import { octopus } from '../test/octopus.js'
import { SETTLE_MS, useWorkspaceSettled } from './useWorkspaceSettled.js'

const WORKSPACE = 'planner/anna'

const DONE: AgentEvent = {
  type: 'result',
  ok: true,
  costUsd: null,
  durationMs: 1,
  inputTokens: null,
  outputTokens: null,
  terminalReason: null
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useWorkspaceSettled', () => {
  it('calls back once a turn in the workspace has settled, once for a burst', () => {
    vi.useFakeTimers()
    const settled = vi.fn()
    renderHook(() => {
      useWorkspaceSettled(WORKSPACE, true, settled)
    })

    emitAgentEvent({ type: 'error', message: 'failed' })
    emitAgentEvent(DONE)
    expect(settled).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(SETTLE_MS)
    })
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('ignores what is not the end of a turn, and other workspaces', () => {
    vi.useFakeTimers()
    const settled = vi.fn()
    renderHook(() => {
      useWorkspaceSettled(WORKSPACE, true, settled)
    })

    emitAgentEvent({ type: 'text', text: 'hello' })
    const [subscriber] = vi.mocked(octopus().chats.onEvent).mock.calls.at(-1) ?? []
    act(() => {
      subscriber?.({ chatId: 'chat-1', workspaceId: 'planner/bob', event: DONE })
      vi.advanceTimersByTime(SETTLE_MS)
    })

    expect(settled).not.toHaveBeenCalled()
  })

  it('calls back when the window comes back', () => {
    const settled = vi.fn()
    renderHook(() => {
      useWorkspaceSettled(WORKSPACE, true, settled)
    })

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('listens to nothing while disabled or without a workspace', () => {
    const settled = vi.fn()
    renderHook(() => {
      useWorkspaceSettled(WORKSPACE, false, settled)
    })
    renderHook(() => {
      useWorkspaceSettled(null, true, settled)
    })

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(settled).not.toHaveBeenCalled()
    expect(octopus().chats.onEvent).not.toHaveBeenCalled()
  })

  // A read waiting when the tab is hidden would land on a pane nobody sees.
  it('drops a pending read when it stops listening', () => {
    vi.useFakeTimers()
    const settled = vi.fn()
    const { rerender } = renderHook(
      ({ enabled }) => {
        useWorkspaceSettled(WORKSPACE, enabled, settled)
      },
      { initialProps: { enabled: true } }
    )

    emitAgentEvent(DONE)
    rerender({ enabled: false })
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS)
    })

    expect(settled).not.toHaveBeenCalled()
  })

  it('calls the newest callback without listening again', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(
      ({ callback }) => {
        useWorkspaceSettled(WORKSPACE, true, callback)
      },
      { initialProps: { callback: first } }
    )

    rerender({ callback: second })
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(octopus().chats.onEvent).toHaveBeenCalledTimes(1)
  })
})
