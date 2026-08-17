import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { Chat, Effort, WorkingMode } from '@core/chats.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { Placeholder } from '../Placeholder.js'
import { useChat } from '../../hooks/useChat.js'
import type { ChatTab } from '../../hooks/useChatTabs.js'
import type { DiffCommentController } from '../../hooks/useDiffComments.js'
import { useErrorMessage } from '../../hooks/useErrorMessage.js'
import { useCommands } from '../../hooks/useCommands.js'
import { useModels } from '../../hooks/useModels.js'
import { useRateLimit } from '../../hooks/useRateLimit.js'
import { useSessionUsage } from '../../hooks/useSessionUsage.js'
import { ChatLog } from './ChatLog.js'
import { Composer } from './Composer.js'
import { PlanDialog } from './PlanDialog.js'
import { planTitle, readPlan } from './toolSummary.js'

interface ChatSessionProps {
  /**
   * The workspace this conversation acts on.
   *
   * Not nullable: a pane with no workspace selected is a different screen, and
   * `App` shows it instead — the way out of that state is to create one, which
   * is not something the chat knows how to do.
   */
  readonly workspace: WorkspaceView
  /** Which of the workspace's conversations this is. */
  readonly tab: ChatTab
  /**
   * Whether this is the tab on screen.
   *
   * Passed rather than left to the parent's `hidden` class, because two things
   * here have to know. A hidden element measures zero, so the log would pin
   * itself to the top of a conversation it cannot see and stay there; and the
   * plan dialog is a modal, which a background conversation has no business
   * raising over the one being read.
   */
  readonly visible: boolean
  /** Tells the strip about the record this pane created on first use. */
  readonly onOpened: (chat: Chat) => void
  /** What was in the composer when this conversation was last left. */
  readonly draft: string
  /** Where that text goes on the way out; `App` keeps one per tab. */
  readonly onDraftLeave: (text: string) => void
  /** Review notes from the diff pane, riding out with the next message. */
  readonly comments: DiffCommentController
  /**
   * What the settings say a new conversation starts with.
   *
   * Passed in rather than read here because the footer has to name what
   * `openChat` will actually create the record with — and it creates it from
   * the config. Hardcoding the schema's defaults instead made the control lie
   * for exactly one message: the first.
   */
  readonly defaultWorkingMode: WorkingMode
  readonly defaultEffort: Effort
}

/**
 * One conversation: its log, its composer and what it is waiting on.
 *
 * Up to three of these are mounted at once, one per tab, and only one is
 * showing — the same arrangement the right pane uses for its own tabs, and for
 * the same reason: a conversation that unmounted would lose its scroll position
 * and the answer half-streamed into it every time you looked at another.
 */
