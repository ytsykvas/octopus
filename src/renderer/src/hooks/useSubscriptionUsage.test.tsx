import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { UsageWindows } from '@core/usage.js'

import { octopus } from '../test/octopus.js'
import { useSubscriptionUsage } from './useSubscriptionUsage.js'

const READING: UsageWindows = {
  limits: [
    {
      key: 'five_hour',
      label: null,
      utilization: 31,
      resetsAt: '2026-08-11T19:50:00.000Z',
      severity: null,
      binding: false
    },
    {
      key: 'seven_day',
      label: null,
      utilization: 84,
      resetsAt: '2026-08-14T04:00:00.000Z',
      severity: null,
      binding: false
    }
  ],
  limitsApply: true,
  readAt: '2026-08-11T16:00:00.000Z'
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
      value: { kind: 'read', windows: READING }
    })
    const { result } = renderHook(() => useSubscriptionUsage())

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.usage).toEqual(READING)
    expect(result.current.busy).toBe(false)
  })

  /*
   * The four things the block has to say when it has no figures, each from the
   * service rather than inferred. A boolean stood here and got two of them
   * wrong: a failed read cleared it and redrew stale figures as fresh, and an
   * account with no plan was told to open a workspace.
   */
  it.each([
    { kind: 'nowhereToAsk' as const },
    { kind: 'noPlan' as const },
    { kind: 'failed' as const }
  ])('carries the outcome $kind through as it came', async (value) => {
    vi.mocked(octopus().chats.refreshSubscription).mockResolvedValue({ ok: true, value })
    const { result } = renderHook(() => useSubscriptionUsage())

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.outcome).toBe(value.kind)
    expect(result.current.usage).toBeNull()
  })

  // The call itself failing is the same story as the read failing, and there is
  // no fifth thing for the block to say about it.
  it('says the read failed when the call itself did', async () => {
    vi.mocked(octopus().chats.refreshSubscription).mockResolvedValue({ ok: false, error: 'no' })
    const { result } = renderHook(() => useSubscriptionUsage())

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.outcome).toBe('failed')
  })

  it('has nothing to report before anything has been read', () => {
    const { result } = renderHook(() => useSubscriptionUsage())

    expect(result.current.outcome).toBe('unread')
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
    expect(result.current.outcome).toBe('failed')
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

  /*
   * Told rather than asked. This used to watch for a finished turn and then
   * read the service's *cache* — which the chat pane was filling on the same
   * event, one round trip later. The sidebar won that race never, and drew the
   * previous turn's figure every time.
   */
  it('takes the reading the service announces', async () => {
    const { result } = renderHook(() => useSubscriptionUsage())
    const [announce] = vi.mocked(octopus().chats.onUsageWindows).mock.calls.at(-1) ?? []
    if (!announce) throw new Error('the sidebar never subscribed')

    act(() => {
      announce(READING)
    })

    await waitFor(() => {
      expect(result.current.usage).toEqual(READING)
    })
  })

  /*
   * Whatever happened while the window was in the background announced itself
   * to nobody here, and the figure informs a decision taken the moment somebody
   * looks: whether to start something at all.
   */
  it('asks again when the window is looked at', async () => {
    renderHook(() => useSubscriptionUsage())
    await waitFor(() => {
      expect(octopus().chats.refreshSubscription).toHaveBeenCalledTimes(1)
    })

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => {
      expect(octopus().chats.refreshSubscription).toHaveBeenCalledTimes(2)
    })
  })

  // Nothing behind a hidden window is worth spawning a process for.
  it('asks nothing while the window is hidden, and asks on the way back', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    renderHook(() => useSubscriptionUsage())

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(octopus().chats.refreshSubscription).not.toHaveBeenCalled()

    hidden.mockReturnValue(false)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => {
      expect(octopus().chats.refreshSubscription).toHaveBeenCalledTimes(1)
    })
  })

  /*
   * For the window left open and watched. A read costs no tokens and, measured,
   * under a second — worth keeping roughly current, not worth asking about
   * every minute.
   */
  it('asks again on a slow timer while it is being looked at', async () => {
    vi.useFakeTimers()
    try {
      renderHook(() => useSubscriptionUsage())
      expect(octopus().chats.refreshSubscription).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(180_000)
      })
      expect(octopus().chats.refreshSubscription).toHaveBeenCalledTimes(2)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(180_000)
      })
      expect(octopus().chats.refreshSubscription).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  // A hook that unmounts without stopping its timer keeps asking about a block
  // that is gone.
  it('stops asking once the sidebar has gone', async () => {
    vi.useFakeTimers()
    try {
      const { unmount } = renderHook(() => useSubscriptionUsage())
      unmount()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(180_000 * 3)
      })

      expect(octopus().chats.refreshSubscription).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  // "Could not ask" and "nothing to report" are different statements, and
  // blanking the block would make the first look like the second.
  it('leaves the last figures standing when a later read fails', async () => {
    vi.mocked(octopus().chats.subscription).mockResolvedValue({ ok: true, value: READING })
    const { result } = renderHook(() => useSubscriptionUsage())
    await waitFor(() => {
      expect(result.current.usage).toEqual(READING)
    })

    vi.mocked(octopus().chats.refreshSubscription).mockResolvedValue({
      ok: true,
      value: { kind: 'failed' }
    })
    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.usage).toEqual(READING)
    expect(result.current.outcome).toBe('failed')
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
    let release: (value: { ok: true; value: UsageWindows | null }) => void = () => undefined
    const pending = new Promise<{ ok: true; value: UsageWindows | null }>((resolve) => {
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
