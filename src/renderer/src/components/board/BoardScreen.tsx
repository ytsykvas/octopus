import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { cardsByStatus } from '@core/boardOrder.js'
import { BOARD_STATUSES } from '@core/boardSchema.js'
import type { Project } from '@core/store.js'

import { useBoard } from '../../hooks/useBoard.js'
import { useErrorMessage } from '../../hooks/useErrorMessage.js'
import { Button } from '../Button.js'
import { Placeholder } from '../Placeholder.js'
import { BoardColumn } from './BoardColumn.js'

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
  // Every hook stays above the first return: B202a–B206 hang theirs on `columns`, and a hook
  // below a return breaks the rules of hooks the moment the screen changes state.
  const columns = useMemo(() => cardsByStatus(board.listing?.cards ?? []), [board.listing])

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
          <BoardColumn key={status} status={status} cards={columns[status]} />
        ))}
      </div>
      {titleSlot !== null && createPortal(board.listing.folder, titleSlot)}
    </div>
  )
}
