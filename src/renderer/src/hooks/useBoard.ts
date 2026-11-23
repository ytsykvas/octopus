import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { BoardListing } from '@core/boardSchema.js'

import type { Failure, Result } from '../../../preload/index.js'
import { useErrorMessage } from './useErrorMessage.js'
import { useLatest } from './useLatest.js'
import { useWindowEvent } from './useWindowEvent.js'

export interface BoardController {
  /** The listing of the project and folder asked for; null while none has arrived. */
  readonly listing: BoardListing | null
  /** Why the board cannot be shown; null whenever `listing` is there. */
  readonly failure: Failure | null
  /** +1 for every read that worked, changed or not — what the card detail re-reads on (B202b). */
  readonly revision: number
  readonly refresh: () => Promise<void>
}

interface BoardSource {
  readonly projectId: string
  /** `projectId + '\n' + boardFolder`: a new folder is a new board. */
  readonly key: string
}

interface BoardState {
  readonly key: string
  readonly listing: BoardListing | null
  readonly failure: Failure | null
  readonly revision: number
  /** A failure of this key is in the banner and no read has worked since. */
  readonly reported: boolean
}

/** Codes that mean the folder itself is gone, so the cards on screen are no longer true. */
const FOLDER_GONE: ReadonlySet<string> = new Set(['boardFolderUnset', 'boardFolderUnreadable'])

export function useBoard(
  projectId: string | null,
  boardFolder: string,
  onError: (message: string | null) => void
): BoardController {
  const describeFailure = useErrorMessage()
  // Through refs, so a new language or a new callback does not read the board again.
  const report = useLatest(onError)
  const describe = useLatest(describeFailure)
  const source = useMemo<BoardSource | null>(
    () =>
      projectId === null || boardFolder === ''
        ? null
        : { projectId, key: `${projectId}\n${boardFolder}` },
    [projectId, boardFolder]
  )
  /** The encoded board this hook reads, or null — what B301's subscription is gated on. */
  const key = source?.key ?? null
  const [state, setState] = useState<BoardState | null>(null)
  // The same state, readable at once by the next answer: written in `apply`, never read in render.
  const record = useRef<BoardState | null>(null)
  const generation = useRef(0)
  // The board on screen, aborted when it changes or the screen goes: a read `refresh` started
  // dies with its board, as the mount's own read does, so a board no longer shown never writes
  // to the window's banner. Already aborted until the first read starts.
  const live = useRef<AbortSignal>(AbortSignal.abort())

  const apply = useCallback(
    (key: string, answer: Result<BoardListing>): void => {
      const held = record.current
      const previous = held !== null && held.key === key ? held : null
      const shown = previous?.listing ?? null
      const revision = previous?.revision ?? 0
      let next: BoardState
      if (answer.ok) {
        // The same object when nothing changed, so no card redraws; the revision moves anyway,
        // because a changed description does not show in the listing.
        const same = shown !== null && JSON.stringify(shown) === JSON.stringify(answer.value)
        next = {
          key,
          listing: same ? shown : answer.value,
          failure: null,
          revision: revision + 1,
          reported: false
        }
      } else if (shown === null || FOLDER_GONE.has(answer.code ?? '')) {
        // Nothing worth keeping on screen: the screen says why in place of the columns.
        next = {
          key,
          listing: null,
          failure: answer,
          revision,
          reported: false
        }
      } else {
        next = {
          key,
          listing: shown,
          failure: null,
          revision,
          reported: true
        }
        report.current(describe.current(answer))
      }
      if (!next.reported && previous?.reported === true) report.current(null)
      record.current = next
      setState(next)
    },
    [report, describe]
  )

  const read = useCallback(
    async (from: BoardSource, signal: AbortSignal): Promise<void> => {
      const attempt = ++generation.current
      const answer = await window.octopus.board.list(from.projectId)
      if (signal.aborted || attempt !== generation.current) return
      apply(from.key, answer)
    },
    [apply]
  )

  useEffect(() => {
    if (source === null) return
    const controller = new AbortController()
    live.current = controller.signal
    void read(source, controller.signal)
    return () => {
      controller.abort()
    }
  }, [source, read])

  const refresh = useCallback(async () => {
    if (source !== null) await read(source, live.current)
  }, [source, read])

  // A sync service writes while the window is elsewhere; coming back is when that matters.
  useWindowEvent('focus', () => void refresh(), { active: source !== null })

  // Only this key's answer: another project's cards never show while the next board is read.
  const current = state !== null && state.key === key ? state : null
  return {
    listing: current?.listing ?? null,
    failure: current?.failure ?? null,
    revision: current?.revision ?? 0,
    refresh
  }
}
