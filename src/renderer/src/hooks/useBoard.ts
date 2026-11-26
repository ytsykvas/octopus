import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

import type { ColumnEdit } from '@core/boardColumns.js'
import type {
  BoardListing,
  CardDraft,
  CardMove,
  CardPatch,
  CardRewrite,
  CreatedCards,
  DescriptionSave
} from '@core/boardSchema.js'

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
  /** The new card's ref, or null when nothing was written or the board left before the answer. */
  readonly create: (draft: CardDraft) => Promise<string | null>
  readonly update: (ref: string, patch: CardPatch) => Promise<boolean>
  /** The card's new ref, or null when the move was refused or the board left before the answer. */
  readonly move: (ref: string, move: CardMove) => Promise<string | null>
  readonly remove: (ref: string) => Promise<boolean>
  readonly rename: (ref: string, title: string) => Promise<boolean>
  /** Null unless refused, so the editor can tell `cardChanged` apart; a board gone first answers null. */
  readonly saveDescription: (ref: string, save: DescriptionSave) => Promise<Failure | null>
  readonly comment: (ref: string, text: string) => Promise<boolean>
  readonly attach: (ref: string) => Promise<boolean>
  readonly revealFile: (ref: string, name: string) => Promise<boolean>
  readonly removeFile: (ref: string, name: string) => Promise<boolean>
  readonly revealCard: (ref: string) => Promise<boolean>
  /** Gives the project columns of its own the first time it is asked. */
  readonly editColumns: (edit: ColumnEdit) => Promise<boolean>
  /** A card refused among them is the caller's to report, from `failure`. */
  readonly createMany: (drafts: readonly CardDraft[]) => Promise<CreatedCards | null>
  readonly rewrite: (ref: string, rewrite: CardRewrite) => Promise<boolean>
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
  /** The encoded board this hook reads, or null — what the subscription to changes on disk is gated on. */
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

  // Every write reads the board again, and its refusal is reported after that read, which may clear
  // the banner. The signal is taken before the answer: a write outlived by its board stays quiet
  // and answers null, so the next board never opens or follows a card the last one wrote.
  const settle = useCallback(
    async <T>(sent: Promise<Result<T>>, quiet: string | null = null): Promise<Result<T> | null> => {
      const signal = live.current
      const answer = await sent
      if (!signal.aborted) {
        if (answer.ok) report.current(null)
        await refresh()
      }
      // Asked again, not once up front: the board may leave while it is read again.
      if (signal.aborted) return null
      // A refusal coded `quiet` is the caller's to show, as the editor shows `cardChanged`.
      if (!answer.ok && answer.code !== quiet) report.current(describe.current(answer))
      return answer
    },
    [report, describe, refresh]
  )

  const create = useCallback(
    async (draft: CardDraft): Promise<string | null> => {
      if (source === null) return null
      const answer = await settle(window.octopus.board.create(source.projectId, draft))
      return answer?.ok === true ? answer.value : null
    },
    [source, settle]
  )

  const update = useCallback(
    async (ref: string, patch: CardPatch): Promise<boolean> => {
      if (source === null) return false
      return (await settle(window.octopus.board.update(source.projectId, ref, patch)))?.ok === true
    },
    [source, settle]
  )

  const move = useCallback(
    async (ref: string, to: CardMove): Promise<string | null> => {
      if (source === null) return null
      const answer = await settle(window.octopus.board.move(source.projectId, ref, to))
      return answer?.ok === true ? answer.value : null
    },
    [source, settle]
  )

  const remove = useCallback(
    async (ref: string): Promise<boolean> => {
      if (source === null) return false
      return (await settle(window.octopus.board.remove(source.projectId, ref)))?.ok === true
    },
    [source, settle]
  )

  const rename = useCallback(
    async (ref: string, title: string): Promise<boolean> => {
      if (source === null) return false
      return (await settle(window.octopus.board.rename(source.projectId, ref, title)))?.ok === true
    },
    [source, settle]
  )

  const saveDescription = useCallback(
    async (ref: string, save: DescriptionSave): Promise<Failure | null> => {
      if (source === null) return null
      const answer = await settle(
        window.octopus.board.saveDescription(source.projectId, ref, save),
        'cardChanged'
      )
      return answer === null || answer.ok ? null : answer
    },
    [source, settle]
  )

  const comment = useCallback(
    async (ref: string, text: string): Promise<boolean> => {
      if (source === null) return false
      return (await settle(window.octopus.board.comment(source.projectId, ref, text)))?.ok === true
    },
    [source, settle]
  )

  const attach = useCallback(
    async (ref: string): Promise<boolean> => {
      if (source === null) return false
      return (await settle(window.octopus.board.attach(source.projectId, ref)))?.ok === true
    },
    [source, settle]
  )

  const revealFile = useCallback(
    async (ref: string, name: string): Promise<boolean> => {
      if (source === null) return false
      return (
        (await settle(window.octopus.board.revealFile(source.projectId, ref, name)))?.ok === true
      )
    },
    [source, settle]
  )

  const removeFile = useCallback(
    async (ref: string, name: string): Promise<boolean> => {
      if (source === null) return false
      return (
        (await settle(window.octopus.board.removeFile(source.projectId, ref, name)))?.ok === true
      )
    },
    [source, settle]
  )

  const revealCard = useCallback(
    async (ref: string): Promise<boolean> => {
      if (source === null) return false
      return (await settle(window.octopus.board.revealCard(source.projectId, ref)))?.ok === true
    },
    [source, settle]
  )

  const editColumns = useCallback(
    async (edit: ColumnEdit): Promise<boolean> => {
      if (source === null) return false
      return (await settle(window.octopus.board.editColumns(source.projectId, edit)))?.ok === true
    },
    [source, settle]
  )

  const createMany = useCallback(
    async (drafts: readonly CardDraft[]): Promise<CreatedCards | null> => {
      if (source === null) return null
      const answer = await settle(window.octopus.board.createMany(source.projectId, drafts))
      return answer?.ok === true ? answer.value : null
    },
    [source, settle]
  )

  const rewrite = useCallback(
    async (ref: string, change: CardRewrite): Promise<boolean> => {
      if (source === null) return false
      return (
        (await settle(window.octopus.board.rewrite(source.projectId, ref, change)))?.ok === true
      )
    },
    [source, settle]
  )

  // A sync service writes while the window is elsewhere; coming back is when that matters.
  useWindowEvent('focus', () => void refresh(), { active: source !== null })

  // The newest `refresh`, so a new one does not resubscribe — the shape of `useBranchMoved`.
  const reread = useEffectEvent(() => {
    void refresh()
  })
  useEffect(() => {
    if (key === null) return
    return window.octopus.board.onChanged((event) => {
      if (event.projectId === projectId) reread()
    })
  }, [key, projectId])

  // Only this key's answer: another project's cards never show while the next board is read.
  const current = state !== null && state.key === key ? state : null
  return {
    listing: current?.listing ?? null,
    failure: current?.failure ?? null,
    revision: current?.revision ?? 0,
    refresh,
    create,
    update,
    move,
    remove,
    rename,
    saveDescription,
    comment,
    attach,
    revealFile,
    removeFile,
    revealCard,
    editColumns,
    createMany,
    rewrite
  }
}