export function ChatSession({
  workspace,
  tab,
  visible,
  onOpened,
  draft,
  onDraftLeave,
  comments,
  defaultWorkingMode,
  defaultEffort
}: ChatSessionProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()
  const chat = useChat(tab.record, workspace.id, tab.status, describeFailure, onOpened)
  const rateLimit = useRateLimit()
  const models = useModels()
  const commands = useCommands(chat.chat?.id ?? null)
  const usage = useSessionUsage(chat.chat?.id ?? null)

  const scroller = useRef<HTMLDivElement | null>(null)
  const pinnedToBottom = useRef(true)

  // Answered here rather than in the log because this is where the pending
  // request and the composer's mode meet — the plan's approval decides what the
  // agent may do next, and that is the setting sitting in the footer below.
  const pending = chat.pending
  const plan = pending === null ? null : readPlan(pending.toolName, pending.input)

  // The record wins wherever there is one, and the settings answer for the
  // conversation that does not exist yet.
  const record = chat.chat
  const workingMode = record?.workingMode ?? defaultWorkingMode
  const effort = record?.effort ?? defaultEffort

  // Follows the conversation, but only while the user is already at the end of
  // it — yanking the view down while they read something further up is the
  // single most irritating thing a log can do.
  //
  // Skipped entirely while the tab is hidden, and run again when it comes back.
  // A `display:none` element has no height at all, so `scrollHeight` is 0 and
  // this would quietly scroll a background conversation to the top on every
  // event it received — which is exactly when a background conversation is
  // worth coming back to.
  useEffect(() => {
    const element = scroller.current
    if (!visible || !element || !pinnedToBottom.current) return

    element.scrollTop = element.scrollHeight
  }, [visible, chat.entries, chat.streaming])

  return (
    <div
      aria-hidden={!visible}
      className={`min-h-0 flex-1 flex-col ${visible ? 'flex' : 'hidden'}`}
    >
      <div
        ref={scroller}
        // A log rather than a plain box: the content appends over time, which
        // is what tells a screen reader to announce additions rather than
        // re-read the conversation from the top.
        role="log"
        onScroll={(event) => {
          const element = event.currentTarget
          const distance = element.scrollHeight - element.scrollTop - element.clientHeight
          // A few pixels of slack: smooth scrolling and sub-pixel heights mean
          // "at the bottom" is rarely exactly zero.
          pinnedToBottom.current = distance < 40
        }}
        className="min-h-0 flex-1 overflow-auto"
      >
        {chat.error !== null && (
          <div className="mx-auto w-full max-w-6xl px-6 pt-5">
            <p className="bg-danger-bg text-danger border-danger/25 rounded-[var(--radius-control)] border px-3 py-2">
              {chat.error}
            </p>
          </div>
        )}

        {/* Streaming counts as content even before the first entry lands:
            without it the answer to the very first message would draw over the
            placeholder, and the pane would say "start the conversation" while
            the agent was replying to it. */}
        {chat.entries.length === 0 &&
        !chat.loading &&
        !chat.busy &&
        chat.streaming.text === '' &&
        chat.streaming.thinking === '' ? (
          <Placeholder title={t('chat.emptyTitle')}>{t('chat.emptyBody')}</Placeholder>
        ) : (
          <ChatLog
            entries={chat.entries}
            streaming={chat.streaming}
            busy={chat.busy}
            pendingRequestId={pending?.requestId ?? null}
            onAnswer={(requestId, answer) => void chat.answer(requestId, answer)}
            onAnswerQuestions={(requestId, answers) =>
              void chat.answerQuestions(requestId, answers)
            }
            // Sent as an ordinary message, because that is what it is: the
            // request it belonged to was answered when the dialog closed, and
            // there is nothing left to approve. Naming the plan matters — by
            // the time anyone comes back to one the conversation may hold
            // several, and "the plan above" would be the agent's guess.
            //
            // Planning is turned off first, and not only for the toggle's
            // sake: that is what hands the session the mode named in the
            // footer. Without it the message went out while the conversation
            // was still recorded as planning, and the agent worked in whatever
            // mode it happened to fall back to — asking about every edit under
            // a footer that said it would not.
            onExecutePlan={(plan) => {
              void (async () => {
                await chat.setPlanMode(false)
                await chat.send(t('chat.executePlanMessage', { title: planTitle(plan) }))
              })()
            }}
          />
        )}
      </div>

      {/* Only while showing. This is a modal, and a conversation nobody is
          looking at raising one over the conversation being read is the worst
          kind of interruption: it is about work the reader cannot see, and it
          takes the keyboard from work they can. The tab's dot turns amber
          instead, which is how the workspace list already announces a turn
          waiting somewhere nobody is looking. */}
      {visible && plan !== null && pending !== null && (
        <PlanDialog
          plan={plan}
          onExecute={() => void chat.answer(pending.requestId, 'allow')}
          onKeepPlanning={(feedback) => void chat.answer(pending.requestId, 'deny', feedback)}
        />
      )}

      <Composer
        initialDraft={draft}
        onDraftLeave={onDraftLeave}
        busy={chat.busy}
        workingMode={workingMode}
        onWorkingMode={(mode) => void chat.setWorkingMode(mode)}
        planMode={record?.planMode ?? false}
        onPlanMode={(planning) => void chat.setPlanMode(planning)}
        effort={effort}
        onEffort={(level) => void chat.setEffort(level)}
        model={record?.model ?? null}
        onModel={(model) => void chat.setModel(model)}
        models={models}
        // What the session reports it is running, which the picker shows when
        // nothing was chosen here. It rides in with the context reading, so it
        // refreshes on the same `result` the token count does.
        activeModel={usage.context?.model ?? null}
        commands={commands}
        usage={usage}
        limit={rateLimit}
        onSend={(text) => void chat.send(text)}
        onStop={() => void chat.interrupt()}
        comments={comments.pending}
        onRemoveComment={comments.remove}
        onCommentsSent={comments.clear}
      />
    </div>
  )
}
