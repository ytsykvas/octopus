import { Sparkles, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Column } from '@core/boardColumns.js'
import type { ColumnId } from '@core/boardSchema.js'
import { present } from '@core/present.js'
import { withEditedTasks } from '@core/taskProposal.js'

import type { Failure } from '../../../../preload/index.js'
import type { BoardController } from '../../hooks/useBoard.js'
import type { Brainstorm, BrainstormTarget } from '../../hooks/useBrainstorm.js'
import { useErrorMessage } from '../../hooks/useErrorMessage.js'
import { Button } from '../Button.js'
import { ChatLog } from '../chat/ChatLog.js'
import { COLLAPSED } from '../chat/expansion.js'
import { isSubmitEnter } from '../chat/submitKey.js'
import { IconButton } from '../paneControls.js'
import { Callout } from '../pr/Callout.js'
import { latestProposal } from './brainstormLog.js'
import { cardDraftsOf, type DraftTask, draftTasks, proposedOf } from './proposalDraft.js'
import { SidePanel } from './SidePanel.js'
import { TaskProposalCard } from './TaskProposalCard.js'

// Held still for the memoised log: the brainstorm has no queue and no MCP server's questions.
const NONE: ReadonlySet<string> = new Set()

interface Edit {
  readonly callId: string
  readonly tasks: readonly DraftTask[]
  readonly failure: Failure | null
}

/** What the agent was last told the proposal is, as `proposedOf` gives it. */
interface Told {
  readonly callId: string
  readonly tasks: string
}

const toldOf = (tasks: readonly DraftTask[]): string => JSON.stringify(proposedOf(tasks))

const columnOf = (target: BrainstormTarget): ColumnId =>
  target.purpose === 'tasks' ? target.column : target.card.status

export interface BrainstormPanelProps {
  readonly brainstorm: Brainstorm
  readonly columns: readonly Column[]
  readonly board: BoardController
  readonly width: number
  readonly onWidth: (width: number) => void
  readonly onClose: () => void
  readonly onDone: () => void
}

export function BrainstormPanel({
  brainstorm,
  columns,
  board,
  width,
  onWidth,
  onClose,
  onDone
}: BrainstormPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()
  const { target, entries, started, working, answerable, failure } = brainstorm
  const [text, setText] = useState('')
  const [edit, setEdit] = useState<Edit | null>(null)
  const [told, setTold] = useState<Told | null>(null)
  const [writing, setWriting] = useState(false)
  // Until `send` answers: `working` waits for the message to come back as a line of the log.
  const [sending, setSending] = useState(false)
  const { answer } = brainstorm
  const skip = useCallback(
    (requestId: string) => {
      answer(requestId, [])
    },
    [answer]
  )

  const shown = useMemo(() => latestProposal(entries), [entries])
  // A new proposal starts from what the agent sent: edits to the one before are its business now.
  const proposed = useMemo(
    () => (shown === null ? null : draftTasks(shown.proposal, columnOf(target))),
    [shown, target]
  )
  const tasks = edit !== null && edit.callId === shown?.callId ? edit.tasks : proposed
  const writeFailure = edit !== null && edit.callId === shown?.callId ? edit.failure : null
  const lastTold =
    told !== null && told.callId === shown?.callId ? told.tasks : toldOf(proposed ?? [])

  const submit = async (): Promise<void> => {
    const typed = text.trim()
    if (typed === '' || working || sending) return
    const now = tasks === null ? null : toldOf(tasks)
    const edited = shown !== null && tasks !== null && now !== lastTold
    setSending(true)
    const sent = await brainstorm.send(edited ? withEditedTasks(typed, proposedOf(tasks)) : typed)
    setSending(false)
    if (!sent) return
    setText('')
    if (edited) setTold({ callId: shown.callId, tasks: toldOf(tasks) })
  }

  const write = async (callId: string, drafts: readonly DraftTask[]): Promise<void> => {
    setWriting(true)
    try {
      if (target.purpose === 'edit') {
        const { title, description, priority, tag } = present(drafts[0], 'the task edited')
        const base = target.card.description
        if (await board.rewrite(target.card.ref, { title, description, priority, tag, base }))
          onDone()
        return
      }
      const created = await board.createMany(cardDraftsOf(drafts))
      if (created === null) return
      if (created.failure === null) {
        onDone()
        return
      }
      const left = drafts.filter((_, index) => created.refs[index] === null)
      setEdit({ callId, tasks: left, failure: created.failure })
    } finally {
      setWriting(false)
    }
  }

  const title =
    target.purpose === 'tasks'
      ? t('board.brainstorm.createTitle')
      : t('board.brainstorm.editTitle', { title: target.card.title })
  const placeholder = started
    ? t('board.brainstorm.replyPlaceholder')
    : target.purpose === 'tasks'
      ? t('board.brainstorm.ideaPlaceholder')
      : t('board.brainstorm.requestPlaceholder')

  return (
    <SidePanel label={title} width={width} onWidth={onWidth}>
      <header className="border-line flex h-10 shrink-0 items-center gap-1.5 border-b px-2">
        <Sparkles aria-hidden size={14} className="text-ink-faint shrink-0" />
        <h2 className="text-ink min-w-0 flex-1 truncate text-[13px] font-semibold">{title}</h2>
        <IconButton label={t('board.brainstorm.close')} onClick={onClose}>
          <X aria-hidden size={14} />
        </IconButton>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        {entries.length === 0 && (
          <p className="text-ink-soft text-[12px]">
            {target.purpose === 'tasks'
              ? t('board.brainstorm.createIntro')
              : t('board.brainstorm.editIntro')}
          </p>
        )}
        <ChatLog
          entries={entries}
          busy={working}
          answerable={answerable}
          answerableElicitations={NONE}
          onAnswer={skip}
          onAnswerElicitation={null}
          onAnswerQuestions={answer}
          onExecutePlan={null}
          onRewind={null}
          waiting={NONE}
          expansion={COLLAPSED}
          workspacePath=""
          onOpenFile={null}
        />
        {shown !== null && tasks !== null && (
          <TaskProposalCard
            purpose={target.purpose}
            summary={shown.proposal.summary}
            tasks={tasks}
            onTasks={(next) => {
              setEdit({ callId: shown.callId, tasks: next, failure: writeFailure })
            }}
            columns={columns}
            writing={writing}
            failure={writeFailure}
            onWrite={() => void write(shown.callId, tasks)}
          />
        )}
        {failure !== null && <Callout tone="warning">{describeFailure(failure)}</Callout>}
      </div>
      <footer className="border-line flex shrink-0 flex-col gap-2 border-t p-2">
        <textarea
          aria-label={placeholder}
          placeholder={placeholder}
          value={text}
          rows={3}
          className="input focus-ring h-auto resize-none py-1.5 text-[13px]"
          onChange={(event) => {
            setText(event.target.value)
          }}
          onKeyDown={(event) => {
            if (!isSubmitEnter(event)) return
            event.preventDefault()
            void submit()
          }}
        />
        <div className="flex justify-end">
          {working ? (
            <Button size="sm" onClick={brainstorm.stop}>
              {t('board.brainstorm.stop')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="accent"
              disabled={text.trim() === '' || sending}
              onClick={() => void submit()}
            >
              {t('board.brainstorm.send')}
            </Button>
          )}
        </div>
      </footer>
    </SidePanel>
  )
}
