import { type RefObject, useCallback, useState } from 'react'

/** Where a day separator sits, as `useDayAtTop` reads it off the page. */
export interface DayMarker {
  /** The separator's `data-day`; absent only on an element that is not one. */
  readonly day: string | undefined
  readonly top: number
}

/**
 * The day the reader is in, or null while the day's own separator is still in
 * view.
 *
 * That is the last separator to have scrolled above the top edge: everything
 * between it and the next one belongs to its day. Null rather than the first
 * day when nothing has scrolled past, because then the separator itself is on
 * screen, and a floating copy over it would say the same thing twice.
 */
export function dayAtTop(markers: readonly DayMarker[], viewportTop: number): string | null {
  let current: string | null = null

  for (const marker of markers) {
    if (marker.top >= viewportTop) break
    if (marker.day !== undefined) current = marker.day
  }

  return current
}

/**
 * The day to float over a scrolled log, as a messenger does.
 *
 * Measured rather than observed: the separators are read off the scroller each
 * time `update` is called — from its scroll handler and when the log changes —
 * which is a few rectangles per scroll and needs nothing the test environment
 * lacks. A sticky separator could not do this on its own: each one sits inside
 * the message that opens its day, and sticky positioning never leaves its
 * parent.
 */
export function useDayAtTop(scroller: RefObject<HTMLElement | null>): {
  day: string | null
  update: () => void
} {
  const [day, setDay] = useState<string | null>(null)

  const update = useCallback(() => {
    const element = scroller.current
    if (!element) return

    const markers = [...element.querySelectorAll<HTMLElement>('[data-day]')].map((marker) => ({
      day: marker.dataset.day,
      top: marker.getBoundingClientRect().top
    }))
    setDay(dayAtTop(markers, element.getBoundingClientRect().top))
  }, [scroller])

  return { day, update }
}
