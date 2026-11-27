import { useEffect } from 'react'

import { useErrorMessage } from './useErrorMessage.js'

/** Holds the window at least `floor` wide: the panes on screen and every conversation. */
export function useWindowFloor(floor: number, onError: (message: string) => void): void {
  const describeFailure = useErrorMessage()

  useEffect(() => {
    void window.octopus.frame.fit(floor).then((result) => {
      if (!result.ok) onError(describeFailure(result))
    })
  }, [floor, onError, describeFailure])
}
