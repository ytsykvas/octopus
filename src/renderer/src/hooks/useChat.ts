import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  type AutoCompactWindow,
  type Chat,
  type ChatEfforts,
  type ChatModels,
  type ChatStatus,
  EXIT_PLAN_MODE,
  modeAfterPlan,
  type PlanExecutionMode,
  type WorkingMode
} from '@core/chats.js'
import { isEphemeral, isTaskBoundary } from '@core/events.js'
import type { FormValues } from '@core/elicitation.js'
import type { QuestionAnswer } from '@core/questions.js'
import type { PermissionAnswer } from '@core/service.js'
import type { ChatEntry } from '@core/transcript.js'

import type { Failure, Result } from '../../../preload/index.js'
import { useMainWorking } from './backgroundTasks.js'
import { onChatEvent } from './chatEvents.js'
import { type StreamStore, useStreaming } from './useStreaming.js'
import { useLatest } from './useLatest.js'

/** A tool call the agent is blocked on, waiting to be told whether it may run. */
/**
 * The three states the composer's mode control cycles through.
 *
 * Planning is stored apart from the working mode (`chats.ts` says why), and
 * this is the one place the two are presented as a single choice.
 */
export type ChatMode = WorkingMode | 'plan'

/** The record once a plan is approved — the core's rule, `modeAfterPlan`. */
function leavePlanning(chat: Chat, executeIn: PlanExecutionMode): Chat {
  return { ...chat, planMode: false, workingMode: modeAfterPlan(chat, executeIn) }
}

/**
 * Sends an answer, with the plan the user rewrote only when there is one.
 *
 * So an ordinary answer goes out exactly as it did before a plan could be
 * rewritten — three arguments — and the bridge sees a fourth only when it has
 * something to say.
 */
function sendAnswer(
  requestId: string,
  decision: PermissionAnswer,
  feedback: string | undefined,
  editedPlan: string | undefined
): Promise<Result<void>> {
  return editedPlan === undefined
    ? window.octopus.chats.answerPermission(requestId, decision, feedback)
    : window.octopus.chats.answerPermission(requestId, decision, feedback, editedPlan)
}

export interface PendingPermission {
  readonly requestId: string
  readonly toolName: string
  readonly input: unknown
  /** The background agent asking, when it is not the turn. */
  readonly taskId?: string
}

const NO_REQUESTS: readonly PendingPermission[] = []

/** The list without one request, the same list when it was not there. */
function without(
  requests: readonly PendingPermission[],
  requestId: string
): readonly PendingPermission[] {
  return requests.some((request) => request.requestId === requestId)
    ? requests.filter((request) => request.requestId !== requestId)
    : requests
}

const NOTHING_WAITING: ReadonlySet<string> = new Set()

/**
 * How long a message has to sit in the queue before it is marked.
 *
 * Every message passes through `queued`, one sent to an idle agent included —
 * measured, it is `started` two milliseconds later — and the two frames reach
 * the window as separate messages, so marking at once could flash "Queued"
 * under every message sent. A message the agent is really holding waits
 * seconds, so a quarter of one costs nothing.
 */
const QUEUED_AFTER_MS = 250

/** Drops every mark still waiting to be drawn. */
function forgetQueuing(timers: Map<string, ReturnType<typeof setTimeout>>): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
}

/** The set with one message added or taken away, the same set when nothing moved. */
function withWaiting(
  current: ReadonlySet<string>,
  messageId: string,
  waiting: boolean
): ReadonlySet<string> {
  if (current.has(messageId) === waiting) return current

  const next = new Set(current)
  if (waiting) next.add(messageId)
  else next.delete(messageId)
  return next
}

