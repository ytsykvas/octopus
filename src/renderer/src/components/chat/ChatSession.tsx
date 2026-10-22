import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, ChevronUp, CloudDownload } from 'lucide-react'

import {
  type Chat,
  type Effort,
  findAgentModel,
  modeAfterPlan,
  opusPlanSplit,
  type PlanExecutionMode,
  type WorkingMode
} from '@core/chats.js'
import { callsAbove } from '@core/backgroundTasks.js'
import type { FormValues } from '@core/elicitation.js'
import type { QuestionAnswer } from '@core/questions.js'
import type { PermissionAnswer } from '@core/service.js'
import type { SideExchange } from '@core/sideQuestions.js'
import { latestTodos } from '@core/todos.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { EnvProfileSwitch } from '../EnvProfileSwitch.js'
import { IconButton } from '../paneControls.js'
import { Placeholder } from '../Placeholder.js'
import { useAttachments } from '../../hooks/useAttachments.js'
import { onChatEvent } from '../../hooks/chatEvents.js'
import { stopTask, useChatTasks } from '../../hooks/backgroundTasks.js'
import { useChat } from '../../hooks/useChat.js'
import type { ChatTab } from '../../hooks/useChatTabs.js'
import type { AttachedFileController } from '../../hooks/useAttachedFiles.js'
import type { CodeNoteController } from '../../hooks/useCodeNotes.js'
import type { DiffCommentController } from '../../hooks/useDiffComments.js'
import type { PullRequestQuoteController } from '../../hooks/usePullRequestQuotes.js'
import { type ChatNote, mergeNotes } from './attachments.js'
import { useErrorMessage } from '../../hooks/useErrorMessage.js'
import { useAgents } from '../../hooks/useAgents.js'
import { useCommands } from '../../hooks/useCommands.js'
import { useEnvProfiles } from '../../hooks/useEnvProfiles.js'
import { useDayAtTop } from '../../hooks/useDayAtTop.js'
import { useMessageSteps } from '../../hooks/useMessageSteps.js'
import { useModels } from '../../hooks/useModels.js'
import { useRateLimit } from '../../hooks/useRateLimit.js'
import { useRewindChoice } from '../../hooks/useRewindChoice.js'
import { useSessionUsage } from '../../hooks/useSessionUsage.js'
import type { SideQuestionController } from '../../hooks/useSideQuestions.js'
import { useSkills } from '../../hooks/useSkills.js'
import { shortModel } from './agentFormat.js'
import { AgentLogContext, type Agents, AgentsContext, createAgentsStore } from './agentTasks.js'
import { ChatLog, StreamingContext } from './ChatLog.js'
import { COLLAPSED, type Expansion } from './expansion.js'
import { DayChip } from './DayChip.js'
import { Composer } from './Composer.js'
import { HeadsUp } from './HeadsUp.js'
import { PlanDialog } from './PlanDialog.js'
import { PlanWaiting } from './PlanWaiting.js'
import { SideQuestions } from './SideQuestions.js'
import { TodoPanel } from './TodoPanel.js'
import { currentTip } from './tips.js'
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
  /** Remarks carried in from the review on this branch's pull request. */
  readonly quotes: PullRequestQuoteController
  /**
   * Notes written in the file viewer. Unlike the two above these are aimed:
   * this conversation shows and sends only the ones addressed to its tab.
   */
  readonly codeNotes: CodeNoteController
  /** The files this conversation's next message names, under its tab's key. */
  readonly attachedFiles: AttachedFileController
  /** Each conversation's `/btw` thread, held by `App` so it outlives this pane. */
  readonly sideQuestions: SideQuestionController
  /** Opens a conversation continuing this one from a side answer; says whether it did. */
  readonly onForkSide: (chatId: string, exchange: SideExchange) => Promise<boolean>
  /**
   * What the settings say a new conversation starts with.
   *
   * Passed in rather than read here because the footer has to name what
   * `openChat` will actually create the record with — and it creates it from
   * the config. Hardcoding the schema's defaults instead made the control lie
   * for exactly one message: the first.
   */
  readonly defaultWorkingMode: WorkingMode
  /** What an approved plan is carried out in, from the settings. */
  readonly planExecutionMode: PlanExecutionMode
  readonly defaultEffort: Effort
  /** The settings' model pair, for the same reason as the two above. */
  readonly defaultModel: string | null
  readonly defaultPlanModel: string | null
  /** Opens the settings on skills, for a conversation that has none to switch. */
  readonly onOpenSkillSettings: () => void
  /** The workspace was just made, so this conversation's field takes the caret. */
  readonly focusComposer: boolean
  /** The set of variables the project uses, until the list is read. */
  readonly projectEnvProfile: string
  /** The workspace's record changed, and the list should be read again. */
  readonly onWorkspacesChanged: () => void
  /** Heads-ups the user said they already knew, from the settings. */
  readonly dismissedTips: readonly string[]
  /** "I knew this" on a heads-up — kept in the settings, for every conversation. */
  readonly onDismissTip: (id: string) => void
  /** Opens a workspace-relative path in the centre: kept open, or as a preview. */
  readonly onOpenFile: (path: string, pinned: boolean) => void
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
  quotes,
  codeNotes,
  attachedFiles,
  sideQuestions,
  onForkSide,
  defaultWorkingMode,
  planExecutionMode,
  defaultEffort,
  defaultModel,
  defaultPlanModel,
  onOpenSkillSettings,
  focusComposer,
  projectEnvProfile,
  onWorkspacesChanged,
  dismissedTips,
  onDismissTip,
  onOpenFile
}: ChatSessionProps): React.JSX.Element {
  const { t } = useTranslation()

  /*
   * Whether every row of the log is open — Claude Code's ctrl+o, here ⌘O.
   *
   * Per conversation and in memory only: a reading mode for the moment, and a
   * log reopened with every row open would mount every diff in it at once.
   */
  const [expansion, setExpansion] = useState<Expansion>(COLLAPSED)
  const toggleExpansion = useCallback(() => {
    setExpansion((current) => ({
      ...current,
      all: !current.all,
      generation: current.generation + 1
    }))
  }, [])

  useEffect(() => {
    if (!visible) return

    const onKey = (event: KeyboardEvent): void => {
      // A dialog owns the keyboard while it is open, as the window's own
      // shortcuts already treat it.
      if (document.querySelector('dialog[open]') !== null) return
      if (!event.metaKey || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'o') {
        return
      }

      event.preventDefault()
      toggleExpansion()
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [visible, toggleExpansion])

  /*
   * The window's opener, kept where a steady handler can read it: the pane
   * above writes it inline, and handed to the log as it came it would be a new
   * function on every render — which would redraw every tool row for every
   * token the answer streams in.
   */
  const opener = useRef(onOpenFile)
  useEffect(() => {
    opener.current = onOpenFile
  }, [onOpenFile])
  const openFile = useCallback((path: string, pinned: boolean) => {
    opener.current(path, pinned)
  }, [])

  /* An attachment that could not be taken — a paste too large, a dialog that
     failed — shown in the conversation's own banner rather than a second one:
     it is the same kind of news about the same message. */
  // A refusal that is news about the message being written, or about something
  // done to the conversation from its log — one banner for both, as the log has
  // one place it says things.
  const [notice, setNotice] = useState<string | null>(null)
  const attachments = useAttachments(setNotice, attachedFiles, tab.key)
  const { choose: chooseRewind, dialog: rewindDialog } = useRewindChoice()
  /* A rewound message on its way back into the composer. The id is what makes
     the same text handed back twice a second instruction rather than nothing. */
  const [seed, setSeed] = useState<{ text: string; id: number; append?: boolean } | undefined>(
    undefined
  )
  // A plan the user is rewriting, by the request it belongs to. Kept here so
  // that looking at another tab does not throw the edits away.
  const [planEdit, setPlanEdit] = useState<{ requestId: string; text: string } | null>(null)
  // The note being written back to it, for the same reason and one more: the
  // dialog unmounts while it is minimised.
  const [planNote, setPlanNote] = useState<{ requestId: string; text: string } | null>(null)
  // The plan whose dialog was set aside, by request: the next plan the agent
  // hands over is a new question, and raises its dialog as any other would.
  const [minimizedPlan, setMinimizedPlan] = useState<string | null>(null)
  const describeFailure = useErrorMessage()
  /*
   * Read here as well as in the Run row: the first message is where a task
   * starts, and whether the work behind it runs against production or staging
   * data is a question for that moment, not for after the build. One hook, so
   * the two places cannot disagree about what is stored.
   *
   * A failure goes to the conversation's own banner, which is the news about
   * this workspace on screen; clearing is left to the banner's own owners.
   */
  const env = useEnvProfiles(
    workspace.projectId,
    projectEnvProfile,
    (message) => {
      if (message !== null) setNotice(message)
    },
    onWorkspacesChanged
  )
  const chat = useChat(
    tab.record,
    workspace.id,
    tab.status,
    describeFailure,
    onOpened,
    planExecutionMode,
    visible
  )

  // Held against the entries, like the log's own walks: this reads the whole
  // transcript, and it is asked on every render of a pane that re-renders on
  // every streamed token.
  const todos = useMemo(() => latestTodos(chat.entries) ?? [], [chat.entries])

  // Closed here without "I knew this": gone from this conversation while its
  // workspace is open, and back once `App` rebuilds the pane for another one —
  // which is the difference between the two buttons.
  const [closedTips, setClosedTips] = useState<ReadonlySet<string>>(new Set())
  /* Only between turns: one arriving mid-turn would push the field up while
     the agent is still writing, and the moment it is worth reading is when
     the next message is about to be typed. */
  const tip = useMemo(
    () => (chat.busy ? null : currentTip(chat.entries, new Set([...dismissedTips, ...closedTips]))),
    [chat.busy, chat.entries, dismissedTips, closedTips]
  )
  const rateLimit = useRateLimit()
  const models = useModels()
  const commands = useCommands(chat.chat?.id ?? null)
  const agents = useAgents(chat.chat?.id ?? null)
  // Moved once a choice that moves the session has been applied — a window, a
  // model, a mode — so the reading is taken again; see `useSessionUsage`.
  const [sessionMoves, setSessionMoves] = useState(0)
  const moved = useCallback(() => {
    setSessionMoves((count) => count + 1)
  }, [])
  const usage = useSessionUsage(chat.chat?.id ?? null, sessionMoves)
  const skills = useSkills(chat.chat?.id ?? null, workspace.id, chat.ensure)

  const sideChatId = chat.chat?.id ?? null
  const { ensure } = chat
  const {
    ask: askAside,
    setOpen: setSideOpen,
    clear: clearSide,
    forget: forgetSide
  } = sideQuestions
  // A record-less conversation gets one first: the question needs it.
  const withRecord = useCallback(
    async (act: (chatId: string) => unknown) => {
      const record = await ensure()
      if (record !== null) await act(record.id)
    },
    [ensure]
  )
  const openSide = useCallback(
    (open: boolean) => {
      void withRecord((chatId) => {
        setSideOpen(chatId, open)
      })
    },
    [setSideOpen, withRecord]
  )
  const askSide = useCallback(
    (question: string) => {
      if (question === '') openSide(true)
      else void withRecord((chatId) => askAside(chatId, question))
    },
    [openSide, askAside, withRecord]
  )
  // The drawer goes once the fork is open, as the CLI's panel does: the
  // answer has moved on into the new tab.
  const forkSide = useCallback(
    (exchange: SideExchange) =>
      withRecord(async (chatId) => {
        if (await onForkSide(chatId, exchange)) setSideOpen(chatId, false)
      }),
    [onForkSide, setSideOpen, withRecord]
  )
  // A thread about a conversation that was cleared or cut back would be
  // replayed to the agent as context it no longer has.
  useEffect(() => {
    if (sideChatId === null) return
    return onChatEvent(({ event }) => {
      if (
        (event.type === 'conversation_reset' && event.cleared) ||
        event.type === 'conversation_rewound'
      ) {
        forgetSide(sideChatId)
      }
    }, sideChatId)
  }, [sideChatId, forgetSide])

  /*
   * `/model opusplan` is the one `/model` the record follows.
   *
   * The CLI scopes the command to the session, so the chat's two model settings
   * stayed null and the panel drew Opus on both rows over a session running
   * two. What the alias asks for is exactly a split, so once the message has
   * gone the same split is written through the calls the panel itself uses —
   * which is also the only way a window learns a record changed.
   *
   * After the send and only when it was accepted: a refused message leaves the
   * panel as it was rather than showing a command that never ran.
   *
   * Planning first, and the second only if the first took. A pair written in
   * the other order and left half done put Sonnet under both jobs — and the
   * session had been told, so planning would have run on it. Planning first, a
   * refusal at either step leaves the record unchanged or leaves the writing
   * model on the default, which is what the panel showed before. The error is
   * on the banner in both cases.
   */
  const { send: sendMessage, setModel, setPlanModel } = chat
  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const sent = await sendMessage(text)
      const split = sent ? opusPlanSplit(text, commands, models) : null

      if (split !== null && (await setPlanModel(split.planModel))) {
        await setModel(split.model)
      }

      return sent
    },
    [sendMessage, setModel, setPlanModel, commands, models]
  )

  const scroller = useRef<HTMLDivElement | null>(null)
  const logContent = useRef<HTMLDivElement | null>(null)

  /*
   * What the conversation has running beside it, for every part of this pane
   * that draws it — see `AgentsContext`.
   */
  const chatId = chat.chat?.id ?? tab.id ?? ''
  const tasks = useChatTasks(chatId, chat.entries)

  /*
   * "Show in conversation": the agent's row is opened up to — a nested one is
   * drawn only inside its parent's opened row, so every row above it is
   * revealed first — and brought into view once it is on the page.
   */
  const [shownAgent, setShownAgent] = useState<{ readonly toolUseId: string } | null>(null)
  const showAgent = useCallback(
    (toolUseId: string) => {
      const above = callsAbove(tasks, toolUseId)
      setExpansion((current) => ({ ...current, reveal: above, revealed: current.revealed + 1 }))
      setShownAgent({ toolUseId })
    },
    [tasks]
  )
  // Found in this pane's own log — three panes are mounted at once.
  useLayoutEffect(() => {
    if (shownAgent === null) return
    // The log is drawn whenever there is an agent to show: the map is reached
    // from the count, which a pane with no log does not have.
    /* v8 ignore next 3 */
    const row = [
      ...(logContent.current?.querySelectorAll<HTMLElement>('[data-tool-use-id]') ?? [])
    ].find((element) => element.dataset.toolUseId === shownAgent.toolUseId)
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    row?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
  }, [shownAgent])

  // The tasks go into a store of the pane's own and the context holds still —
  // see `AgentsContext` for why the rows must not be redrawn by every move.
  // Published before the paint, so a row never shows a reading one commit old.
  const [agentsStore] = useState(createAgentsStore)
  useLayoutEffect(() => {
    agentsStore.publish(tasks)
  }, [agentsStore, tasks])
  const agentTasks = useMemo<Agents>(
    () => ({
      store: agentsStore,
      // The picker's name for a model it offers; a subagent can run on one it
      // does not, which is named as a person would.
      modelName: (model) => findAgentModel(models, model)?.displayName ?? shortModel(model),
      onStop: (taskId) => {
        stopTask(chatId, taskId)
      },
      onShow: showAgent
    }),
    [agentsStore, models, chatId, showAgent]
  )
  const pinnedToBottom = useRef(true)
  // More than a screen above the end: where the way back down is worth a button.
  const [farFromEnd, setFarFromEnd] = useState(false)
  const dayAtTop = useDayAtTop(scroller)
  const steps = useMessageSteps(scroller)
  const { update: updateDayAtTop } = dayAtTop
  const { update: updateSteps } = steps
  const measureFloating = useCallback(() => {
    updateDayAtTop()
    updateSteps()
  }, [updateDayAtTop, updateSteps])

  // Answered here rather than in the log because this is where the pending
  // request and the composer's mode meet — the plan's approval decides what the
  // agent may do next, and that is the setting sitting in the footer below.
  const pending = chat.pending
  const plan = pending === null ? null : readPlan(pending.toolName, pending.input)

  // The record wins wherever there is one, and the settings answer for the
  // conversation that does not exist yet.
  const record = chat.chat

  /*
   * Rewinds to before a message: the conversation, the files, or both.
   *
   * Asked in two steps, and the first changes nothing: what each half *would*
   * do is fetched first, so the choice the user makes has the numbers and the
   * reasons in it. A rewind can overwrite files — including any the user
   * edited since — and drop part of the conversation, so it is never taken on
   * a click alone.
   */
  const recordId = record?.id ?? null
  const rewind = useCallback(
    async (messageId: string): Promise<void> => {
      // The log draws a message's mark only once there is a conversation record,
      // so this cannot be reached without one; the guard is for the type.
      /* v8 ignore next */
      if (recordId === null) return

      setNotice(null)
      const preview = await window.octopus.chats.rewindPreview(recordId, messageId)
      if (!preview.ok) {
        setNotice(describeFailure(preview))
        return
      }

      const scope = await chooseRewind(preview.value)
      if (scope === null) return

      const done = await window.octopus.chats.rewind(recordId, messageId, scope)
      if (!done.ok) {
        setNotice(describeFailure(done))
        return
      }

      const text = done.value.text
      if (text === null) return

      // The message, back in the field to be edited and sent again; the log is
      // re-read by `useChat` when the core says the conversation was rewound.
      // The end of the log is where the reader now is, and the session the
      // context gauge read from has been closed.
      setSeed((current) => ({ text, id: (current?.id ?? 0) + 1 }))
      pinnedToBottom.current = true
      moved()
    },
    [recordId, chooseRewind, describeFailure, moved]
  )

  /*
   * What the log is handed, held still.
   *
   * The log is memoised, and a handler rebuilt on every render here would undo
   * that: every row drawn again on each streamed token, each poll, each key
   * pressed in the composer.
   */
  const { answer, answerElicitation, answerQuestions, setMode } = chat
  const answerInLog = useCallback(
    (requestId: string, decision: PermissionAnswer) => void answer(requestId, decision),
    [answer]
  )
  const answerElicitationInLog = useCallback(
    (requestId: string, decision: 'accept' | 'decline', values?: FormValues) =>
      void answerElicitation(requestId, decision, values),
    [answerElicitation]
  )
  const answerQuestionsInLog = useCallback(
    (requestId: string, answers: readonly QuestionAnswer[]) =>
      void answerQuestions(requestId, answers),
    [answerQuestions]
  )
  const rewindInLog = useCallback((messageId: string) => void rewind(messageId), [rewind])
  // Sent as an ordinary message, because that is what it is: the request it
  // belonged to was answered when the dialog closed, and there is nothing left
  // to approve. Naming the plan matters — by the time anyone comes back to one
  // the conversation may hold several, and "the plan above" would be the
  // agent's guess.
  //
  // Planning is turned off first, and not only for the control's sake: that is
  // what hands the session the mode the footer names. Without it the message
  // went out while the conversation was still recorded as planning, and the
  // agent worked in whatever mode it happened to fall back to. The mode an
  // approved plan gets in the core — this is the same plan, approved later —
  // and, as there, only out of planning: a plan the agent offered unasked does
  // not lift a conversation out of Manual.
  const executePlan = useCallback(
    (plan: string) => {
      void (async () => {
        if (record?.planMode === true) {
          await setMode(modeAfterPlan(record, planExecutionMode))
        }
        await sendMessage(t('chat.executePlanMessage', { title: planTitle(plan) }))
      })()
    },
    [record, planExecutionMode, setMode, sendMessage, t]
  )
  const workingMode = record?.workingMode ?? defaultWorkingMode
  const effort = record?.effort ?? defaultEffort
  /* Null until a conversation says otherwise, which is most of them: there is
     no application-wide effort for planning and there should not be. */
  const planEffort = record?.planEffort ?? null
  // Both models, as stored. `Composer` works out which of them the next message
  // will run with; the record holds two settings, not a state.
  const model = record === null ? defaultModel : record.model
  const planModel = record === null ? defaultPlanModel : record.planModel

  // Follows the conversation, but only while the user is already at the end of
  // it — yanking the view down while they read something further up is the
  // single most irritating thing a log can do.
  //
  // Skipped entirely while the tab is hidden, and run again when it comes back.
  // A `display:none` element has no height at all, so `scrollHeight` is 0 and
  // this would quietly scroll a background conversation to the top on every
  // event it received — which is exactly when a background conversation is
  // worth coming back to.
  //
  // On the entries and not on what streams in: a flush renders the tail of the
  // log and not this pane, and the tail growing is what the observer below
  // follows.
  useEffect(() => {
    const element = scroller.current
    if (!visible || !element || !pinnedToBottom.current) return

    element.scrollTop = element.scrollHeight
  }, [visible, chat.entries])

  const isEmpty = chat.entries.length === 0 && !chat.loading && !chat.busy && !chat.streaming

  // Rows grow after they are first laid out — markdown, highlighted code — so
  // the scroll above can land short of the end. Followed here for as long as the
  // reader has not left the end.
  //
  // The scroller is watched as well, and both re-read what floats over the log:
  // a row opened, or the window resized, moves the log without a scroll event.
  useEffect(() => {
    const element = scroller.current
    const content = logContent.current
    if (!visible || !element || !content) return

    const observer = new ResizeObserver(() => {
      if (pinnedToBottom.current) element.scrollTop = element.scrollHeight
      measureFloating()
    })
    observer.observe(content)
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
    // The wrapper only exists once there is a log to hold.
  }, [visible, isEmpty, measureFloating])

  // Read again whenever the log can have moved under a still scroller: a turn
  // landing, or the tab coming back. Hidden, there is nothing to measure.
  useEffect(() => {
    if (visible) measureFloating()
  }, [visible, chat.entries, measureFloating])

  const hasUserMessage = useMemo(
    () => chat.entries.some((entry) => entry.role === 'user'),
    [chat.entries]
  )

  return (
    <AgentsContext.Provider value={agentTasks}>
      <AgentLogContext.Provider value={chat.entries}>
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
              // Hiding the tab resets the scroll position and says so; with no
              // height there is nothing to measure, and reading it as "scrolled
              // away from the end" would stop the log following for good.
              if (element.clientHeight === 0) return
              const distance = element.scrollHeight - element.scrollTop - element.clientHeight
              // A few pixels of slack: smooth scrolling and sub-pixel heights mean
              // "at the bottom" is rarely exactly zero.
              pinnedToBottom.current = distance < 40
              setFarFromEnd(distance > element.clientHeight)
              measureFloating()
            }}
            // Never sideways: wide content (code, tables, diffs) scrolls inside its own box.
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
          >
            {/* One floating row: "show every step", the day on screen once its
            own separator has scrolled away, and the steps between the user's
            messages. Sticky only works on a child of the scroller itself, and
            zero-height so it lays nothing out — it draws over the log rather
            than pushing it down. A column each, so the day cannot draw over a
            button in a narrow pane; `items-start`, or the row's stretch squeezes
            the pill to the row's zero height. */}
            {chat.entries.length > 0 && (
              <div className="pointer-events-none sticky top-2 z-10 grid h-0 grid-cols-[1fr_auto_1fr] items-start gap-2 overflow-visible px-3">
                <div className="justify-self-start">
                  <IconButton
                    floating
                    label={t(expansion.all ? 'chat.collapseAll' : 'chat.expandAll')}
                    pressed={expansion.all}
                    onClick={toggleExpansion}
                  >
                    {expansion.all ? (
                      <ChevronsDownUp aria-hidden size={14} />
                    ) : (
                      <ChevronsUpDown aria-hidden size={14} />
                    )}
                  </IconButton>
                </div>
                <div>{dayAtTop.day !== null && <DayChip day={dayAtTop.day} floating />}</div>
                {hasUserMessage && (
                  <div className="flex gap-1 justify-self-end">
                    <IconButton
                      floating
                      label={t('chat.previousMessage')}
                      disabled={!steps.canUp}
                      onClick={() => {
                        steps.step('up')
                      }}
                    >
                      <ChevronUp aria-hidden size={14} />
                    </IconButton>
                    <IconButton
                      floating
                      label={t('chat.nextMessage')}
                      disabled={!steps.canDown}
                      onClick={() => {
                        steps.step('down')
                      }}
                    >
                      <ChevronDown aria-hidden size={14} />
                    </IconButton>
                  </div>
                )}
              </div>
            )}
            {/* Streaming counts as content even before the first entry lands:
            without it the answer to the very first message would draw over the
            placeholder, and the pane would say "start the conversation" while
            the agent was replying to it. */}
            {isEmpty ? (
              <Placeholder
                title={t('chat.emptyTitle')}
                actions={
                  /* Nothing to choose with a single set, so nothing is drawn. */
                  env.profiles.length > 1 ? (
                    <>
                      <span className="text-ink-faint text-[11px]">{t('chat.envLabel')}</span>
                      <EnvProfileSwitch
                        profiles={env.profiles}
                        value={workspace.envProfile ?? env.projectDefault}
                        onChange={(name) => {
                          void env.setWorkspaceProfile(workspace.id, name)
                        }}
                      />
                    </>
                  ) : undefined
                }
              >
                {t('chat.emptyBody')}
              </Placeholder>
            ) : (
              <div ref={logContent}>
                <StreamingContext.Provider value={chat.stream}>
                  <ChatLog
                    entries={chat.entries}
                    busy={chat.busy}
                    waiting={chat.waiting}
                    answerable={chat.answerable}
                    pendingElicitationId={chat.pendingElicitation}
                    onAnswer={answerInLog}
                    onAnswerElicitation={answerElicitationInLog}
                    onAnswerQuestions={answerQuestionsInLog}
                    onRewind={rewindInLog}
                    expansion={expansion}
                    workspacePath={workspace.path}
                    onOpenFile={openFile}
                    onExecutePlan={executePlan}
                  />
                </StreamingContext.Provider>
              </div>
            )}
            {farFromEnd && (
              <div className="pointer-events-none sticky bottom-3 z-10 flex h-0 items-end justify-end overflow-visible px-3">
                <button
                  type="button"
                  onClick={() => {
                    const element = scroller.current
                    // The button lives inside the scroller, so it cannot be clicked
                    // without one; the guard is for the type.
                    /* v8 ignore next */
                    if (!element) return
                    element.scrollTop = element.scrollHeight
                    pinnedToBottom.current = true
                    setFarFromEnd(false)
                  }}
                  title={t('chat.jumpToEnd')}
                  aria-label={t('chat.jumpToEnd')}
                  className="bg-accent text-on-accent hover:bg-accent-hover focus-ring pointer-events-auto grid size-9 place-items-center rounded-full transition-colors"
                >
                  <CloudDownload aria-hidden size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Only while showing. This is a modal, and a conversation nobody is
          looking at raising one over the conversation being read is the worst
          kind of interruption: it is about work the reader cannot see, and it
          takes the keyboard from work they can. The tab's dot turns amber
          instead, which is how the workspace list already announces a turn
          waiting somewhere nobody is looking. */}
          {visible && plan !== null && pending !== null && minimizedPlan !== pending.requestId && (
            <PlanDialog
              // Per request: a plan the agent replaces is a different plan, and the
              // editor's open-or-closed state belongs to the one it was opened on.
              key={pending.requestId}
              plan={plan}
              text={
                planEdit !== null && planEdit.requestId === pending.requestId ? planEdit.text : plan
              }
              onText={(next) => {
                setPlanEdit({ requestId: pending.requestId, text: next })
              }}
              feedback={
                planNote !== null && planNote.requestId === pending.requestId ? planNote.text : ''
              }
              onFeedback={(next) => {
                setPlanNote({ requestId: pending.requestId, text: next })
              }}
              onMinimize={() => {
                setMinimizedPlan(pending.requestId)
              }}
              goesOnIn={record?.planMode === true ? modeAfterPlan(record, planExecutionMode) : null}
              onExecute={(edited) => {
                // The `undefined` where feedback goes: an approval has none, and
                // the plan the user rewrote is the fourth argument.
                void chat.answer(
                  pending.requestId,
                  'allow',
                  undefined,
                  ...(edited === null ? [] : [edited])
                )
              }}
              onKeepPlanning={(feedback) => void chat.answer(pending.requestId, 'deny', feedback)}
            />
          )}

          {/* Only while the agent is working. A list it left with items pending —
          interrupted, errored, or simply abandoned — would otherwise stay
          pinned across every later turn and every restart, describing work
          nobody is doing. The log still holds it. */}
          <TodoPanel todos={chat.busy ? todos : []} />

          {visible && plan !== null && pending !== null && minimizedPlan === pending.requestId && (
            <PlanWaiting
              onOpen={() => {
                setMinimizedPlan(null)
              }}
            />
          )}

          {tip !== null && (
            <HeadsUp
              tip={tip}
              onKnown={() => {
                onDismissTip(tip)
              }}
              onClose={() => {
                setClosedTips((current) => new Set([...current, tip]))
              }}
              // Added to what is being written rather than replacing it, and the
              // heads-up goes for this conversation: its words are in the field
              // now, and a second press would put them in twice.
              onAdd={(text) => {
                setSeed((current) => ({ text, id: (current?.id ?? 0) + 1, append: true }))
                setClosedTips((current) => new Set([...current, tip]))
              }}
            />
          )}

          {/* Beside the field, outside the log. It used to be the log's first
          child, and in a conversation of any length that is thousands of
          pixels above what is on screen: a send that failed looked like an
          agent ignoring the message, for days. What it reports is about the
          message being written, so it sits where that message is. */}
          {(chat.error ?? notice) !== null && (
            <div className="mx-auto w-full max-w-6xl px-6 pt-2">
              <p className="bg-danger-bg text-danger border-danger/25 rounded-[var(--radius-control)] border px-3 py-2">
                {chat.error ?? notice}
              </p>
            </div>
          )}

          <div className="relative">
            <Composer
              initialDraft={draft}
              seed={seed}
              onDraftLeave={onDraftLeave}
              focusOnMount={focusComposer}
              busy={chat.busy}
              workingMode={workingMode}
              planMode={record?.planMode ?? true}
              onMode={(mode) => void chat.setMode(mode).then(moved)}
              effort={effort}
              onEffort={(level) => void chat.setEffort(level)}
              planEffort={planEffort}
              onPlanEffort={(level) => void chat.setPlanEffort(level)}
              onAutoCompact={(window) => {
                void chat.setAutoCompact(window).then(moved)
              }}
              model={model}
              onModel={(chosen) => void chat.setModel(chosen).then(moved)}
              planModel={planModel}
              onPlanModel={(chosen) => void chat.setPlanModel(chosen).then(moved)}
              models={models}
              // What the session reports it is running, which the chip shows when it
              // differs from what was chosen here. It rides in with the context
              // reading, so it refreshes on the same `result` the token count does.
              activeModel={usage.context?.model ?? null}
              commands={commands}
              agents={agents}
              usage={usage}
              limit={rateLimit}
              skills={skills.skills}
              onToggleSkill={skills.toggle}
              onRefreshSkills={skills.refresh}
              onOpenSettings={onOpenSkillSettings}
              onSend={send}
              onStop={() => void chat.interrupt()}
              /* The two queues become one list here rather than in the composer:
           this is already the layer that adapts a controller to a prop, and the
           composer has no business knowing there are two places a note can come
           from. */
              notes={mergeNotes(comments.pending, quotes.pending, codeNotes.pendingFor(tab.key))}
              onRemoveNote={(note: ChatNote) => {
                if (note.kind === 'diff') comments.remove(note)
                else if (note.kind === 'code') codeNotes.remove(tab.key, note)
                else quotes.remove(note)
              }}
              onNotesSent={() => {
                comments.clear()
                quotes.clear()
                codeNotes.clear(tab.key)
                attachments.clear()
              }}
              files={attachments.files}
              onRemoveFile={attachments.remove}
              onAttachFiles={() => {
                setNotice(null)
                void attachments.choose(t('chat.attach'))
              }}
              onDropFiles={attachments.drop}
              onPasteImage={(image) => {
                setNotice(null)
                void attachments.paste(image)
              }}
              onSideQuestion={askSide}
            />

            <SideQuestions
              thread={sideQuestions.threadFor(sideChatId)}
              visible={visible}
              onOpenChange={openSide}
              onAsk={askSide}
              onClear={() => {
                void withRecord(clearSide)
              }}
              onFork={forkSide}
            />
          </div>

          {rewindDialog}
        </div>
      </AgentLogContext.Provider>
    </AgentsContext.Provider>
  )
}
