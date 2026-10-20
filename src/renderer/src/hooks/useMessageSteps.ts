import { type RefObject, useCallback, useState } from 'react'

import { placedMarkers } from './markers.js'

export type StepDirection = 'up' | 'down'

/**
 * How far below the scroller's top edge a stepped-to message lands: clear of
 * the floating row of buttons and the day chip, which would otherwise sit over
 * its first line.
 */
export const STEP_MARGIN = 44

/*
 * A message that has just been stepped to sits on the line give or take a
 * sub-pixel, and the next press has to move on from it rather than land on it
 * again.
 */
const SLACK = 4

/**
 * Where the message one step away from `line` sits, or null when there is none.
 *
 * `tops` are in document order. Up is the last message above the line, down
 * the first below it — so from the middle of a long answer, up is the message
 * that asked for it and down the one that followed.
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

  const measure = useCallback(() => {
    const element = scroller.current
    if (!element) return null

    return {
      element,
      line: element.getBoundingClientRect().top + STEP_MARGIN,
      tops: placedMarkers(element, '[data-user-message]').map(({ top }) => top)
    }
  }, [scroller])

  const update = useCallback(() => {
    const measured = measure()
    if (measured === null) return

    const { element, line, tops } = measured
    // The last messages of a log can never reach the line: the scroller stops
    // at its end first, and a button that then does nothing is a broken one.
    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 1
    setCanUp(messageStep(tops, line, 'up') !== null)
    setCanDown(!atEnd && messageStep(tops, line, 'down') !== null)
  }, [measure])

  const step = useCallback(
    (direction: StepDirection) => {
      const measured = measure()
      // The buttons live inside the scroller, so they cannot be pressed
      // without one; the guard is for the type.
      /* v8 ignore next */
      if (measured === null) return

      const { element, line, tops } = measured
      const target = messageStep(tops, line, direction)
      if (target !== null) element.scrollTop += target - line
    },
    [measure]
  )

  return { canUp, canDown, update, step }
}
