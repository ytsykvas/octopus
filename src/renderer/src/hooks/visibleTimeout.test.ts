import { afterEach, describe, expect, it, vi } from 'vitest'

import { setVisibleTimeout } from './visibleTimeout.js'

function hide(): { show: () => void } {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  document.dispatchEvent(new Event('visibilitychange'))

  return {
    show: () => {
      hidden.mockReturnValue(false)
      document.dispatchEvent(new Event('visibilitychange'))
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('setVisibleTimeout', () => {
  it('runs when it falls due in a window that is seen', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    setVisibleTimeout(run, 300)

    vi.advanceTimersByTime(299)
    expect(run).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('waits out a hidden window, and runs once when it is shown', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const away = hide()
    setVisibleTimeout(run, 300)

    vi.advanceTimersByTime(60_000)
    // A change that leaves it hidden is not a return.
    document.dispatchEvent(new Event('visibilitychange'))
    expect(run).not.toHaveBeenCalled()

    away.show()
    expect(run).toHaveBeenCalledTimes(1)

    // Shown again later, it has already run.
    document.dispatchEvent(new Event('visibilitychange'))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not run once cancelled, before it falls due', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const cancel = setVisibleTimeout(run, 300)

    cancel()
    vi.advanceTimersByTime(300)

    expect(run).not.toHaveBeenCalled()
  })

  it('does not run once cancelled while it waits for the window', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const away = hide()
    const cancel = setVisibleTimeout(run, 300)
    vi.advanceTimersByTime(300)

    cancel()
    away.show()

    expect(run).not.toHaveBeenCalled()
  })

  it('runs in a window shown again before it falls due', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const away = hide()
    setVisibleTimeout(run, 300)

    away.show()
    expect(run).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