export interface ChatController {
  readonly chat: Chat | null
  readonly entries: readonly ChatEntry[]
  /** What the agent is writing, for the tail of the log alone — see `useStreaming`. */
  readonly stream: StreamStore
  /** Whether the agent is writing something: true from the first fragment drawn to the block's end. */
  readonly streaming: boolean
  /** A turn is in flight: the agent is working, or waiting on an answer. */
  readonly busy: boolean
  /**
   * The messages the agent has not taken yet, by id: sent while it worked, and
   * waiting in the CLI's queue until it folds them in or starts a turn for them.
   */
  readonly waiting: ReadonlySet<string>
  /** The question the turn itself is blocked on, the newest if several, or null. */
  readonly pending: PendingPermission | null
  /**
   * Every question still open, by request id — the turn's and its background
   * agents'. An agent's outlives the turn, so it can be the only one.
   */
  readonly answerable: ReadonlySet<string>
  /**
   * The MCP server's question still open, by request id, or null.
   *
   * Beside `pending` rather than folded into it: a server's question is not a
   * permission, is answered by a different call, and does not put the
   * conversation into `waiting_permission` — the turn is inside a tool call and
   * the agent is not the one asking.
   */
  readonly pendingElicitation: string | null
  /** Answers it, or turns it down. */
  readonly answerElicitation: (
    requestId: string,
    answer: 'accept' | 'decline',
    values?: FormValues
  ) => Promise<void>
  readonly loading: boolean
  readonly error: string | null
  /**
   * Sends a message, answering whether it went.
   *
   * The outcome is reported rather than swallowed because the composer clears
   * on the strength of it: a review is minutes of reading, and dropping it on
   * a send that failed leaves nowhere to get it back from.
   */
  readonly send: (text: string) => Promise<boolean>
  readonly interrupt: () => Promise<void>
  /** `feedback` accompanies a refusal and reaches the agent as the reason. */
  readonly answer: (
    requestId: string,
    answer: PermissionAnswer,
    feedback?: string,
    editedPlan?: string
  ) => Promise<void>
  /** Answers the questions the agent asked, releasing the tool call. */
  readonly answerQuestions: (requestId: string, answers: readonly QuestionAnswer[]) => Promise<void>
  /**
   * Moves the conversation to one of the composer's three modes.
   *
   * One call for what is stored as two fields, so the order they change in is
   * decided here rather than by whoever calls it — see the body for why that
   * order matters.
   */
  readonly setMode: (mode: ChatMode) => Promise<void>
  /** Writing's and planning's effort, either or both, in one write. */
  readonly setEfforts: (efforts: ChatEfforts) => Promise<void>
  /** Where the conversation compacts itself; null hands it back to the agent. */
  readonly setAutoCompact: (window: AutoCompactWindow | null) => Promise<void>
  /**
   * The models for writing code and for planning, either or both, in one
   * write — so a choice that moves both never leaves half of it behind.
   */
  readonly setModels: (models: ChatModels) => Promise<void>
  /**
   * The conversation's record, created if this is the first thing to need one.
   *
   * `openChat` is lazy: a workspace nobody has spoken to has no record, and
   * the settings in the composer's footer already create one the first time
   * any of them is changed. The skills panel is another such setting, and it
   * is the only one that also has something to **show** before that happens —
   * hence this, rather than a second copy of `ensureChat`.
   */
  readonly ensure: () => Promise<Chat | null>
}

/** Turns a failed IPC result into a sentence — what `useErrorMessage` returns. */
type Describe = (failure: Failure) => string

/**
 * One conversation.
 *
 * The history is read from disk once; everything after that arrives as events.
 * The two are deliberately never merged by re-reading the file — an append the
 * UI has already drawn would come back as a duplicate of itself.
 */
