import { Plus } from 'lucide-react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { cardsByStatus, cardsIn } from '@core/boardOrder.js'
import type { BoardCard, CardMove, ColumnId } from '@core/boardSchema.js'
import { present } from '@core/present.js'
import type { BranchRequest } from '@core/pullRequestShapes.js'
import type { Project } from '@core/store.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { useBoard } from '../../hooks/useBoard.js'
import { useBoardDrag } from '../../hooks/useBoardDrag.js'
import { type BrainstormTarget, useBrainstorm } from '../../hooks/useBrainstorm.js'
import { type OpenCard, useCardDetail } from '../../hooks/useCardDetail.js'
import { useColumnEditing } from '../../hooks/useColumnEditing.js'
import { useConfirm } from '../../hooks/useConfirm.js'
import { useErrorMessage } from '../../hooks/useErrorMessage.js'
import { useWindowEvent } from '../../hooks/useWindowEvent.js'
import { Button } from '../Button.js'
import { IconButton } from '../paneControls.js'
import { Placeholder } from '../Placeholder.js'
import { projectColorStyle } from '../projectTint.js'
import { BoardColumn } from './BoardColumn.js'
import type { DescriptionDraft } from './boardDrafts.js'
import { statusOf } from './boardDrop.js'
import { type BoardFilter, filterColumns, isFilterActive } from './boardFilter.js'
import {
  boardKeyAction,
  type BoardKeyAction,
  cardRefs,
  focusedCard,
  nextFocus,
  stepIndex
} from './boardKeys.js'
import { cardMark, linkedByCard, linkedTo, openRunElsewhere } from './boardRuns.js'
import { sidewaysDelta } from './boardScroll.js'
import { BrainstormPanel } from './BrainstormPanel.js'
import { CardMarks } from './CardMarks.js'
import { CardPanel, PANEL_WIDTH } from './CardPanel.js'
import { columnMenu } from './columnMenu.js'

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
  readonly filter: BoardFilter
}

