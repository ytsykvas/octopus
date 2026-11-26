import { Copy, Ellipsis, FolderOpen, Play, Sparkles, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Column } from '@core/boardColumns.js'
import {
  type BoardCard,
  type CardDetail,
  type CardMove,
  CARD_TITLE_MAX
} from '@core/boardSchema.js'
import type { WorkspaceView } from '@core/workspaces.js'

import type { Failure } from '../../../../preload/index.js'
import type { BoardController } from '../../hooks/useBoard.js'
import { useCopy } from '../../hooks/useCopy.js'
import { useErrorMessage } from '../../hooks/useErrorMessage.js'
import { Button } from '../Button.js'
import { DropdownMenu } from '../DropdownMenu.js'
import { NameEditor } from '../NameEditor.js'
import { IconButton } from '../paneControls.js'
import { Callout } from '../pr/Callout.js'
import type { DescriptionDraft } from './boardDrafts.js'
import { CardComments } from './CardComments.js'
import { CardDescription } from './CardDescription.js'
import { PriorityMenu, StatusMenu, TagMenu } from './cardMenus.js'
import { CardResources } from './CardResources.js'
import { CardRuns } from './CardRuns.js'
import { SidePanel } from './SidePanel.js'

export interface CardPanelProps {
  /** From the listing: the header draws at once, before the detail arrives. */
  readonly card: BoardCard
  /** The listing's, so the card's own column is always one of them. */
  readonly columns: readonly Column[]
  readonly detail: CardDetail | null
  readonly failure: Failure | null
  readonly board: BoardController
  readonly draft: DescriptionDraft | null
  readonly onDraft: (draft: DescriptionDraft | null) => void
  readonly width: number
  readonly onWidth: (width: number) => void
  readonly onClose: () => void
  /** A status change; the screen moves the card and follows its new ref. */
  readonly onMove: (move: CardMove) => void
  /** Asks to delete; the screen confirms, because ⌘⌫ (B205) deletes with no panel open. */
  readonly onRemove: () => void
  readonly onEditWithAgent: (detail: CardDetail) => void
  /** The workspace on this machine started from this card, or null. */
  readonly linked: WorkspaceView | null
  /** Runs the card, or opens its workspace; the screen asks first when another Mac has it. */
  readonly onRun: () => Promise<void>
  readonly deviceId: string
}

function CopyDescription({
  description
}: {
  readonly description: string | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const clipboard = useCopy()
  const label =
    clipboard.state === 'done'
      ? t('board.panel.copied')
      : clipboard.state === 'failed'
        ? t('chat.copyFailed')
        : t('board.panel.copy')

  return (
    <Button
      size="sm"
      disabled={description === null}
      onClick={description === null ? undefined : () => void clipboard.copy(description.trim())}
    >
      <Copy aria-hidden size={12} />
      {label}
    </Button>
  )
}

export function CardPanel({
  card,
  columns,
  detail,
  failure,
  board,
  draft,
  onDraft,
  width,
  onWidth,
  onClose,
  onMove,
  onRemove,
  onEditWithAgent,
  linked,
  onRun,
  deviceId
}: CardPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [renaming, setRenaming] = useState(false)
  const [running, setRunning] = useState(false)
  const describeFailure = useErrorMessage()

  const run = async (): Promise<void> => {
    setRunning(true)
    try {
      await onRun()
    } finally {
      setRunning(false)
    }
  }

  return (
    <SidePanel label={card.title} width={width} onWidth={onWidth}>
      <header className="border-line flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <StatusMenu
          columns={columns}
          status={card.status}
          onChoose={(status) => {
            onMove({ status, index: 0 })
          }}
        />
        <PriorityMenu
          priority={card.meta.priority ?? null}
          onChoose={(priority) => void board.update(card.ref, { priority })}
        />
        <TagMenu
          tag={card.meta.tag ?? null}
          onChoose={(tag) => void board.update(card.ref, { tag })}
        />
        <span className="ml-auto" />
        <DropdownMenu
          align="right"
          actions={[
            {
              id: 'reveal',
              label: t('board.panel.reveal'),
              icon: <FolderOpen aria-hidden size={13} />,
              onSelect: () => void board.revealCard(card.ref)
            },
            {
              id: 'remove',
              label: t('board.panel.remove'),
              icon: <Trash2 aria-hidden size={13} />,
              destructive: true,
              onSelect: onRemove
            }
          ]}
          trigger={({ onClick, open }) => (
            <IconButton label={t('board.panel.more')} onClick={onClick} menuOpen={open}>
              <Ellipsis aria-hidden size={14} />
            </IconButton>
          )}
        />
        <IconButton label={t('board.panel.close')} onClick={onClose}>
          <X aria-hidden size={14} />
        </IconButton>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
        {renaming ? (
          <NameEditor
            initial={card.title}
            maxLength={CARD_TITLE_MAX}
            className="input focus-ring text-[15px] font-semibold"
            onCommit={(title) => {
              setRenaming(false)
              if (title !== card.title) void board.rename(card.ref, title)
            }}
            onCancel={() => {
              setRenaming(false)
            }}
          />
        ) : (
          <h2
            onDoubleClick={() => {
              if (!card.notText) setRenaming(true)
            }}
            className="text-ink cursor-text text-[15px] font-semibold break-words"
          >
            {card.title}
          </h2>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {linked === null ? (
            <Button variant="success" size="sm" disabled={running} onClick={() => void run()}>
              <Play aria-hidden size={13} />
              {t('board.panel.run')}
            </Button>
          ) : (
            <Button size="sm" disabled={running} onClick={() => void run()}>
              {t('board.panel.openWorkspace')}
            </Button>
          )}
          <CopyDescription description={card.notText ? null : (detail?.description ?? null)} />
          <Button
            size="sm"
            variant="agent"
            disabled={detail === null || card.notText || card.malformed}
            onClick={
              detail === null
                ? undefined
                : () => {
                    onEditWithAgent(detail)
                  }
            }
          >
            <Sparkles aria-hidden size={13} />
            {t('board.brainstorm.edit')}
          </Button>
        </div>
        {failure !== null && <Callout tone="warning">{describeFailure(failure)}</Callout>}
        {detail !== null && (
          <>
            {card.notText ? (
              <Callout tone="warning">{t('board.card.notText')}</Callout>
            ) : (
              <>
                <CardDescription
                  description={detail.description}
                  draft={draft}
                  onDraft={onDraft}
                  onSave={(save) => board.saveDescription(card.ref, save)}
                />
                <CardResources
                  links={detail.meta.links}
                  onLinks={(links) => board.update(card.ref, { links })}
                  attachments={detail.attachments}
                  onAttach={() => void board.attach(card.ref)}
                  onReveal={(name) => void board.revealFile(card.ref, name)}
                  onRemoveFile={(name) => board.removeFile(card.ref, name)}
                />
              </>
            )}
            <CardRuns runs={detail.meta.runs} deviceId={deviceId} linked={linked} />
            <CardComments thread={detail.thread} onAdd={(text) => board.comment(card.ref, text)} />
          </>
        )}
      </div>
    </SidePanel>
  )
}
