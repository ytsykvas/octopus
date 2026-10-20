/** The scroller's `selector` marks in document order, with their tops on screen now. */
export function placedMarkers(
  scroller: HTMLElement,
  selector: string
): { readonly element: HTMLElement; readonly top: number }[] {
  return [...scroller.querySelectorAll<HTMLElement>(selector)].map((element) => ({
    element,
    top: element.getBoundingClientRect().top
  }))
}
