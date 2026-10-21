import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentEvent } from '@core/events.js'

import { emitAgentEvent } from '../test/chat.js'
import { octopus } from '../test/octopus.js'
import { SETTLE_MS } from './useTurnSettled.js'
import { useWorkspaceSettled } from './useWorkspaceSettled.js'

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

// The turn half is `useTurnSettled`'s, and tested there; this is the focus half
// and the two together.
describe('useWorkspaceSettled', () => {
  it('calls back once a turn in the workspace has settled', () => {
    vi.useFakeTimers()
    const settled = vi.fn()
    renderHook(() => {
      useWorkspaceSettled(WORKSPACE, true, settled)
    })

    emitAgentEvent(DONE)
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS)
    })

    expect(settled).toHaveBeenCalledTimes(1)
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

  it('stops listening for focus once disabled', () => {
    const settled = vi.fn()
    const { rerender } = renderHook(
      ({ enabled }) => {
        useWorkspaceSettled(WORKSPACE, enabled, settled)
      },
      { initialProps: { enabled: true } }
    )

    rerender({ enabled: false })
    act(() => {
      window.dispatchEvent(new Event('focus'))
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
