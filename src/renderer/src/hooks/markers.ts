/** A marker in the log and where it sits on screen right now. */
export interface PlacedMarker {
  readonly element: HTMLElement
  readonly top: number
}

/**
 * The scroller's markers, in document order, with their current tops.
 *
 * Read on demand rather than observed — the floating day and the message steps
 * both measure only when asked: a few rectangles per scroll, and nothing the
 * test environment lacks.
 */
export function placedMarkers(scroller: HTMLElement, selector: string): PlacedMarker[] {
  return [...scroller.querySelectorAll<HTMLElement>(selector)].map((element) => ({
    element,
    top: element.getBoundingClientRect().top
  }))
}
