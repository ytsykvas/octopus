import { useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { cardsByStatus } from '@core/boardOrder.js'
import {
  type BoardCard,
  BOARD_STATUSES,
  type BoardStatus,
  type CardMove
} from '@core/boardSchema.js'
import type { Project } from '@core/store.js'

import { useBoard } from '../../hooks/useBoard.js'
import { useCardDetail } from '../../hooks/useCardDetail.js'
import { useConfirm } from '../../hooks/useConfirm.js'
import { useErrorMessage } from '../../hooks/useErrorMessage.js'
import { Button } from '../Button.js'
import { Placeholder } from '../Placeholder.js'
import { BoardColumn } from './BoardColumn.js'
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
}

/** The card in the panel: `ref` follows it through moves; `session` grows with every opening and keys the panel. */
interface OpenCard {
  readonly ref: string
  readonly session: number
}

export function BoardScreen({
  project,
  boardFolder,
  onPickFolder,
  onError,
  titleSlot
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
  // What the screen holds for one project is not carried into the next one's board.
  const projectId = project?.id ?? null
  const [shownProjectId, setShownProjectId] = useState(projectId)
  if (projectId !== shownProjectId) {
    setShownProjectId(projectId)
    setCreatingIn(null)
    setOpen(null)
  }
  const openRef = open?.ref ?? null
  const [panelWidth, setPanelWidth] = useState(PANEL_WIDTH)
  const { confirm, dialog } = useConfirm()
  const openCard = board.listing?.cards.find((card) => card.ref === openRef) ?? null
  const detail = useCardDetail(projectId, openCard?.ref ?? null, board.revision, onError)
  const panelKey = open?.session ?? 0

  /** Every move of a card goes through here (status menu now, drag B204, ⌥↑/⌥↓ B205). */
  const moveCard = useCallback(
    async (ref: string, to: CardMove): Promise<string | null> => {
      const moved = await move(ref, to)
      if (moved !== null)
        setOpen((current) =>
          current?.ref === ref ? { ref: moved, session: current.session } : current
        )
      return moved
    },
    [move]
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

  const openCardAt = (ref: string): void => {
    setOpen((current) => ({ ref, session: (current?.session ?? 0) + 1 }))
  }

  const createIn = async (status: BoardStatus, title: string): Promise<void> => {
    const ref = await board.create({ status, title })
    if (ref !== null) openCardAt(ref)
  }

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
          />
        ))}
      </div>
      {openCard !== null && (
        <CardPanel
          key={panelKey}
          card={openCard}
          detail={detail}
          board={board}
          width={panelWidth}
          onWidth={setPanelWidth}
          onClose={() => {
            setOpen(null)
          }}
          onMove={(to) => void moveCard(openCard.ref, to)}
          onRemove={() => void removeCard(openCard)}
        />
      )}
      {dialog}
      {titleSlot !== null && createPortal(board.listing.folder, titleSlot)}
    </div>
  )
}
