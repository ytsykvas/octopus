import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { COPY_SETTLE_MS, useCopy } from './useCopy.js'

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('copying with something to say about it', () => {
  it('writes the text, says it did, and goes quiet again', async () => {
    const { result } = renderHook(() => useCopy())
    expect(result.current.state).toBe('idle')

    await act(async () => {
      await result.current.copy('src/a.ts')
    })

    expect(writeText).toHaveBeenCalledExactlyOnceWith('src/a.ts')
    expect(result.current.state).toBe('done')

    act(() => {
      vi.advanceTimersByTime(COPY_SETTLE_MS - 1)
    })
    expect(result.current.state).toBe('done')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.state).toBe('idle')
  })

  it('says so when the clipboard refused', async () => {
    writeText.mockRejectedValue(new Error('not focused'))
    const { result } = renderHook(() => useCopy())

    await act(async () => {
      await result.current.copy('src/a.ts')
    })

    expect(result.current.state).toBe('failed')
  })

  it('leaves no timer behind once the control is gone', async () => {
    const { result, unmount } = renderHook(() => useCopy())
    await act(async () => {
      await result.current.copy('src/a.ts')
    })

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
