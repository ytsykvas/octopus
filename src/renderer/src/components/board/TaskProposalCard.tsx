import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Column } from '@core/boardColumns.js'
import type { BrainstormPurpose } from '@core/brainstorm.js'
import { CARD_TEXT_MAX, CARD_TITLE_MAX, CardDescriptionSchema } from '@core/boardSchema.js'
import { movedTo } from '@core/lists.js'

import type { Failure } from '../../../../preload/index.js'
import { useErrorMessage } from '../../hooks/useErrorMessage.js'
import { Button } from '../Button.js'
import { Markdown } from '../chat/Markdown.js'
import { MarkdownEditor } from '../markdown/MarkdownEditor.js'
import { NameEditor } from '../NameEditor.js'
import { IconButton } from '../paneControls.js'
import { Callout } from '../pr/Callout.js'
import { PriorityMenu, StatusMenu, TagMenu } from './cardMenus.js'
import { type DraftTask, withTask } from './proposalDraft.js'

export interface TaskProposalCardProps {
  readonly purpose: BrainstormPurpose
  readonly summary: string
  readonly tasks: readonly DraftTask[]
  readonly onTasks: (tasks: DraftTask[]) => void
  readonly columns: readonly Column[]
  readonly writing: boolean
  readonly failure: Failure | null
  readonly onWrite: () => void
}

function ProposedTaskRow({
  purpose,
  task,
  first,
  last,
  columns,
  onChange,
  onMove,
  onLeaveOut
}: {
  readonly purpose: BrainstormPurpose
  readonly task: DraftTask
  readonly first: boolean
  readonly last: boolean
  readonly columns: readonly Column[]
  readonly onChange: (change: Partial<DraftTask>) => void
  readonly onMove: (step: -1 | 1) => void
  readonly onLeaveOut: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [renaming, setRenaming] = useState(false)
  const [describing, setDescribing] = useState<string | null>(null)
  const unwritable = (text: string): boolean => !CardDescriptionSchema.safeParse(text).success
  const describe = (description: string): void => {
    if (unwritable(description)) return
    setDescribing(null)
    onChange({ description })
  }

  return (
    <li className="border-line flex flex-col gap-1.5 rounded-[var(--radius-control)] border p-2">
      <div className="flex items-start gap-1">
        {renaming ? (
          <NameEditor
            initial={task.title}
            maxLength={CARD_TITLE_MAX}
            className="input focus-ring min-w-0 flex-1 text-[13px] font-medium"
            onCommit={(title) => {
              setRenaming(false)
              onChange({ title })
            }}
            onCancel={() => {
              setRenaming(false)
            }}
          />
        ) : (
          <h4
            onDoubleClick={() => {
              setRenaming(true)
            }}
            className="text-ink min-w-0 flex-1 cursor-text text-[13px] font-medium break-words"
          >
            {task.title}
          </h4>
        )}
        {purpose === 'tasks' && (
          <>
            <IconButton
              label={t('board.brainstorm.up')}
              disabled={first}
              onClick={() => {
                onMove(-1)
              }}
            >
              <ArrowUp aria-hidden size={13} />
            </IconButton>
            <IconButton
              label={t('board.brainstorm.down')}
              disabled={last}
              onClick={() => {
                onMove(1)
              }}
            >
              <ArrowDown aria-hidden size={13} />
            </IconButton>
            <IconButton label={t('board.brainstorm.leaveOut')} onClick={onLeaveOut}>
              <X aria-hidden size={13} />
            </IconButton>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <PriorityMenu
          priority={task.priority}
          onChoose={(priority) => {
            onChange({ priority })
          }}
        />
        <TagMenu
          tag={task.tag}
          onChoose={(tag) => {
            onChange({ tag })
          }}
        />
        {purpose === 'tasks' && (
          <StatusMenu
            columns={columns}
            status={task.status}
            onChoose={(status) => {
              onChange({ status })
            }}
          />
        )}
      </div>
      {describing !== null ? (
        <div className="flex flex-col gap-1.5">
          <MarkdownEditor
            label={t('board.brainstorm.description')}
            initial={task.description}
            maxLength={CARD_TEXT_MAX}
            autoFocus
            onChange={setDescribing}
            onSave={describe}
            onCancel={() => {
              setDescribing(null)
            }}
          />
          {unwritable(describing) && (
            <p className="text-danger text-[11px]">{t('board.brainstorm.descriptionUnwritable')}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              onClick={() => {
                setDescribing(null)
              }}
            >
              {t('board.brainstorm.descriptionCancel')}
            </Button>
            <Button
              size="sm"
              variant="accent"
              disabled={unwritable(describing)}
              onClick={() => {
                describe(describing)
              }}
            >
              {t('board.brainstorm.descriptionDone')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-1 text-[12px]">
          <Markdown text={task.description} />
          <Button
            size="sm"
            onClick={() => {
              setDescribing(task.description)
            }}
          >
            {t('board.brainstorm.editDescription')}
          </Button>
        </div>
      )}
    </li>
  )
}

export function TaskProposalCard({
  purpose,
  summary,
  tasks,
  onTasks,
  columns,
  writing,
  failure,
  onWrite
}: TaskProposalCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()

  return (
    <section
      aria-label={t('board.brainstorm.proposal')}
      className="border-line bg-canvas flex flex-col gap-2 rounded-[var(--radius-control)] border p-3"
    >
      <h3 className="section-label">{t('board.brainstorm.proposal')}</h3>
      <p className="text-ink-soft text-[12px]">{summary}</p>
      {tasks.length === 0 ? (
        <p className="text-ink-faint text-[12px]">{t('board.brainstorm.allLeftOut')}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {tasks.map((task, index) => (
            <ProposedTaskRow
              key={task.key}
              purpose={purpose}
              task={task}
              first={index === 0}
              last={index === tasks.length - 1}
              columns={columns}
              onChange={(change) => {
                onTasks(withTask(tasks, index, change))
              }}
              onMove={(step) => {
                onTasks(movedTo(tasks, index, index + step))
              }}
              onLeaveOut={() => {
                onTasks(tasks.filter((_, at) => at !== index))
              }}
            />
          ))}
        </ol>
      )}
      {failure !== null && <Callout tone="warning">{describeFailure(failure)}</Callout>}
      <Button
        variant="success"
        className="self-start"
        disabled={tasks.length === 0 || writing}
        onClick={onWrite}
      >
        {purpose === 'edit'
          ? t('board.brainstorm.apply')
          : t('board.brainstorm.createTasks', { count: tasks.length })}
      </Button>
    </section>
  )
}
