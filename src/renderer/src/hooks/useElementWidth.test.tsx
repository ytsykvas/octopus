import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useElementWidth } from './useElementWidth.js'

let report: ResizeObserverCallback = () => undefined
const stopped = vi.fn()

function stubObserver(): void {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        report = callback
      }
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = stopped
    }
  )
}

function laidOut(width: number): void {
  act(() => {
    report([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  stopped.mockClear()
})

describe('useElementWidth', () => {
  it('knows no width before there is an element', () => {
    const { result } = renderHook(() => useElementWidth(null))

    expect(result.current).toBeNull()
  })

  it('follows the width the element is laid out at', () => {
    stubObserver()
    const element = document.createElement('div')
    const { result } = renderHook(() => useElementWidth(element))

    laidOut(900)
    expect(result.current).toBe(900)
    laidOut(1300)
    expect(result.current).toBe(1300)
  })

  it('keeps the last width while the element is hidden', () => {
    stubObserver()
    const element = document.createElement('div')
    const { result } = renderHook(() => useElementWidth(element))

    laidOut(900)
    laidOut(0)

    expect(result.current).toBe(900)
  })

  it('stops watching once it is gone', () => {
    stubObserver()
    const element = document.createElement('div')
    const { unmount } = renderHook(() => useElementWidth(element))

    unmount()

    expect(stopped).toHaveBeenCalled()
  })
})
