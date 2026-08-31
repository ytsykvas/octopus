import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { SubscriptionUsage } from '@core/agent.js'

import { emitAgentEvent } from '../test/chat.js'
import { octopus } from '../test/octopus.js'
import { useSubscriptionUsage } from './useSubscriptionUsage.js'

const READING: SubscriptionUsage = {
  fiveHour: { utilization: 31, resetsAt: '2026-08-11T19:50:00.000Z' },
  sevenDay: { utilization: 84, resetsAt: '2026-08-14T04:00:00.000Z' }
}

/** A turn ending, which is the one moment the figures can have moved. */
function emitTurnEnd(): void {
  emitAgentEvent({
    type: 'result',
    ok: true,
    costUsd: 0,
    durationMs: 1,
    inputTokens: 0,
    outputTokens: 0,
    terminalReason: 'completed'
  })
}

describe('what the sidebar knows about the account', () => {
  it('is nothing until something has reported it', () => {
    const { result } = renderHook(() => useSubscriptionUsage())

    expect(result.current.usage).toBeNull()
  })

  /*
   * The press. Nothing fills the block on its own — answering costs a session,
   * and the service refuses to spawn one for a gauge nobody requested.
   *
   * That it says so *while* it is asking is asserted where it can be seen:
   * `SubscriptionLimits.test` checks the control is disabled mid-read, which is
   * the behaviour, rather than the flag behind it.
   */
  it('reads the account when asked to', async () => {
    vi.mocked(octopus().chats.refreshSubscription).mockResolvedValue({
      ok: true,
      value: READING
    })
    const { result } = renderHook(() => useSubscriptionUsage())

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.usage).toEqual(READING)
    expect(result.current.busy).toBe(false)
  })

  // A session runs in a worktree, so an installation with no conversation has
  // nowhere to start one — and no amount of waiting fixes that.
  it('says when there was nowhere to ask', async () => {
    vi.mocked(octopus().chats.refreshSubscription).mockResolvedValue({ ok: true, value: null })
    const { result } = renderHook(() => useSubscriptionUsage())

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.unavailable).toBe(true)
    expect(result.current.usage).toBeNull()
  })

  it('leaves the figures alone when the read is refused', async () => {
    vi.mocked(octopus().chats.subscription).mockResolvedValue({ ok: true, value: READING })
    const { result } = renderHook(() => useSubscriptionUsage())
    await waitFor(() => {
      expect(result.current.usage).toEqual(READING)
    })

    vi.mocked(octopus().chats.refreshSubscription).mockResolvedValue({
      ok: false,
      error: 'no service'
    })
    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.usage).toEqual(READING)
    expect(result.current.unavailable).toBe(false)
  })

  /*
   * The whole point of the change. The service keeps the last reading in the
   * state file, so a window opened on a fresh launch draws the figures without
   * anybody sending a message first — which is what the strip this replaced
   * could never do.
   */
  it('reads what the service already knew, with no turn having run', async () => {
    vi.mocked(octopus().chats.subscription).mockResolvedValue({ ok: true, value: READING })

    const { result } = renderHook(() => useSubscriptionUsage())

    await waitFor(() => {
      expect(result.current.usage).toEqual(READING)
    })
  })

  // Pulled rather than pushed: the agent answers a control request and does not
  // announce these, so a turn ending is the cue to ask again.
  it('asks again when a turn ends', async () => {
    const { result } = renderHook(() => useSubscriptionUsage())
    await waitFor(() => {
      expect(octopus().chats.subscription).toHaveBeenCalledTimes(1)
    })

    vi.mocked(octopus().chats.subscription).mockResolvedValue({ ok: true, value: READING })
    emitTurnEnd()

    await waitFor(() => {
      expect(result.current.usage).toEqual(READING)
    })
  })

  it('ignores the rest of the conversation', async () => {
    const { result } = renderHook(() => useSubscriptionUsage())
    await waitFor(() => {
      expect(octopus().chats.subscription).toHaveBeenCalledTimes(1)
    })

    emitAgentEvent({ type: 'text', text: 'Looking at auth.rb' })

    await waitFor(() => {
      expect(result.current.usage).toBeNull()
    })
    expect(octopus().chats.subscription).toHaveBeenCalledTimes(1)
  })

  // The figures belong to the account, so whichever conversation ran is the
  // one that learned them.
  it('takes a reading after a turn in a chat other than the one on screen', async () => {
    vi.mocked(octopus().chats.subscription).mockResolvedValue({ ok: true, value: READING })

    const { result } = renderHook(() => useSubscriptionUsage())
    emitAgentEvent(
      {
        type: 'result',
        ok: true,
        costUsd: 0,
        durationMs: 1,
        inputTokens: 0,
        outputTokens: 0,
        terminalReason: 'completed'
      },
      'some-other-chat'
    )

    await waitFor(() => {
      expect(result.current.usage).toEqual(READING)
    })
  })

  // "Could not ask" and "nothing to report" are different statements, and
  // blanking the block would make the first look like the second.
  it('leaves the last figures standing when a read fails', async () => {
    vi.mocked(octopus().chats.subscription).mockResolvedValue({ ok: true, value: READING })
    const { result } = renderHook(() => useSubscriptionUsage())
    await waitFor(() => {
      expect(result.current.usage).toEqual(READING)
    })

    vi.mocked(octopus().chats.subscription).mockResolvedValue({ ok: false, error: 'no service' })
    emitTurnEnd()

    await waitFor(() => {
      expect(octopus().chats.subscription).toHaveBeenCalledTimes(2)
    })
    expect(result.current.usage).toEqual(READING)
  })

  it('says nothing when the first read fails', async () => {
    vi.mocked(octopus().chats.subscription).mockResolvedValue({ ok: false, error: 'no service' })

    const { result } = renderHook(() => useSubscriptionUsage())

    await waitFor(() => {
      expect(octopus().chats.subscription).toHaveBeenCalled()
    })
    expect(result.current.usage).toBeNull()
  })

  // Closing the window mid-read. Applying the answer then would set state on
  // something that is gone.
  it('drops a read that comes back after the sidebar went away', async () => {
    let release: (value: { ok: true; value: SubscriptionUsage | null }) => void = () => undefined
    const pending = new Promise<{ ok: true; value: SubscriptionUsage | null }>((resolve) => {
      release = resolve
    })
    vi.mocked(octopus().chats.subscription).mockReturnValue(pending)

    const { result, unmount } = renderHook(() => useSubscriptionUsage())
    unmount()

    release({ ok: true, value: READING })
    await pending

    expect(result.current.usage).toBeNull()
  })
})
