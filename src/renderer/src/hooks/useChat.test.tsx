import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Chat } from '@core/chats.js'
import type { AgentEvent } from '@core/events.js'
import type { ChatEntry } from '@core/transcript.js'

import type { Failure, Result } from '../../../preload/index.js'
import { chat, emitAgentEvent, givenChat } from '../test/chat.js'
import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { useChat } from './useChat.js'

/** The English fallback is enough here; the mapping is `useErrorMessage`'s job. */
const describeFailure = (failure: Failure): string => failure.error

describe('without a workspace', () => {
  // The pane shows a placeholder instead, so nothing here is reachable through
  // the UI — but the hook is an API, and an API that misbehaves when handed a
  // null is one somebody will eventually hand a null.
  it('asks the bridge for nothing and does nothing when driven', async () => {
    const { result } = renderHook(() => useChat(null, describeFailure))

    expect(result.current.loading).toBe(false)
    expect(octopus().chats.list).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.send('hello')
      await result.current.interrupt()
      await result.current.setWorkingMode('acceptEdits')
      await result.current.setPlanMode(true)
    })

    expect(octopus().chats.open).not.toHaveBeenCalled()
    expect(octopus().chats.interrupt).not.toHaveBeenCalled()
    expect(octopus().chats.setWorkingMode).not.toHaveBeenCalled()
    expect(octopus().chats.setPlanMode).not.toHaveBeenCalled()
  })
})

describe('a conversation that is already waiting on an answer', () => {
  const request = { requestId: 'r-1', toolName: 'ExitPlanMode', input: { plan: 'a plan' } }

  /*
   * Seen for real: a plan waited half an hour.
   *
   * `permission_request` goes out once. A window that was not listening then —
   * opened afterwards, or switched to another workspace and back, which clears
   * what it was holding — showed a conversation stuck on "working" while the
   * one answer it needed was one nobody could give.
   */
  it('finds out what the agent is blocked on when the chat is opened', async () => {
    givenChat()
    vi.mocked(octopus().chats.pendingPermission).mockResolvedValue({ ok: true, value: request })

    const { result } = renderHook(() => useChat('planner/anna', describeFailure))

    await waitFor(() => {
      expect(result.current.pending).toEqual(request)
    })
    // And it says so, rather than offering a composer for a turn in flight.
    expect(result.current.busy).toBe(true)
  })

  it('stays as it was when nothing is blocked', async () => {
    givenChat()

    const { result } = renderHook(() => useChat('planner/anna', describeFailure))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.pending).toBeNull()
    expect(result.current.busy).toBe(false)
  })

  // The worst case is the state we were already in, and an error banner over a
  // conversation that opened perfectly well would be worse than that.
  it('says nothing when the question cannot be asked for', async () => {
    givenChat()
    vi.mocked(octopus().chats.pendingPermission).mockResolvedValue({
      ok: false,
      error: 'no such chat'
    })

    const { result } = renderHook(() => useChat('planner/anna', describeFailure))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.pending).toBeNull()
    expect(result.current.error).toBeNull()
  })
})

describe('a load that outlives the hook', () => {
  // Switching workspace quickly, or closing the pane mid-read. Applying the
  // answer then would set state on something that is gone.
  it('is dropped when the chat lookup comes back too late', async () => {
    const lookup = held<Result<Chat[]>>()
    vi.mocked(octopus().chats.list).mockReturnValue(lookup.promise)

    const { unmount } = renderHook(() => useChat('planner/anna', describeFailure))
    unmount()

    await act(async () => {
      lookup.resolve({ ok: true, value: [chat()] })
      await lookup.promise
    })

    expect(octopus().chats.history).not.toHaveBeenCalled()
  })

  it('is dropped when the history comes back too late', async () => {
    vi.mocked(octopus().chats.list).mockResolvedValue({ ok: true, value: [chat()] })

    const history = held<Result<ChatEntry[]>>()
    vi.mocked(octopus().chats.history).mockReturnValue(history.promise)

    const { result, unmount } = renderHook(() => useChat('planner/anna', describeFailure))
    await waitFor(() => {
      expect(octopus().chats.history).toHaveBeenCalled()
    })

    unmount()

    await act(async () => {
      history.resolve({
        ok: true,
        value: [{ role: 'user', at: '2026-08-11T09:00:00.000Z', text: 'too late' }]
      })
      await history.promise
    })

    expect(result.current.entries).toEqual([])
  })
})

describe('a reading that belongs to the account rather than the conversation', () => {
  const READING: AgentEvent = {
    type: 'rate_limit',
    status: 'allowed_warning',
    window: 'seven_day',
    utilization: 84,
    resetsAt: null
  }

  /*
   * It arrives mid-turn, on the same stream as everything else, and used to
   * fall through to "the block being streamed has finished". So the answer
   * being written vanished until the finished block arrived, and the log gained
   * an entry that draws nothing — which breaks a run of tool calls into two
   * folds with an invisible gap between them.
   *
   * The attic shows it, from `useRateLimit`. The log has no business with it.
   */
  it('leaves the answer being written and the log alone', async () => {
    givenChat()
    const { result } = renderHook(() => useChat('planner/anna', describeFailure))
    await waitFor(() => {
      expect(result.current.chat).not.toBeNull()
    })

    emitAgentEvent({ type: 'text_delta', text: 'Look' })
    emitAgentEvent(READING)

    expect(result.current.streaming.text).toBe('Look')
    expect(result.current.entries).toEqual([])
  })
})
