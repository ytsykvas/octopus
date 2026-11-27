import { useEffect } from 'react'

import { useErrorMessage } from './useErrorMessage.js'

// Null until the panes on screen are known, so no guessed floor widens the window.
export function useWindowFloor(floor: number | null, onError: (message: string) => void): void {
  const describeFailure = useErrorMessage()

  useEffect(() => {
    if (floor === null) return
    void window.octopus.frame.fit(floor).then((result) => {
      if (!result.ok) onError(describeFailure(result))
    })
  }, [floor, onError, describeFailure])
}
