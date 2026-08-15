import { GitBranch } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { Effort, WorkingMode } from '@core/chats.js'
import type { ProjectColor } from '@core/colors.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { Placeholder } from '../Placeholder.js'
import { useChat } from '../../hooks/useChat.js'
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

interface ChatProps {
  /**
   * The workspace this conversation acts on.
   *
   * Not nullable: a pane with no workspace selected is a different screen, and
   * `App` shows it instead — the way out of that state is to create one, which
   * is not something the chat knows how to do.
   */
  readonly workspace: WorkspaceView
  /** What was in the composer when this workspace was last left. */
  readonly draft: string
  /** Where that text goes on the way out; `App` keeps one per workspace. */
  readonly onDraftLeave: (text: string) => void
  /** Review notes from the diff pane, riding out with the next message. */
  readonly comments: DiffCommentController
  /**
   * The project's colour, for the messages you sent.
   *
   * The project rather than the workspace: workspaces of one project are
   * shades of the same work, and the colour is what says which project the
   * window is in — the tab strip and the sidebar already read that way.
   *
   * Not nullable: the centre shows a placeholder until a project is open, so a
   * chat without one is a state that never renders.
   */
  readonly color: ProjectColor
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
 * The agent chat — the centre of the window (§10.8 docs/PROJECT.md).
 *
 * Scoped to one workspace, because that is what the conversation acts on: its
 * worktree is the agent's working directory and its branch is where the work
 * lands. Selecting a different workspace shows a different conversation, not a
 * continuation of this one.
 */
export function Chat({
  workspace,
  draft,
  onDraftLeave,
  comments,
  color,
  defaultWorkingMode,
  defaultEffort
}: ChatProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()
  const chat = useChat(workspace.id, describeFailure)
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
  useEffect(() => {
    const element = scroller.current
    if (!element || !pinnedToBottom.current) return

    element.scrollTop = element.scrollHeight
  }, [chat.entries, chat.streaming])

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      // The sanctioned inline style (§10.4): the value is dynamic but still
      // resolves to a token, and setting it on the container is what lets the
      // stylesheet own how the colour is used rather than each component.
      style={{ '--project-color': `var(--project-${color})` } as React.CSSProperties}
    >
      <header className="border-line flex h-9 shrink-0 items-center gap-3 border-b px-6">
        {/* The branch alone, marked as one. A workspace branch is made from
            the workspace name, so `anna ytsykvas/anna` was the same word twice
            — and the branch is what a workspace is identified by anyway. */}
        <span className="text-ink-soft flex min-w-0 items-center gap-1.5">
          <GitBranch aria-hidden size={13} className="shrink-0" />
          <span className="truncate font-mono text-[11px]">{workspace.branch}</span>
        </span>
      </header>

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

      {plan !== null && pending !== null && (
        <PlanDialog
          plan={plan}
          onExecute={() => void chat.answer(pending.requestId, 'allow')}
          onKeepPlanning={(feedback) => void chat.answer(pending.requestId, 'deny', feedback)}
        />
      )}

      <Composer
        /*
         * Remounted per workspace, which is what stops a sentence typed for one
         * being sent to another — it went to that agent, in that worktree, on
         * that branch, with the text still in the field saying otherwise.
         *
         * A key rather than a reset, because the two states derived from the
         * text go with it: the highlighted command and the dismissed hint would
         * otherwise be left pointing at words that have gone.
         */
        key={workspace.id}
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
