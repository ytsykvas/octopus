import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { messageStep, STEP_MARGIN, useMessageSteps } from './useMessageSteps.js'

describe('the message one step away', () => {
  const tops = [-400, -20, 300]

  it('is the last message above the line going up, the first below it going down', () => {
    expect(messageStep(tops, 0, 'up')).toBe(-20)
    expect(messageStep(tops, 0, 'down')).toBe(300)
  })

  it('moves on from a message sitting on the line', () => {
    expect(messageStep(tops, -18.5, 'up')).toBe(-400)
    expect(messageStep(tops, -21.5, 'down')).toBe(300)
  })

  it('is nothing past either end', () => {
    expect(messageStep(tops, -500, 'up')).toBeNull()
    expect(messageStep(tops, 400, 'down')).toBeNull()
    expect(messageStep([], 0, 'up')).toBeNull()
  })
})

describe('stepping through the log', () => {
  /** A 300px scroller over a 2000px log, scrolled to `at`, holding messages at the given tops. */
  function scrollerWith(tops: readonly number[], at = 1000): HTMLElement {
    const scroller = document.createElement('div')
    scroller.scrollTop = at
    scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
    Object.defineProperty(scroller, 'clientHeight', { value: 300 })
    Object.defineProperty(scroller, 'scrollHeight', { value: 2000 })

    for (const top of tops) {
      const message = document.createElement('div')
      message.dataset.userMessage = ''
      message.getBoundingClientRect = () => ({ top }) as DOMRect
      scroller.append(message)
    }

    return scroller
  }

  it('reads which way there is somewhere to go when asked', () => {
    const ref = { current: scrollerWith([-200, 500]) }
    const { result } = renderHook(() => useMessageSteps(ref))

    expect(result.current.canUp).toBe(false)
    act(() => {
      result.current.update()
    })

    expect(result.current.canUp).toBe(true)
    expect(result.current.canDown).toBe(true)
  })

  it('offers neither step at the ends of the log, where no message can reach the line', () => {
    const top = { current: scrollerWith([-200, 500], 0) }
    const end = { current: scrollerWith([-200, 500], 1700) }
    const atTop = renderHook(() => useMessageSteps(top)).result
    const atEnd = renderHook(() => useMessageSteps(end)).result

    act(() => {
      atTop.current.update()
      atEnd.current.update()
    })

    expect(atTop.current).toMatchObject({ canUp: false, canDown: true })
    expect(atEnd.current).toMatchObject({ canUp: true, canDown: false })
  })

  it('brings the message to the line under the floating row', () => {
    const ref = { current: scrollerWith([-200, 500]) }
    const { result } = renderHook(() => useMessageSteps(ref))

    act(() => {
      result.current.step('down')
    })

    expect(ref.current.scrollTop).toBe(1000 + 500 - STEP_MARGIN)
  })

  it('stays put with nowhere to go', () => {
    const ref = { current: scrollerWith([500]) }
    const { result } = renderHook(() => useMessageSteps(ref))

    act(() => {
      result.current.step('up')
    })

    expect(ref.current.scrollTop).toBe(1000)
  })

  it('offers nothing while there is no scroller', () => {
    const { result } = renderHook(() => useMessageSteps({ current: null }))

    act(() => {
      result.current.update()
      result.current.step('up')
    })

    expect(result.current.canUp).toBe(false)
    expect(result.current.canDown).toBe(false)
  })
})