/** Escaped: refs hold spaces and Cyrillic (FileTabs.tsx does the same). */
function cardButton(ref: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`button[data-card-ref="${CSS.escape(ref)}"]`)
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
  requests,
  filter
}: BoardScreenProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()
  const board = useBoard(project?.id ?? null, boardFolder ?? '', onError)
  // The members, not `board`: the controller is a new object every render, its members are stable.
  const { move, remove, editColumns } = board
  // Every hook stays above the first return: B202a–B206 hang theirs on `columns`, and a hook
  // below a return breaks the rules of hooks the moment the screen changes state.
  const columns = useMemo(
    () => cardsByStatus(board.listing?.cards ?? [], board.listing?.columns ?? []),
    [board.listing]
  )
  const editing = useColumnEditing(board.listing?.columns ?? [], editColumns)
  const filtering = isFilterActive(filter)
  const visible = useMemo(
    () => filterColumns(columns, filter, (tag) => t(`workspaces.kinds.${tag}.label`)),
    [columns, filter, t]
  )
  const [creatingIn, setCreatingIn] = useState<ColumnId | null>(null)
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
  const brainstorms = useBrainstorm(projectId, boardKey)
  const thinking = brainstorms.current
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

  /** Every move of a card goes through here: the status menu, the drag, ⌥↑/⌥↓. */
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
  // Off under a filter: the neighbours a slot is counted from are not all shown.
  const drag = useBoardDrag(
    columns,
    (ref, to) => {
      void moveCard(ref, to)
    },
    !filtering
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

  // At once when nothing was said yet: a click on a card opens it in the same tick as before.
  const whenLetGo = (then: () => void): void => {
    if (thinking?.started !== true) {
      then()
      return
    }
    void confirm({
      title: t('board.brainstorm.discardTitle'),
      message: t('board.brainstorm.discardBody'),
      confirmLabel: t('board.brainstorm.discard'),
      cancelLabel: t('board.brainstorm.keep'),
      destructive: true
    }).then(({ confirmed }) => {
      if (confirmed) then()
    })
  }

  const openBrainstorm = (target: BrainstormTarget): void => {
    whenLetGo(() => {
      setOpen(null)
      brainstorms.open(target)
    })
  }

  const openFromBoard = (ref: string): void => {
    whenLetGo(() => {
      brainstorms.close()
      openCardAt(ref)
    })
  }

  const createIn = async (status: ColumnId, title: string): Promise<void> => {
    const ref = await board.create({ status, title })
    if (ref === null) return
    onDraft(ref, null)
    // The brainstorm keeps the panel: a task typed in beside it is not a reason to end it.
    if (thinking === null) openCardAt(ref)
  }

  const columnFrom = (ref: string | null): ColumnId =>
    (ref === null ? null : statusOf(columns, ref)) ?? 'backlog'

  // Put back only from the body: React keeps the focus on a tile it moves, but a loose card
  // comes back from a move as a new node under a new ref, and a key pressed meanwhile may have
  // put it in a field. A state, so the effect runs once the listing the move read back is drawn.
  const [refocus, setRefocus] = useState<{ readonly ref: string } | null>(null)
  useLayoutEffect(() => {
    if (refocus !== null && document.activeElement === document.body) {
      cardButton(refocus.ref)?.focus()
    }
  }, [refocus])

  const shownRef = openCard?.ref ?? null
  // After the panel is drawn: it narrows the columns and may cover the card it opened for.
  useLayoutEffect(() => {
    if (shownRef !== null)
      cardButton(shownRef)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [shownRef])

  const runKey = (action: BoardKeyAction): void => {
    switch (action.kind) {
      case 'create':
        setCreatingIn(columnFrom(action.from))
        return
      case 'brainstorm':
        openBrainstorm({ purpose: 'tasks', column: columnFrom(action.from) })
        return
      case 'close':
        setOpen(null)
        setRefocus({ ref: action.ref })
        return
      case 'blur':
        cardButton(action.ref)?.blur()
        return
      case 'focus': {
        const next = nextFocus(cardRefs(visible), action.from, action.direction)
        if (next === null) return
        cardButton(next)?.focus()
        // A new opening, so the panel remounts and the editor of the card left hands its draft
        // up (B203); none when the focus stayed put, or the same card would be read again.
        if (openCard !== null && next !== openCard.ref) openCardAt(next)
        return
      }
      case 'step': {
        const status = present(statusOf(columns, action.ref), 'the column of a listed task')
        const index = stepIndex(cardsIn(columns, status), action.ref, action.step)
        if (index === null) return
        void moveCard(action.ref, { status, index }).then((next) => {
          if (next !== null) setRefocus({ ref: next })
        })
        return
      }
      case 'remove':
        void removeCard(
          present(
            board.listing?.cards.find((card) => card.ref === action.ref),
            'a listed task'
          )
        )
        return
    }
  }

  useWindowEvent(
    'keydown',
    (event) => {
      const focused = focusedCard(event.target)
      if (focused === undefined) return
      const action = boardKeyAction(event, {
        focused,
        open: openCard?.ref ?? null,
        reorderable: !filtering
      })
      if (action === null) return
      event.preventDefault()
      runKey(action)
    },
    { active: board.listing !== null }
  )

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
    <div className="flex min-h-0 flex-1" style={projectColorStyle(project.color)}>
      <div
        className="scrollbar-shown flex min-w-0 flex-1 overflow-x-auto"
        onWheel={(event) => {
          const delta = sidewaysDelta(event, event.target)
          if (delta !== null) event.currentTarget.scrollLeft += delta
        }}
      >
        {board.listing.columns.map((column, index, all) => (
          <BoardColumn
            key={column.id}
            column={column}
            cards={cardsIn(visible, column.id)}
            total={cardsIn(columns, column.id).length}
            filtering={filtering}
            creating={creatingIn === column.id}
            onCreating={(on) => {
              setCreatingIn(on ? column.id : null)
            }}
            onCreate={(title) => void createIn(column.id, title)}
            onBrainstorm={() => {
              openBrainstorm({ purpose: 'tasks', column: column.id })
            }}
            openRef={openRef}
            onOpen={openFromBoard}
            onRename={(ref, title) => void board.rename(ref, title)}
            marksOf={marksOf}
            drag={drag}
            menu={columnMenu(
              column,
              { index, count: all.length, cardCount: cardsIn(columns, column.id).length },
              editing,
              t
            )}
            reorder={{
              props: editing.reorder.itemProps(column.id),
              edge: editing.reorder.dropEdge(column.id),
              dragging: editing.reorder.draggingId === column.id
            }}
          />
        ))}
        <div className="flex shrink-0 items-start px-2 pt-1.5">
          <IconButton label={t('board.columns.add')} onClick={() => void editing.add()}>
            <Plus aria-hidden size={14} />
          </IconButton>
        </div>
      </div>
      {thinking !== null && (
        <BrainstormPanel
          key={thinking.opening}
          brainstorm={thinking}
          columns={board.listing.columns}
          board={board}
          width={panelWidth}
          onWidth={setPanelWidth}
          onClose={() => {
            whenLetGo(brainstorms.close)
          }}
          onDone={() => {
            brainstorms.close()
            if (thinking.target.purpose === 'edit') openCardAt(thinking.target.card.ref)
          }}
        />
      )}
      {thinking === null && openCard !== null && (
        <CardPanel
          key={panelKey}
          card={openCard}
          columns={board.listing.columns}
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
          onEditWithAgent={(detail) => {
            openBrainstorm({ purpose: 'edit', card: detail })
          }}
          linked={linked}
          onRun={() => runCard(project.id, openCard, linked)}
          deviceId={deviceId}
        />
      )}
      {dialog}
      {editing.dialogs}
      {titleSlot !== null && createPortal(board.listing.folder, titleSlot)}
    </div>
  )
}
