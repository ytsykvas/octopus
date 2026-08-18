import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { octopus } from '../test/octopus.js'
import { useServingPort } from './useServingPort.js'

/** Long enough for every attempt the hook makes, driven rather than waited for. */
const PAST_EVERY_ATTEMPT = 6_000

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/** Runs the probes to their end without sitting through the intervals. */
async function exhaust(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PAST_EVERY_ATTEMPT)
  })
}

describe('useServingPort', () => {
  it('says nothing about a workspace that is not serving', () => {
    const { result } = renderHook(() => useServingPort(null))

    expect(result.current).toBe(false)
    expect(octopus().workspaces.serving).not.toHaveBeenCalled()
  })

  // The port answered, so there is nothing to say and nothing left to ask.
  it('stops asking once the port answers', async () => {
    const { result } = renderHook(() => useServingPort('planner/anna'))
    await exhaust()

    expect(result.current).toBe(false)
    expect(octopus().workspaces.serving).toHaveBeenCalledTimes(1)
  })

  /*
   * The case this exists for: octopus assigned the port, the script bound its
   * framework's own, and the link the pane offers opens on nothing.
   */
  it('says so once every attempt has come back silent', async () => {
    vi.mocked(octopus().workspaces.serving).mockResolvedValue({ ok: true, value: false })

    const { result } = renderHook(() => useServingPort('planner/anna'))
    await exhaust()

    expect(result.current).toBe(true)
    expect(octopus().workspaces.serving).toHaveBeenCalledTimes(5)
  })

  // A dev server takes a moment to bind, and one refusal is not an answer.
  it('does not call a slow start a mistake', async () => {
    vi.mocked(octopus().workspaces.serving).mockResolvedValue({ ok: true, value: false })

    const { result } = renderHook(() => useServingPort('planner/anna'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(result.current).toBe(false)
  })

  // A failed read is not an empty port: it goes back round like a refusal, and
  // only the count of attempts decides.
  it('treats a read it could not make as no answer', async () => {
    vi.mocked(octopus().workspaces.serving).mockResolvedValue({ ok: false, error: 'gone' })

    const { result } = renderHook(() => useServingPort('planner/anna'))
    await exhaust()

    expect(result.current).toBe(true)
  })

  // The workspace stopped serving while a probe was in flight; its answer is
  // about a question nobody is asking any more.
  it('drops an answer that arrives after it stopped asking', async () => {
    vi.mocked(octopus().workspaces.serving).mockResolvedValue({ ok: true, value: false })

    const { result, rerender } = renderHook<boolean, { id: string | null }>(
      ({ id }) => useServingPort(id),
      { initialProps: { id: 'planner/anna' } }
    )

    rerender({ id: null })
    await exhaust()

    expect(result.current).toBe(false)
  })

  // Each workspace answers for itself: the last one's silence is not this
  // one's, and a frame of it would be a warning about the wrong port.
  it('starts over when the workspace changes', async () => {
    vi.mocked(octopus().workspaces.serving).mockResolvedValue({ ok: true, value: false })

    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useServingPort(id), {
      initialProps: { id: 'planner/anna' }
    })
    await exhaust()
    expect(result.current).toBe(true)

    rerender({ id: 'planner/bob' })
    expect(result.current).toBe(false)
  })

  it('gives up asking when it goes away mid-flight', async () => {
    vi.mocked(octopus().workspaces.serving).mockResolvedValue({ ok: true, value: false })

    const { unmount } = renderHook(() => useServingPort('planner/anna'))
    unmount()
    await exhaust()

    // The one already in flight when it went; nothing scheduled after it.
    expect(octopus().workspaces.serving).toHaveBeenCalledTimes(1)
  })
})
