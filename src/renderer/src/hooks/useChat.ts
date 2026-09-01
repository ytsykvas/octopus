import { useCallback, useEffect, useRef, useState } from 'react'

import {
  type Chat,
  type ChatStatus,
  type EffortChoice,
  EXIT_PLAN_MODE,
  type WorkingMode
} from '@core/chats.js'
import { isEphemeral } from '@core/events.js'
import type { QuestionAnswer } from '@core/questions.js'
import type { PermissionAnswer } from '@core/service.js'
import type { ChatEntry } from '@core/transcript.js'

import type { Failure, Result } from '../../../preload/index.js'
import { onChatEvent } from './chatEvents.js'

/** A tool call the agent is blocked on, waiting to be told whether it may run. */
export interface PendingPermission {
  readonly requestId: string
  readonly toolName: string
  readonly input: unknown
}

/** Prose and reasoning still being written, kept apart so they render apart. */
export interface Streaming {
  readonly text: string
  readonly thinking: string
}

const NOTHING_STREAMING: Streaming = { text: '', thinking: '' }

export interface ChatController {
  readonly chat: Chat | null
  readonly entries: readonly ChatEntry[]
  readonly streaming: Streaming
  /** A turn is in flight: the agent is working, or waiting on an answer. */
  readonly busy: boolean
  /** The request the agent is blocked on, or null when it is not blocked. */
  readonly pending: PendingPermission | null
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
  readonly answer: (requestId: string, answer: PermissionAnswer, feedback?: string) => Promise<void>
  /** Answers the questions the agent asked, releasing the tool call. */
  readonly answerQuestions: (requestId: string, answers: readonly QuestionAnswer[]) => Promise<void>
  readonly setWorkingMode: (mode: WorkingMode) => Promise<void>
  readonly setPlanMode: (planning: boolean) => Promise<void>
  readonly setEffort: (effort: EffortChoice) => Promise<void>
  readonly setModel: (model: string | null) => Promise<void>
  readonly setPlanModel: (model: string | null) => Promise<void>
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
  onOpened: (chat: Chat) => void
): ChatController {
  const chatId = initial?.id ?? null

  const [chat, setChat] = useState<Chat | null>(initial)
  const [entries, setEntries] = useState<readonly ChatEntry[]>([])
  const [streaming, setStreaming] = useState<Streaming>(NOTHING_STREAMING)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingPermission | null>(null)
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

  // Reset during render rather than in an effect. React supports this for
  // state derived from a prop, and it matters here: an effect runs after the
  // paint, so switching conversation would show the previous one for a frame
  // before it cleared.
  if (chatId !== shownChatId) {
    setShownChatId(chatId)

    if (chatId !== chat?.id) {
      setChat(initial)
      setEntries([])
      setStreaming(NOTHING_STREAMING)
      setBusy(false)
      setPending(null)
      setError(null)
      // Set here rather than in the effect that loads: by the time an effect
      // runs the frame is already on screen, so the pane would flash the empty
      // state before the spinner.
      setLoading(chatId !== null)
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
      const blocked = await window.octopus.chats.pendingPermission(chatId)
      if (abandoned() || !blocked.ok || blocked.value === null) return

      setPending(blocked.value)
      setBusy(true)
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

    return onChatEvent(({ event }) => {
      if (event.type === 'text_delta') {
        setStreaming((current) => ({ ...current, text: current.text + event.text }))
        return
      }

      if (event.type === 'thinking_delta') {
        setStreaming((current) => ({ ...current, thinking: current.thinking + event.text }))
        return
      }

      // What is left of `isEphemeral` after the two deltas above is the rate
      // limit, which describes the account rather than the conversation and
      // is drawn in the attic by `useRateLimit`. Falling through cost twice:
      // it wiped the answer being written, and left an entry that draws
      // nothing in the middle of a run of tool calls, splitting the fold in
      // two around a break the reader cannot see.
      if (isEphemeral(event)) return

      // The user asked for the conversation to be forgotten, and the agent
      // has forgotten it. What is on screen goes with it — the transcript on
      // disk has already been deleted, so leaving the log would show a
      // history that no longer exists anywhere and that nothing can continue.
      if (event.type === 'conversation_reset' && event.cleared) {
        setStreaming(NOTHING_STREAMING)
        setEntries([])
        return
      }

      // Anything else means the block being streamed has finished, and its
      // complete form is in the event now arriving.
      setStreaming(NOTHING_STREAMING)
      setEntries((current) => [...current, { role: 'agent', at: new Date().toISOString(), event }])

      if (event.type === 'permission_request') {
        setPending({
          requestId: event.requestId,
          toolName: event.toolName,
          input: event.input
        })
      }
      // Answered somewhere else — the other window on this workspace. The
      // card here has to stop offering buttons for a question that is settled.
      if (event.type === 'question_answered') {
        setPending((current) => (current?.requestId === event.requestId ? null : current))
      }

      if (event.type === 'result' || event.type === 'error') {
        setBusy(false)
        setPending(null)
      }
    }, openChatId)
  }, [openChatId])

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
    onOpened(opened.value)

    return opened.value
  }, [chat, workspaceId, describeFailure, onOpened])

  const send = useCallback(
    async (text: string) => {
      const target = await ensureChat()
      if (!target) return false

      // Drawn before the round trip: the message is the user's own, and
      // waiting for the disk to confirm it makes typing feel unresponsive.
      setEntries((current) => [...current, { role: 'user', at: new Date().toISOString(), text }])
      setStreaming(NOTHING_STREAMING)
      setBusy(true)
      setError(null)

      const sent = await window.octopus.chats.send(target.id, text)
      if (!sent.ok) {
        setError(describeFailure(sent))
        setBusy(false)
        return false
      }

      return true
    },
    [ensureChat, describeFailure]
  )

  const interrupt = useCallback(async () => {
    if (!chat) return

    const stopped = await window.octopus.chats.interrupt(chat.id)
    if (!stopped.ok) setError(describeFailure(stopped))

    setBusy(false)
    setPending(null)
  }, [chat, describeFailure])

  const answer = useCallback(
    async (requestId: string, decision: PermissionAnswer, feedback?: string) => {
      // Cleared first: the agent is unblocked either way, and leaving the card
      // on screen while it works reads as though the click did nothing.
      const answered = pending
      setPending(null)

      // The same rule the core applies when it clears `planMode`, kept here as
      // well because nothing tells a window that a record changed. Without it
      // the toggle stays lit over an agent that has stopped planning — which
      // was the whole complaint.
      if (decision !== 'deny' && answered?.toolName === EXIT_PLAN_MODE) {
        // The null arm cannot be reached: a request is only ever recorded for
        // the chat this hook has open, so there is one by the time it can be
        // answered. The guard exists because the state's type says otherwise.
        /* v8 ignore next */
        setChat((current) => (current === null ? null : { ...current, planMode: false }))
      }

      const sent = await window.octopus.chats.answerPermission(requestId, decision, feedback)
      if (!sent.ok) setError(describeFailure(sent))
    },
    [pending, describeFailure]
  )

  const answerQuestions = useCallback(
    async (requestId: string, answers: readonly QuestionAnswer[]) => {
      // Cleared first, as with a permission: the agent is released either way,
      // and leaving the card live while it works reads as though the button did
      // nothing. The card itself stays in the log — it is part of the
      // conversation — and redraws from the `question_answered` event.
      setPending(null)

      const sent = await window.octopus.chats.answerQuestions(requestId, answers)
      if (!sent.ok) setError(describeFailure(sent))
    },
    [describeFailure]
  )

  /**
   * One of the chat's settings, changed.
   *
   * All three go the same way — make sure there is a record, tell the core,
   * then move the local copy or report why not — and written out three times
   * the differences would be where the bugs hid. `patch` is applied only after
   * the core agrees, so a refused change leaves the picker showing what is
   * actually in force.
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
      /* v8 ignore next */
      if (changed.ok) setChat((current) => ({ ...(current ?? target), ...patch }))
      else setError(describeFailure(changed))
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

  const setModel = useCallback(
    (model: string | null) =>
      change({ model }, (chatId) => window.octopus.chats.setModel(chatId, model)),
    [change]
  )

  const setPlanModel = useCallback(
    (planModel: string | null) =>
      change({ planModel }, (chatId) => window.octopus.chats.setPlanModel(chatId, planModel)),
    [change]
  )

  const setEffort = useCallback(
    (effort: EffortChoice) =>
      change({ effort }, (chatId) => window.octopus.chats.setEffort(chatId, effort)),
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
  const working =
    busy || (chat !== null && (status === 'running' || status === 'waiting_permission'))

  return {
    chat,
    entries,
    streaming,
    busy: working,
    pending,
    loading,
    error,
    send,
    interrupt,
    answer,
    answerQuestions,
    setWorkingMode,
    setPlanMode,
    setEffort,
    setModel,
    setPlanModel,
    ensure: ensureChat
  }
}
