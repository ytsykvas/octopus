import { useEffect, useState } from 'react'

import type { CardDetail } from '@core/boardSchema.js'

import { useErrorMessage } from './useErrorMessage.js'
import { useLatest } from './useLatest.js'

interface DetailState {
  readonly projectId: string
  readonly ref: string
  readonly detail: CardDetail | null
}

export function useCardDetail(
  projectId: string | null,
  ref: string | null,
  revision: number,
  onError: (message: string | null) => void
): CardDetail | null {
  const describeFailure = useErrorMessage()
  const report = useLatest(onError)
  const describe = useLatest(describeFailure)
  const [state, setState] = useState<DetailState | null>(null)

  // Read again on every new revision: the listing cannot see a changed description.
  useEffect(() => {
    if (projectId === null || ref === null) return
    const controller = new AbortController()
    void (async () => {
      const answer = await window.octopus.board.read(projectId, ref)
      if (controller.signal.aborted) return
      if (answer.ok) setState({ projectId, ref, detail: answer.value })
      // Removed outside: the next listing drops the card and the panel with it.
      else if (answer.code === 'cardMissing') setState({ projectId, ref, detail: null })
      else report.current(describe.current(answer))
    })()
    return () => {
      controller.abort()
    }
  }, [projectId, ref, revision, report, describe])

  // The previous detail stays while the same card is read again, never another card's.
  return state !== null && state.projectId === projectId && state.ref === ref ? state.detail : null
}