export function useChat(
  /**
   * The conversation this pane shows, or null for a tab with no record yet.
   *
   * Null is the ordinary state of the first tab of a workspace nobody has
   * spoken to: the record is written by the first thing done to the pane, so
   * that a workspace merely looked at leaves nothing behind.
   *
   * A seed rather than the source of truth. Once the pane is showing, its own
   * copy is what the footer's pickers are drawn from — a setting is applied
   * here the moment the core agrees, and waiting for the list to be read again
   * would leave the picker showing the old value for a round trip.
   */
  initial: Chat | null,
  /** Where the record will be created, when there is a reason to create one. */
  workspaceId: string | null,
  /**
   * What this conversation is doing, as the core last said.
   *
   * Read as well as the events, because the events are filtered by the open
   * chat's id and there is no chat until its history has loaded — so a turn
   * ending in that window is dropped. Seeding a flag at the switch would leave
   * it stuck on with nothing left to correct it; this corrects itself.
   */
  status: ChatStatus,
  describeFailure: Describe,
  /** Announces the record this pane created, so the tab strip can draw it. */
  onOpened: (chat: Chat) => void,
  /**
   * What an approved plan is carried out in, from the settings. Defaulted to
   * the setting's own default, which is what a config that has not been read
   * yet stands for.
   */
  planExecutionMode: PlanExecutionMode = 'auto',
  /** Whether anybody can see the pane; what streams in while nobody can is drawn when they can. */
  drawn = true
): ChatController {
  const chatId = initial?.id ?? null

  const [chat, setChat] = useState<Chat | null>(initial)
  const [entries, setEntries] = useState<readonly ChatEntry[]>([])
  const {
    stream,
    streaming,
    append: appendStreaming,
    discard: discardStreaming,
    reset: resetStreaming
  } = useStreaming(chat?.id ?? null, drawn)
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState<ReadonlySet<string>>(NOTHING_WAITING)
  /** Messages queued too recently to mark yet, each with the timer that will. */
  const queuing = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [requests, setRequests] = useState<readonly PendingPermission[]>(NO_REQUESTS)
  /** The one MCP question a server is holding open, by its request id. */
  const [pendingElicitation, setPendingElicitation] = useState<string | null>(null)
  const [loading, setLoading] = useState(chatId !== null)
  const [error, setError] = useState<string | null>(null)
  const [shownChatId, setShownChatId] = useState(chatId)

  /*
   * There is deliberately no "is this still the pane on screen" guard here.
   *
   * There used to be one, and it was doing real work: a single instance of this
   * hook was reused for every workspace, so a control request that took longer
   * than the click elsewhere put one conversation's record on another's pane.
   * Each tab now has an instance of its own, kept mounted while its workspace
   * is, and the workspace's own pane is keyed — so an instance is bound to one
   * conversation for its whole life, and a late reply has nowhere else to land.
   * A reply arriving after the pane has gone sets state on an unmounted
   * component, which React ignores.
   */

  /**
   * The record this pane created for itself, so it is not read as an arrival.
   *
   * The first conversation is written by the first message, which means the id
   * reaches the strip and comes back as a prop a render later. Both the reset
   * below and the load beneath it would treat that as a different conversation
   * — wiping the message that created it, and then reading its history back
   * over the copy already drawn.
   */
  const created = useRef<string | null>(null)

  /*
   * The strip's announcer, kept where a steady `ensureChat` can read it: the
   * pane writes it inline, and taken as it came it made `ensureChat` — and
   * everything built on it, down to the log's "carry out this plan" — a new
   * function on every render of the pane, which redrew every row of the log.
   */
  const announce = useLatest(onOpened)

  // Reset during render rather than in an effect. React supports this for
  // state derived from a prop, and it matters here: an effect runs after the
  // paint, so switching conversation would show the previous one for a frame
  // before it cleared.
  if (chatId !== shownChatId) {
    setShownChatId(chatId)

    if (chatId !== chat?.id) {
      setChat(initial)
      setEntries([])
      resetStreaming()
      setBusy(false)
      setRequests(NO_REQUESTS)
      setError(null)
      // Set here rather than in the effect that loads: by the time an effect
      // runs the frame is already on screen, so the pane would flash the empty
      // state before the spinner.
      setLoading(chatId !== null)
    }
  }

  /*
   * The two models, when the settings moved them under this same conversation.
   *
   * The core moves a chat that never chose its own onto new settings and the
   * strip reads the list again, so the record arrives here as a prop with a
   * different pair. Only that pair is taken, not the record: the state beside
   * it is fed by events (a fallback from auto, say) that a re-read made a moment
   * earlier could be older than. A pair chosen from this pane is written to the
   * core first, so it comes back as the same pair and changes nothing.
   */
  const initialModel = initial?.model ?? null
  const initialPlanModel = initial?.planModel ?? null
  const [shownModels, setShownModels] = useState({
    model: initialModel,
    planModel: initialPlanModel
  })
  if (shownModels.model !== initialModel || shownModels.planModel !== initialPlanModel) {
    setShownModels({ model: initialModel, planModel: initialPlanModel })

    if (initial !== null && initial.id === chat?.id) {
      setChat({ ...chat, model: initial.model, planModel: initial.planModel })
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    // Called rather than read: the narrowing TypeScript applies to a checked
    // `aborted` survives an await, and the second check would read as dead.
    const abandoned = (): boolean => controller.signal.aborted

    if (chatId === null || chatId === created.current) return

    void (async () => {
      const history = await window.octopus.chats.history(chatId)
      if (abandoned()) return

      if (history.ok) setEntries(history.value)
      else setError(describeFailure(history))
      setLoading(false)

      // Whether the agent is waiting on an answer. The event that asked went
      // out once, and a window that was not listening then — opened later, or
      // switched away and back — would otherwise show a conversation busy for
      // ever with no way to unblock it. Asked after the history so the log is
      // on screen first; a failure here is not worth an error, since the worst
      // case is the state we were already in.
      const blocked = await window.octopus.chats.pendingPermissions(chatId)
      if (abandoned() || !blocked.ok || blocked.value.length === 0) return

      setRequests(blocked.value)
      // Only the turn's own question means the main agent is mid-turn; an
      // agent's can be open long after the turn ended.
      if (blocked.value.some((request) => request.taskId === undefined)) setBusy(true)
    })()

    return () => {
      controller.abort()
    }
  }, [chatId, describeFailure])

  const openChatId = chat?.id ?? null

  /*
   * This conversation's events, and only this conversation's.
   *
   * Registered by id with the window's one subscription rather than taken from
   * the bridge directly: the bridge hands out a listener per call, and a pane
   * per conversation crossed Node's ceiling — while every pane was woken for
   * every fragment of every other pane's stream and dropped it after comparing
   * an id.
   *
   * Nothing to listen to before there is a record: a pane the user has not
   * written in yet has no conversation to hear from.
   */
  useEffect(() => {
    if (openChatId === null) return
    // A read started here can land after the pane has moved to another
    // conversation; this is what tells it the log it brings is no longer wanted.
    let listening = true

    const release = onChatEvent(({ event }) => {
      if (event.type === 'text_delta') {
        appendStreaming('text', event.text)
        return
      }

      if (event.type === 'thinking_delta') {
        appendStreaming('thinking', event.text)
        return
      }

      /* The conversation was cut back to before a message. The transcript on
         disk is already the shorter one, and it is the record — so it is read
         again rather than the cut repeated here, which would be a second copy
         of where it falls. Every window holding this log hears it; only the
         one that asked puts the message back in its field. */
      if (event.type === 'conversation_rewound') {
        discardStreaming()
        void window.octopus.chats.history(openChatId).then((history) => {
          if (!listening) return
          if (history.ok) setEntries(history.value)
          else setError(describeFailure(history))
        })
        return
      }

      if (event.type === 'message_queue') {
        const { messageId } = event
        const timer = queuing.current.get(messageId)
        if (event.state === 'queued') {
          if (timer !== undefined) return
          queuing.current.set(
            messageId,
            setTimeout(() => {
              queuing.current.delete(messageId)
              setWaiting((current) => withWaiting(current, messageId, true))
            }, QUEUED_AFTER_MS)
          )
          return
        }

        clearTimeout(timer)
        queuing.current.delete(messageId)
        setWaiting((current) => withWaiting(current, messageId, false))
        return
      }

      // What else `isEphemeral` names — the rate limit, the command list —
      // describes the account or the session rather than the conversation,
      // and is drawn elsewhere (`useRateLimit`, `useCommands`). Falling
      // through cost twice:
      // it wiped the answer being written, and left an entry that draws
      // nothing in the middle of a run of tool calls, splitting the fold in
      // two around a break the reader cannot see.
      if (isEphemeral(event)) return

      // The user asked for the conversation to be forgotten, and the agent
      // has forgotten it. What is on screen goes with it — the transcript on
      // disk has already been deleted, so leaving the log would show a
      // history that no longer exists anywhere and that nothing can continue.
      if (event.type === 'conversation_reset' && event.cleared) {
        discardStreaming()
        setEntries([])
        return
      }

      // Anything else means the block being streamed has finished, and its
      // complete form is in the event now arriving — except a background task
      // starting or ending, which is said by the CLI between the main agent's
      // words and would otherwise wipe the sentence being typed out.
      if (!isTaskBoundary(event)) discardStreaming()
      setEntries((current) => [...current, { role: 'agent', at: new Date().toISOString(), event }])

      // The core gave up auto mode on its own. This line is the only word of
      // it a window gets, so the chip is moved here — left alone it would go
      // on saying Auto over a conversation that asks.
      if (event.type === 'auto_mode_unavailable') {
        // The null arm cannot be reached: events are heard only for an open
        // conversation, which has a record. The guard is for the state's type.
        /* v8 ignore next */
        setChat((current) =>
          current === null ? null : { ...current, workingMode: event.fallback }
        )
      }

      /* Its own state beside the permission, not the same one: the two are
         answered by different calls, and a server's question does not put the
         conversation into `waiting_permission` — the turn is inside a tool
         call, and the agent is not asking anything. */
      if (event.type === 'elicitation_request') setPendingElicitation(event.requestId)

      // Answered somewhere else, or withdrawn when the turn stopped.
      if (event.type === 'elicitation_answered') {
        setPendingElicitation((current) => (current === event.requestId ? null : current))
      }

      if (event.type === 'permission_request') {
        const { requestId, toolName, input, taskId } = event
        setRequests((current) => [
          ...without(current, requestId),
          { requestId, toolName, input, ...(taskId !== undefined && { taskId }) }
        ])
      }
      // Answered somewhere else — the other window on this workspace — or
      // withdrawn: by the bridge, or with the agent that asked. The card here
      // has to stop offering buttons for a question that is settled.
      if (event.type === 'question_answered' || event.type === 'permission_withdrawn') {
        setRequests((current) => without(current, event.requestId))
      }

      if (event.type === 'result' || event.type === 'error') {
        setBusy(false)
        // The core's rule: a turn's end refuses the turn's own questions and
        // leaves its agents' open; a failed session takes every one with it.
        setRequests((current) =>
          event.type === 'error'
            ? NO_REQUESTS
            : current.filter((request) => request.taskId !== undefined)
        )
        setPendingElicitation(null)
        // A mark must never outlive the reason for it. A message still queued
        // here is taken by the very next frame, which starts its turn — and one
        // the CLI never says more about, a session that died holding it, would
        // otherwise say "queued" for good.
        forgetQueuing(queuing.current)
        setWaiting(NOTHING_WAITING)
      }
    }, openChatId)

    const pendingMarks = queuing.current
    return () => {
      listening = false
      release()
      forgetQueuing(pendingMarks)
    }
  }, [openChatId, describeFailure, appendStreaming, discardStreaming])

  /**
   * The conversation's record, created if this is the first thing done to it.
   *
   * A workspace gets no record from merely being looked at, but choosing a
   * setting is not looking — the choice has to be kept somewhere, and it
   * belongs to this conversation rather than to the application. Opening is
   * idempotent and writes no transcript, so the cost is one row.
   */
  const ensureChat = useCallback(async (): Promise<Chat | null> => {
    if (chat) return chat
    if (workspaceId === null) return null

    const opened = await window.octopus.chats.open(workspaceId)
    if (!opened.ok) {
      setError(describeFailure(opened))
      return null
    }

    created.current = opened.value.id
    setChat(opened.value)
    // The strip drew this tab without a record; now there is one, and its dot,
    // its menu and its number all come from it.
    announce.current(opened.value)

    return opened.value
  }, [chat, workspaceId, describeFailure, announce])

  const send = useCallback(
    async (text: string) => {
      const target = await ensureChat()
      if (!target) return false

      // Drawn before the round trip: the message is the user's own, and
      // waiting for the disk to confirm it makes typing feel unresponsive.
      const drawn: ChatEntry = { role: 'user', at: new Date().toISOString(), text }
      setEntries((current) => [...current, drawn])
      discardStreaming()
      setBusy(true)
      setError(null)

      const sent = await window.octopus.chats.send(target.id, text)
      if (!sent.ok) {
        setError(describeFailure(sent))
        setBusy(false)

        /*
         * The optimistic line above may now be a message no file carries, and
         * the log is the only record a reader has to check against.
         *
         * The transcript decides rather than the `Result`, which cannot say how
         * far the call got: core writes the entry before it asks the agent
         * anything, so a refusal on the way in — the boundary parse, a chat or
         * workspace that is gone — leaves nothing, and a session that failed to
         * start leaves the message. Re-reading answers both without core having
         * to describe which happened.
         *
         * Nothing is lost either way: the composer keeps the text until a send
         * answers true. A retry can therefore duplicate a message that did
         * land, which is the lesser failure — and the log now shows which case
         * this is.
         */
        const history = await window.octopus.chats.history(target.id)
        if (history.ok) setEntries(history.value)

        return false
      }

      /* The id the core recorded it under, put on the line already drawn: it
         is what the mark that rewinds to this message asks with, and the line
         had none until now. Matched by identity, so a log replaced in the
         meantime — another conversation, a cleared one — is left alone. */
      const uuid = sent.value
      if (uuid !== null) {
        setEntries((current) =>
          current.map((entry) => (entry === drawn ? { ...drawn, uuid } : entry))
        )
      }

      return true
    },
    [ensureChat, describeFailure, discardStreaming]
  )

  const interrupt = useCallback(async () => {
    if (!chat) return

    const stopped = await window.octopus.chats.interrupt(chat.id)
    if (!stopped.ok) setError(describeFailure(stopped))

    setBusy(false)
    // A Stop ends the turn; the agents' questions stay with the agents.
    setRequests((current) => current.filter((request) => request.taskId !== undefined))
  }, [chat, describeFailure])

  const answer = useCallback(
    async (
      requestId: string,
      decision: PermissionAnswer,
      feedback?: string,
      editedPlan?: string
    ) => {
      // Cleared first: the agent is unblocked either way, and leaving the card
      // on screen while it works reads as though the click did nothing.
      const answered = requests.find((request) => request.requestId === requestId)
      setRequests((current) => without(current, requestId))

      // The same rule the core applies when it clears `planMode`, kept here as
      // well because nothing tells a window that a record changed. Without it
      // the toggle stays lit over an agent that has stopped planning — which
      // was the whole complaint.
      if (decision !== 'deny' && answered?.toolName === EXIT_PLAN_MODE) {
        // The null arm cannot be reached: a request is only ever recorded for
        // the chat this hook has open, so there is one by the time it can be
        // answered. The guard exists because the state's type says otherwise.
        /* v8 ignore next */
        setChat((current) => (current === null ? null : leavePlanning(current, planExecutionMode)))
      }

      const sent = await sendAnswer(requestId, decision, feedback, editedPlan)
      if (!sent.ok) setError(describeFailure(sent))
    },
    [requests, describeFailure, planExecutionMode]
  )

  const answerElicitation = useCallback(
    async (requestId: string, answer: 'accept' | 'decline', values?: FormValues) => {
      // Cleared first, as with a permission: the server is released either way,
      // and leaving the form live while it works reads as though the button did
      // nothing. The card stays in the log and redraws from the
      // `elicitation_answered` event.
      setPendingElicitation(null)

      const sent = await window.octopus.chats.answerElicitation(requestId, answer, values)
      if (!sent.ok) setError(describeFailure(sent))
    },
    [describeFailure]
  )

  const answerQuestions = useCallback(
    async (requestId: string, answers: readonly QuestionAnswer[]) => {
      // Cleared first, as with a permission: the agent is released either way,
      // and leaving the card live while it works reads as though the button did
      // nothing. The card itself stays in the log — it is part of the
      // conversation — and redraws from the `question_answered` event.
      setRequests((current) => without(current, requestId))

      const sent = await window.octopus.chats.answerQuestions(requestId, answers)
      if (!sent.ok) setError(describeFailure(sent))
    },
    [describeFailure]
  )

  /**
   * One of the chat's settings, changed.
   *
   * All of them go the same way — make sure there is a record, tell the core,
   * then move the local copy or report why not — and written out each time the
   * differences would be where the bugs hid. `patch` is applied only after the
   * core agrees, so a refused change leaves the picker showing what is actually
   * in force. A refusal is on the banner.
   */
  const change = useCallback(
    async (patch: Partial<Chat>, send: (chatId: string) => Promise<Result<void>>) => {
      const target = await ensureChat()
      if (!target) return

      const changed = await send(target.id)

      // Applied to whatever the record has become rather than to the snapshot
      // taken before the await: two settings changed a moment apart both reach
      // the core, and the answer that lands last used to carry the other's
      // field back to what it had been.
      // The fallback is what the type asks for rather than a state to test:
      // `current` is null only after the reset, and the guard above returns
      // whenever that has happened. Ignored for coverage the way `at` in
      // `core/diff.ts` is, and for the same reason.
      if (!changed.ok) {
        setError(describeFailure(changed))
        return
      }

      /* v8 ignore next */
      setChat((current) => ({ ...(current ?? target), ...patch }))
    },
    [ensureChat, describeFailure]
  )

  const setWorkingMode = useCallback(
    (mode: WorkingMode) =>
      change({ workingMode: mode }, (chatId) => window.octopus.chats.setWorkingMode(chatId, mode)),
    [change]
  )

  const setPlanMode = useCallback(
    (planning: boolean) =>
      change({ planMode: planning }, (chatId) =>
        window.octopus.chats.setPlanMode(chatId, planning)
      ),
    [change]
  )

  const planning = chat?.planMode ?? true

  const setMode = useCallback(
    async (mode: ChatMode) => {
      if (mode === 'plan') {
        await setPlanMode(true)
        return
      }

      // The working mode first, while the session is still planning and runs
      // no tools at all. Turned the other way round, leaving a plan for "ask
      // first" passed through the `acceptEdits` the plan had been holding, and
      // an edit landing in that moment would have gone through unasked.
      await setWorkingMode(mode)
      if (planning) await setPlanMode(false)
    },
    [planning, setWorkingMode, setPlanMode]
  )

  const setModels = useCallback(
    (models: ChatModels) =>
      change(models, (chatId) => window.octopus.chats.setModels(chatId, models)),
    [change]
  )

  const setEfforts = useCallback(
    (efforts: ChatEfforts) =>
      change(efforts, (chatId) => window.octopus.chats.setEfforts(chatId, efforts)),
    [change]
  )

  const setAutoCompact = useCallback(
    (autoCompactWindow: AutoCompactWindow | null) =>
      change({ autoCompactWindow }, (chatId) =>
        window.octopus.chats.setAutoCompact(chatId, autoCompactWindow)
      ),
    [change]
  )

  /*
   * Working, by either account.
   *
   * The flag above follows this pane's own events; the status follows the
   * conversation whichever tab is on screen, which is what survives looking
   * away and coming back. Gated on the chat having loaded, because `interrupt`
   * returns early without one — otherwise the stop button would stand there
   * through the read and do nothing when pressed.
   *
   * The conversation's own status rather than its workspace's, which is what
   * this read before there could be more than one: three tabs share a
   * workspace, so the one that finished would have reported the other two idle
   * — and taken the stop button away from turns still running.
   */
  /*
   * Not while only background agents are at work, though: the conversation is
   * `running` then and the main agent is not, so a Stop would stop nothing —
   * the agents are stopped from the map — and a message goes straight in.
   */
  const mainWorking = useMainWorking(chat?.id ?? null)
  const working =
    busy ||
    (chat !== null &&
      (status === 'running' || status === 'waiting_permission') &&
      mainWorking !== false)

  // The newest, as the single slot this was used to hold: a plan offered again
  // replaces the one before it.
  const pending = useMemo(
    () => requests.findLast((request) => request.taskId === undefined) ?? null,
    [requests]
  )
  const answerable = useMemo(
    () => new Set(requests.map((request) => request.requestId)),
    [requests]
  )

  return {
    chat,
    entries,
    stream,
    streaming,
    busy: working,
    waiting,
    pending,
    answerable,
    loading,
    error,
    send,
    interrupt,
    answer,
    answerElicitation,
    pendingElicitation,
    answerQuestions,
    setMode,
    setEfforts,
    setModels,
    setAutoCompact,
    ensure: ensureChat
  }
}
