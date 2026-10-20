import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ResourceReading } from '@core/resources.js'

import { octopus } from '../test/octopus.js'
import { failOnUpdatesOutsideAct } from '../test/updatesOutsideAct.js'
import { RESOURCES_INTERVAL_MS, useResources } from './useResources.js'

failOnUpdatesOutsideAct()

const reading = (cpu: number): ResourceReading => ({
  total: { cpu, memory: 1024 },
  app: { cpu, memory: 1024 },
  parts: []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('what the machine is paying', () => {
  it('reads at once, then every ten seconds', async () => {
    vi.useFakeTimers()
    vi.mocked(octopus().resources.read).mockResolvedValue({ ok: true, value: reading(12) })

    const { result } = renderHook(() => useResources(true))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current?.total.cpu).toBe(12)

    vi.mocked(octopus().resources.read).mockResolvedValue({ ok: true, value: reading(30) })
    await act(() => vi.advanceTimersByTimeAsync(RESOURCES_INTERVAL_MS))

    expect(result.current?.total.cpu).toBe(30)
    expect(octopus().resources.read).toHaveBeenCalledTimes(2)
  })

  // A figure ten seconds old says more than none.
  it('keeps the last reading when one fails', async () => {
    vi.useFakeTimers()
    vi.mocked(octopus().resources.read).mockResolvedValue({ ok: true, value: reading(12) })
    const { result } = renderHook(() => useResources(true))
    await act(() => vi.advanceTimersByTimeAsync(0))

    vi.mocked(octopus().resources.read).mockResolvedValue({
      ok: false,
      error: 'ps: not found',
      code: 'unknown'
    })
    await act(() => vi.advanceTimersByTimeAsync(RESOURCES_INTERVAL_MS))

    expect(result.current?.total.cpu).toBe(12)
  })

  // Folded away, the bar shows nothing — so nothing is run to fill it.
  it('reads nothing while the bar is folded', async () => {
    vi.useFakeTimers()
    renderHook(() => useResources(false))

    await act(() => vi.advanceTimersByTimeAsync(RESOURCES_INTERVAL_MS * 3))

    expect(octopus().resources.read).not.toHaveBeenCalled()
  })

  // A minimised window is a hidden document; the `ps` behind the figure stops.
  it('stops while the window is hidden and reads again on the way back', async () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useResources(true))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(octopus().resources.read).toHaveBeenCalledTimes(1)

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(() => vi.advanceTimersByTimeAsync(RESOURCES_INTERVAL_MS * 3))
    expect(octopus().resources.read).toHaveBeenCalledTimes(1)

    hidden.mockReturnValue(false)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(octopus().resources.read).toHaveBeenCalledTimes(2)

    hidden.mockRestore()
    unmount()
  })

  it('stops reading once it is gone', async () => {
    const { unmount } = renderHook(() => useResources(true))
    await waitFor(() => {
      expect(octopus().resources.read).toHaveBeenCalledOnce()
    })
    unmount()

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(octopus().resources.read).toHaveBeenCalledOnce()
  })
})
