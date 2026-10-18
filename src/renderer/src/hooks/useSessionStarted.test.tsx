import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { emitAgentEvent } from '../test/chat.js'
import { octopus } from '../test/octopus.js'
import { useSessionStarted } from './useSessionStarted.js'

const CHAT = 'chat-1'
const STARTED = { type: 'session_started', sessionId: 'sess-1' } as const

describe('hearing that a conversation’s session started', () => {
  it('calls back when this conversation’s session starts', () => {
    const onStart = vi.fn()
    renderHook(() => {
      useSessionStarted(CHAT, onStart)
    })

    emitAgentEvent(STARTED, CHAT)

    expect(onStart).toHaveBeenCalledExactlyOnceWith(CHAT)
  })

  /*
   * A pane woken by another conversation's session would re-read its own list
   * for nothing — or, as `useCommands` once did, take the other one's.
   */
  it('ignores another conversation’s session', () => {
    const onStart = vi.fn()
    renderHook(() => {
      useSessionStarted(CHAT, onStart)
    })

    emitAgentEvent(STARTED, 'chat-2')

    expect(onStart).not.toHaveBeenCalled()
  })

  it('ignores every other event', () => {
    const onStart = vi.fn()
    renderHook(() => {
      useSessionStarted(CHAT, onStart)
    })

    emitAgentEvent({ type: 'text_delta', text: 'hi' }, CHAT)

    expect(onStart).not.toHaveBeenCalled()
  })

  it('listens to nothing while there is no conversation', () => {
    renderHook(() => {
      useSessionStarted(null, vi.fn())
    })

    expect(octopus().chats.onEvent).not.toHaveBeenCalled()
  })

  it('stops listening once it is gone', () => {
    const onStart = vi.fn()
    const { unmount } = renderHook(() => {
      useSessionStarted(CHAT, onStart)
    })

    unmount()
    emitAgentEvent(STARTED, CHAT)

    expect(onStart).not.toHaveBeenCalled()
  })

  /*
   * Callers pass a fresh function on every render. The one called is the one
   * passed last, and the subscription is not given back and taken again for it.
   */
  it('calls the newest callback without subscribing again', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(
      ({ onStart }) => {
        useSessionStarted(CHAT, onStart)
      },
      { initialProps: { onStart: first } }
    )

    rerender({ onStart: second })
    emitAgentEvent(STARTED, CHAT)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
    expect(octopus().chats.onEvent).toHaveBeenCalledOnce()
  })
})
