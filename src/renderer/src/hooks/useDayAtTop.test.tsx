import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { dayAtTop, useDayAtTop } from './useDayAtTop.js'

describe('the day the reader is in', () => {
  const markers = [
    { day: '2026-10-14', top: -400 },
    { day: '2026-10-15', top: -20 },
    { day: '2026-10-16', top: 300 }
  ]

  it('is the last day whose separator has scrolled above the edge', () => {
    expect(dayAtTop(markers, 0)).toBe('2026-10-15')
  })

  // Its own separator is in view, and a floating copy would say it twice.
  it('is nothing while no separator has scrolled past', () => {
    expect(dayAtTop(markers, -500)).toBeNull()
    expect(dayAtTop([], 0)).toBeNull()
  })

  // A separator sitting exactly on the edge is still in view.
  it('counts a separator on the edge as on screen', () => {
    expect(dayAtTop(markers, -20)).toBe('2026-10-14')
  })

  it('passes over a marker that carries no day', () => {
    expect(dayAtTop([...markers.slice(0, 1), { day: undefined, top: -10 }], 0)).toBe('2026-10-14')
  })
})

describe('the day to float over the log', () => {
  /** A scroller at `top`, holding separators at the given offsets. */
  function scrollerWith(top: number, days: readonly [string, number][]): HTMLElement {
    const scroller = document.createElement('div')
    scroller.getBoundingClientRect = () => ({ top }) as DOMRect

    for (const [day, at] of days) {
      const separator = document.createElement('div')
      separator.dataset.day = day
      separator.getBoundingClientRect = () => ({ top: at }) as DOMRect
      scroller.append(separator)
    }

    return scroller
  }

  it('reads the separators off the scroller when asked', () => {
    const ref = {
      current: scrollerWith(100, [
        ['2026-10-15', 40],
        ['2026-10-16', 500]
      ])
    }
    const { result } = renderHook(() => useDayAtTop(ref))

    expect(result.current.day).toBeNull()
    act(() => {
      result.current.update()
    })

    expect(result.current.day).toBe('2026-10-15')
  })

  // Before the log has been drawn there is nothing to measure.
  it('stays empty while there is no scroller', () => {
    const { result } = renderHook(() => useDayAtTop({ current: null }))

    act(() => {
      result.current.update()
    })

    expect(result.current.day).toBeNull()
  })
})
