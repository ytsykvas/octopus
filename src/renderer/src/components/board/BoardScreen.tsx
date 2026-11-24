import { useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { cardsByStatus } from '@core/boardOrder.js'
import {
  type BoardCard,
  BOARD_STATUSES,
  type BoardStatus,
  type CardMove
} from '@core/boardSchema.js'
import type { BranchRequest } from '@core/pullRequestShapes.js'
import type { Project } from '@core/store.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { useBoard } from '../../hooks/useBoard.js'
import { useBoardDrag } from '../../hooks/useBoardDrag.js'
import { type OpenCard, useCardDetail } from '../../hooks/useCardDetail.js'
import { useConfirm } from '../../hooks/useConfirm.js'
import { useErrorMessage } from '../../hooks/useErrorMessage.js'
import { Button } from '../Button.js'
import { Placeholder } from '../Placeholder.js'
import { BoardColumn } from './BoardColumn.js'
import type { DescriptionDraft } from './boardDrafts.js'
import { cardMark, linkedByCard, linkedTo, openRunElsewhere } from './boardRuns.js'
import { CardMarks } from './CardMarks.js'
import { CardPanel, PANEL_WIDTH } from './CardPanel.js'

export interface BoardScreenProps {
  /** null while no project is selected; App shows its own pane when there are none at all (B201b). */
  readonly project: Project | null
  /** null until the config has been read; '' when no folder is chosen. */
  readonly boardFolder: string | null
  readonly onPickFolder: () => void
  readonly onError: (message: string | null) => void
  /** Where the title bar takes the folder this board reads; null while it shows something else. */
  readonly titleSlot: HTMLElement | null
  readonly draftOf: (ref: string) => DescriptionDraft | null
  readonly onDraft: (ref: string, draft: DescriptionDraft | null) => void
  readonly onDraftMoved: (from: string, to: string) => void
  /** This project's workspaces on this machine — what a card may have been started into. */
  readonly workspaces: readonly WorkspaceView[]
  /** This installation's `config.deviceId`: a run from any other is another machine's. */
  readonly deviceId: string
  readonly onRun: (projectId: string, ref: string) => Promise<void>
  readonly requests: ReadonlyMap<string, BranchRequest>
}

export function BoardScreen({
  project,
  boardFolder,
  onPickFolder,
  onError,
  titleSlot,
  draftOf,
  onDraft,
  onDraftMoved,
  workspaces,
  deviceId,
  onRun,
  requests
}: BoardScreenProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()
  const board = useBoard(project?.id ?? null, boardFolder ?? '', onError)
  // The members, not `board`: the controller is a new object every render, its members are stable.
  const { move, remove } = board
  // Every hook stays above the first return: B202a–B206 hang theirs on `columns`, and a hook
  // below a return breaks the rules of hooks the moment the screen changes state.
  const columns = useMemo(() => cardsByStatus(board.listing?.cards ?? []), [board.listing])
  const [creatingIn, setCreatingIn] = useState<BoardStatus | null>(null)
  const [open, setOpen] = useState<OpenCard | null>(null)
  // Never reused, not even after a close: the detail and the panel are keyed by it.
  const openings = useRef(0)
  // What the screen holds for one board — a project's, in one folder — is not carried into the next.
  const projectId = project?.id ?? null
  const boardKey = `${projectId ?? ''}\n${boardFolder ?? ''}`
  const [shownBoard, setShownBoard] = useState(boardKey)
  if (boardKey !== shownBoard) {
    setShownBoard(boardKey)
    setCreatingIn(null)
    setOpen(null)
  }
  const openRef = open?.ref ?? null
  const [panelWidth, setPanelWidth] = useState(PANEL_WIDTH)
  const { confirm, dialog } = useConfirm()
  const openCard = board.listing?.cards.find((card) => card.ref === openRef) ?? null
  const { detail, failure } = useCardDetail(
    projectId,
    openCard === null ? null : open,
    board.revision
  )
  const panelKey = open?.session ?? 0
  const linkedBy = useMemo(() => linkedByCard(workspaces), [workspaces])
  const marksOf = useCallback(
    (card: BoardCard): React.JSX.Element | null => {
      const mark = cardMark(card, linkedBy, requests, deviceId)
      return mark === null ? null : <CardMarks mark={mark} />
    },
    [linkedBy, requests, deviceId]
  )

  /** Every move of a card goes through here (status menu now, drag B204, ⌥↑/⌥↓ B205). */
  const moveCard = useCallback(
    async (ref: string, to: CardMove): Promise<string | null> => {
      const moved = await move(ref, to)
      if (moved !== null) {
        setOpen((current) =>
          current?.ref === ref ? { ref: moved, session: current.session } : current
        )
        onDraftMoved(ref, moved)
      }
      return moved
    },
    [move, onDraftMoved]
  )
  // Always on until B206 switches it off under a filter.
  const drag = useBoardDrag(
    columns,
    (ref, to) => {
      void moveCard(ref, to)
    },
    true
  )

  const removeCard = useCallback(
    async (card: BoardCard): Promise<void> => {
      const answer = await confirm({
        title: t('board.remove.title', { title: card.title }),
        message: t('board.remove.body'),
        confirmLabel: t('board.panel.remove'),
        cancelLabel: t('board.panel.cancel'),
        destructive: true
      })
      if (!answer.confirmed) return
      if (await remove(card.ref)) setOpen((current) => (current?.ref === card.ref ? null : current))
    },
    [confirm, t, remove]
  )

  const runCard = useCallback(
    async (projectId: string, card: BoardCard, linked: WorkspaceView | null): Promise<void> => {
      // Asked only before starting a second workspace; opening the one here asks nothing.
      const elsewhere = linked === null ? openRunElsewhere(card.meta.runs, deviceId) : undefined
      if (elsewhere !== undefined) {
        const { confirmed } = await confirm({
          title: t('board.run.elsewhereTitle', { machine: elsewhere.machine }),
          message: t('board.run.elsewhereBody'),
          confirmLabel: t('board.run.elsewhereConfirm'),
          cancelLabel: t('board.panel.cancel')
        })
        if (!confirmed) return
      }
      await onRun(projectId, card.ref)
    },
    [confirm, deviceId, onRun, t]
  )

  const openCardAt = (ref: string): void => {
    openings.current += 1
    setOpen({ ref, session: openings.current })
  }

  const createIn = async (status: BoardStatus, title: string): Promise<void> => {
    const ref = await board.create({ status, title })
    if (ref === null) return
    onDraft(ref, null)
    openCardAt(ref)
  }

  const linked = openCard === null ? null : linkedTo(openCard, linkedBy)

  if (boardFolder === null) return null
  if (boardFolder === '')
    return (
      <Placeholder
        title={t('board.empty.noFolderTitle')}
        actions={
          <Button variant="accent" onClick={onPickFolder}>
            {t('board.empty.chooseFolder')}
          </Button>
        }
      >
        {t('board.empty.noFolderText')}
      </Placeholder>
    )
  if (project === null)
    return (
      <Placeholder title={t('board.empty.noProjectTitle')}>
        {t('board.empty.noProjectText')}
      </Placeholder>
    )
  if (board.failure !== null)
    return (
      <Placeholder
        title={t('board.empty.failedTitle')}
        actions={<Button onClick={() => void board.refresh()}>{t('board.empty.retry')}</Button>}
      >
        {describeFailure(board.failure)}
      </Placeholder>
    )
  // The first read is still out: neither columns nor a message, so nothing flashes.
  if (board.listing === null) return <div className="flex min-h-0 flex-1" />
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 overflow-x-auto">
        {BOARD_STATUSES.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            cards={columns[status]}
            creating={creatingIn === status}
            onCreating={(on) => {
              setCreatingIn(on ? status : null)
            }}
            onCreate={(title) => void createIn(status, title)}
            openRef={openRef}
            onOpen={openCardAt}
            marksOf={marksOf}
            drag={drag}
          />
        ))}
      </div>
      {openCard !== null && (
        <CardPanel
          key={panelKey}
          card={openCard}
          detail={detail}
          failure={failure}
          board={board}
          draft={draftOf(openCard.ref)}
          onDraft={(draft) => {
            onDraft(openCard.ref, draft)
          }}
          width={panelWidth}
          onWidth={setPanelWidth}
          onClose={() => {
            setOpen(null)
          }}
          onMove={(to) => void moveCard(openCard.ref, to)}
          onRemove={() => void removeCard(openCard)}
          linked={linked}
          onRun={() => runCard(project.id, openCard, linked)}
          deviceId={deviceId}
        />
      )}
      {dialog}
      {titleSlot !== null && createPortal(board.listing.folder, titleSlot)}
    </div>
  )
}
