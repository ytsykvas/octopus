import { useEffect, useState } from 'react'

import type { CardDetail } from '@core/boardSchema.js'

import type { Failure } from '../../../preload/index.js'

/** The card in the panel: `ref` follows it through moves; `session` is new with every opening. */
export interface OpenCard {
  readonly ref: string
  readonly session: number
}

export interface CardDetailState {
  readonly detail: CardDetail | null
  /** Why the open card could not be read: the panel says it where the description would be. */
  readonly failure: Failure | null
}

interface HeldDetail {
  readonly projectId: string
  readonly session: number
  readonly shown: CardDetailState
}

const NOTHING: CardDetailState = { detail: null, failure: null }

export function useCardDetail(
  projectId: string | null,
  open: OpenCard | null,
  revision: number
): CardDetailState {
  const [state, setState] = useState<HeldDetail | null>(null)
  const ref = open?.ref ?? null
  const session = open?.session ?? null

  // Read again on every new revision: the listing cannot see a changed description.
  useEffect(() => {
    if (projectId === null || ref === null || session === null) return
    const controller = new AbortController()
    void (async () => {
      const answer = await window.octopus.board.read(projectId, ref)
      if (controller.signal.aborted) return
      // Removed outside is no failure: the next listing drops the card and the panel with it.
      const shown = answer.ok
        ? { detail: answer.value, failure: null }
        : { detail: null, failure: answer.code === 'cardMissing' ? null : answer }
      setState({ projectId, session, shown })
    })()
    return () => {
      controller.abort()
    }
  }, [projectId, ref, session, revision])

  // Keyed by the opening, not the ref: a moved card keeps its detail while it is read again.
  return state !== null && state.projectId === projectId && state.session === session
    ? state.shown
    : NOTHING
}
