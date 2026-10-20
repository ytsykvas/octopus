import { useState } from 'react'

import type { ResourceReading } from '@core/resources.js'

import { useVisibleInterval } from './useVisibleInterval.js'

/**
 * How often the machine is asked what octopus costs it.
 *
 * Ten seconds: often enough that a dev server running away shows within a
 * glance or two, rare enough that the `ps` behind it costs nothing anybody
 * would notice. Nothing is asked while the window is hidden or the bar folded.
 */
export const RESOURCES_INTERVAL_MS = 10_000

/**
 * The application's processes and what they cost, while `active`.
 *
 * Null until the first reading lands. A failed read keeps the last one rather
 * than blanking it: a figure ten seconds old says more than none.
 */
export function useResources(active: boolean): ResourceReading | null {
  const [reading, setReading] = useState<ResourceReading | null>(null)

  useVisibleInterval(
    () => {
      void window.octopus.resources.read().then((result) => {
        if (result.ok) setReading(result.value)
      })
    },
    RESOURCES_INTERVAL_MS,
    active
  )

  return reading
}
