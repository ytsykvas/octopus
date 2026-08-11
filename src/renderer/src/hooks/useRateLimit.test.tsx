import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { RateLimit } from '@core/service.js'

import { emitAgentEvent } from '../test/chat.js'
import { octopus } from '../test/octopus.js'
import { useRateLimit } from './useRateLimit.js'

const READING: RateLimit = {
  type: 'rate_limit',
  status: 'allowed',
  window: 'five_hour',
  utilization: 62,
  resetsAt: '2026-08-11T12:12:00.000Z'
}

describe('what the header knows', () => {
  it('is nothing until something reports it', () => {
    const { result } = renderHook(() => useRateLimit())

    expect(result.current).toBeNull()
  })

  // A window opened halfway through a working day should not sit blank until
  // the next turn happens to run.
  it('reads what the service already knew', async () => {
    vi.mocked(octopus().chats.rateLimit).mockResolvedValue({ ok: true, value: READING })

    const { result } = renderHook(() => useRateLimit())

    await waitFor(() => {
      expect(result.current).toEqual(READING)
    })
  })

  it('keeps up with what arrives afterwards', async () => {
    const { result } = renderHook(() => useRateLimit())

    emitAgentEvent(READING)

    await waitFor(() => {
      expect(result.current).toEqual(READING)
    })
  })

  // The figure belongs to the account, and any chat reports the same one.
  it('takes a reading from a chat other than the one on screen', async () => {
    const { result } = renderHook(() => useRateLimit())

    emitAgentEvent(READING, 'some-other-chat')

    await waitFor(() => {
      expect(result.current).not.toBeNull()
    })
  })

  it('ignores the rest of the conversation', async () => {
    const { result } = renderHook(() => useRateLimit())

    emitAgentEvent({ type: 'text', text: 'Looking at auth.rb' })

    await waitFor(() => {
      expect(result.current).toBeNull()
    })
  })

  // The first read is a round trip; an event that lands while it is in flight
  // is the newer of the two and must not be overwritten by what was on the way.
  it('does not let a stale first read overwrite a live one', async () => {
    let release: (value: { ok: true; value: RateLimit | null }) => void = () => undefined
    vi.mocked(octopus().chats.rateLimit).mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )

    const { result } = renderHook(() => useRateLimit())

    const fresher: RateLimit = { ...READING, utilization: 71 }
    emitAgentEvent(fresher)

    release({ ok: true, value: READING })

    await waitFor(() => {
      expect(result.current).toEqual(fresher)
    })
  })

  // Closing the window mid-read. Applying the answer then would set state on
  // something that is gone.
  it('drops a first read that comes back after the header went away', async () => {
    let release: (value: { ok: true; value: RateLimit | null }) => void = () => undefined
    const pending = new Promise<{ ok: true; value: RateLimit | null }>((resolve) => {
      release = resolve
    })
    vi.mocked(octopus().chats.rateLimit).mockReturnValue(pending)

    const { result, unmount } = renderHook(() => useRateLimit())
    unmount()

    release({ ok: true, value: READING })
    await pending

    expect(result.current).toBeNull()
  })

  it('says nothing when the first read fails', async () => {
    vi.mocked(octopus().chats.rateLimit).mockResolvedValue({ ok: false, error: 'no service' })

    const { result } = renderHook(() => useRateLimit())

    await waitFor(() => {
      expect(octopus().chats.rateLimit).toHaveBeenCalled()
    })
    expect(result.current).toBeNull()
  })
})
