type Wheel = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'shiftKey' | 'ctrlKey'>

/** How far a wheel moves the columns sideways; null leaves it to the browser. */
export function sidewaysDelta(wheel: Wheel, target: EventTarget | null): number | null {
  // Chromium turns a shifted wheel sideways itself, a trackpad swipe already is, and a pinch
  // arrives as a wheel with Ctrl held.
  if (wheel.shiftKey || wheel.ctrlKey) return null
  if (Math.abs(wheel.deltaX) >= Math.abs(wheel.deltaY)) return null
  const list = target instanceof Element ? target.closest('ul') : null
  if (list !== null && list.scrollHeight > list.clientHeight) return null
  return wheel.deltaY
}
