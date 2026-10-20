import { type RefObject, useCallback, useState } from 'react'

import { placedMarkers } from './markers.js'

type StepDirection = 'up' | 'down'

/**
 * Where a stepped-to message lands below the scroller's top: under the floating
 * row (`top-2` 8px + `size-7` 28px) with 8px to spare.
 */
export const STEP_MARGIN = 44

/** A message just stepped to sits on the line give or take a sub-pixel; the next press must move past it. */
const SLACK = 4

/**
 * Where the message one step from `line` sits, or null. `tops` are in document
 * order; up is the last above the line, down the first below it.
 */
export function messageStep(
  tops: readonly number[],
  line: number,
  direction: StepDirection
): number | null {
  const target =
    direction === 'up'
      ? tops.findLast((top) => top < line - SLACK)
      : tops.find((top) => top > line + SLACK)
  return target ?? null
}

/**
 * Steps through the user's own messages in a scrolled log.
 *
 * Instant, as the jump to the end is: a smooth scroll would leave the next
 * press measuring from the middle of the animation.
 */
export function useMessageSteps(scroller: RefObject<HTMLElement | null>): {
  canUp: boolean
  canDown: boolean
  update: () => void
  step: (direction: StepDirection) => void
} {
  // Two booleans rather than one object, so that a scroll which crosses no end
  // sets the same values and React skips the render.
  const [canUp, setCanUp] = useState(false)
  const [canDown, setCanDown] = useState(false)

  const read = useCallback(() => {
    const element = scroller.current
    if (!element) return null

    return {
      element,
      line: element.getBoundingClientRect().top + STEP_MARGIN,
      tops: placedMarkers(element, '[data-user-message]').map(({ top }) => top)
    }
  }, [scroller])

  const update = useCallback(() => {
    const geometry = read()
    if (geometry === null) return

    const { element, line, tops } = geometry
    // The scroller stops at either end before the first or last messages can
    // reach the line, and a button that then does nothing is a broken one.
    const atStart = element.scrollTop < 1
    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 1
    setCanUp(!atStart && messageStep(tops, line, 'up') !== null)
    setCanDown(!atEnd && messageStep(tops, line, 'down') !== null)
  }, [read])

  const step = useCallback(
    (direction: StepDirection) => {
      const geometry = read()
      if (geometry === null) return

      const { element, line, tops } = geometry
      const target = messageStep(tops, line, direction)
      if (target !== null) element.scrollTop += target - line
    },
    [read]
  )

  return { canUp, canDown, update, step }
}
