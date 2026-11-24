export interface Wheel {
  readonly deltaX: number
  readonly deltaY: number
  readonly shiftKey: boolean
}

/** How far a wheel moves the columns sideways; null leaves it to the browser. */
export function sidewaysDelta(wheel: Wheel, target: Element): number | null {
  // Chromium turns a shifted wheel sideways itself, and a trackpad swipe already is.
  if (wheel.shiftKey || Math.abs(wheel.deltaX) >= Math.abs(wheel.deltaY)) return null
  const list = target.closest('ul')
  if (list !== null && list.scrollHeight > list.clientHeight) return null
  return wheel.deltaY
}
