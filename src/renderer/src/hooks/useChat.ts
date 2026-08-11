import { useCallback, useEffect, useState } from 'react'

import type { Chat, PermissionMode } from '@core/chats.js'
import type { PermissionAnswer } from '@core/service.js'
import type { ChatEntry } from '@core/transcript.js'

import type { Failure } from '../../../preload/index.js'

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
  readonly pendingRequestId: string | null
  readonly loading: boolean
  readonly error: string | null
  readonly send: (text: string) => Promise<void>
  readonly interrupt: () => Promise<void>
  readonly answer: (requestId: string, answer: PermissionAnswer) => Promise<void>
  readonly setMode: (mode: PermissionMode) => Promise<void>
}

/** Turns a failed IPC result into a sentence — what `useErrorMessage` returns. */
type Describe = (failure: Failure) => string

/**
 * One workspace's conversation.
 *
 * The history is read from disk once; everything after that arrives as events.
 * The two are deliberately never merged by re-reading the file — an append the
 * UI has already drawn would come back as a duplicate of itself.
 */
export function useChat(workspaceId: string | null, describeFailure: Describe): ChatController {
  const [chat, setChat] = useState<Chat | null>(null)
  const [entries, setEntries] = useState<readonly ChatEntry[]>([])
  const [streaming, setStreaming] = useState<Streaming>(NOTHING_STREAMING)
  const [busy, setBusy] = useState(false)
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null)
  const [loading, setLoading] = useState(workspaceId !== null)
  const [error, setError] = useState<string | null>(null)
  const [shownWorkspaceId, setShownWorkspaceId] = useState(workspaceId)

  // Reset during render rather than in an effect. React supports this for
  // state derived from a prop, and it matters here: an effect runs after the
  // paint, so switching workspace would show the previous conversation for a
  // frame before it cleared.
  if (workspaceId !== shownWorkspaceId) {
    setShownWorkspaceId(workspaceId)
    setChat(null)
    setEntries([])
    setStreaming(NOTHING_STREAMING)
    setBusy(false)
    setPendingRequestId(null)
    setError(null)
    // Set here rather than in the effect that loads: by the time an effect
    // runs the frame is already on screen, so the pane would flash the empty
    // state before the spinner.
    setLoading(workspaceId !== null)
  }

  useEffect(() => {
    const controller = new AbortController()
    // Called rather than read: the narrowing TypeScript applies to a checked
    // `aborted` survives an await, and the second check would read as dead.
    const abandoned = (): boolean => controller.signal.aborted

    if (workspaceId === null) return

    void (async () => {
      const found = await window.octopus.chats.list(workspaceId)
      if (abandoned()) return

      if (!found.ok) {
        setError(describeFailure(found))
        setLoading(false)
        return
      }

      // No chat yet is the ordinary state of a fresh workspace, not a failure:
      // the record is created by the first message.
      const [existing] = found.value
      if (!existing) {
        setLoading(false)
        return
      }

      const history = await window.octopus.chats.history(existing.id)
      if (abandoned()) return

      setChat(existing)
      if (history.ok) setEntries(history.value)
      else setError(describeFailure(history))
      setLoading(false)
    })()

    return () => {
      controller.abort()
    }
  }, [workspaceId, describeFailure])

  const openChatId = chat?.id ?? null

  useEffect(
    () =>
      window.octopus.chats.onEvent(({ chatId, event }) => {
        // Events are broadcast to every window and cover every chat; this hook
        // draws the one it is showing.
        if (chatId !== openChatId) return

        if (event.type === 'text_delta') {
          setStreaming((current) => ({ ...current, text: current.text + event.text }))
          return
        }

        if (event.type === 'thinking_delta') {
          setStreaming((current) => ({ ...current, thinking: current.thinking + event.text }))
          return
        }

        // Anything else means the block being streamed has finished, and its
        // complete form is in the event now arriving.
        setStreaming(NOTHING_STREAMING)
        setEntries((current) => [
          ...current,
          { role: 'agent', at: new Date().toISOString(), event }
        ])

        if (event.type === 'permission_request') setPendingRequestId(event.requestId)
        if (event.type === 'result' || event.type === 'error') {
          setBusy(false)
          setPendingRequestId(null)
        }
      }),
    [openChatId]
  )

  const send = useCallback(
    async (text: string) => {
      if (workspaceId === null) return

      let target = chat
      if (!target) {
        const opened = await window.octopus.chats.open(workspaceId)
        if (!opened.ok) {
          setError(describeFailure(opened))
          return
        }
        target = opened.value
        setChat(target)
      }

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
      }
    },
    [chat, workspaceId, describeFailure]
  )

  const interrupt = useCallback(async () => {
    if (!chat) return

    const stopped = await window.octopus.chats.interrupt(chat.id)
    if (!stopped.ok) setError(describeFailure(stopped))

    setBusy(false)
    setPendingRequestId(null)
  }, [chat, describeFailure])

  const answer = useCallback(
    async (requestId: string, decision: PermissionAnswer) => {
      // Cleared first: the agent is unblocked either way, and leaving the card
      // on screen while it works reads as though the click did nothing.
      setPendingRequestId(null)

      const answered = await window.octopus.chats.answerPermission(requestId, decision)
      if (!answered.ok) setError(describeFailure(answered))
    },
    [describeFailure]
  )

  const setMode = useCallback(
    async (mode: PermissionMode) => {
      if (!chat) return

      const changed = await window.octopus.chats.setPermissionMode(chat.id, mode)
      if (changed.ok) setChat({ ...chat, permissionMode: mode })
      else setError(describeFailure(changed))
    },
    [chat, describeFailure]
  )

  return {
    chat,
    entries,
    streaming,
    busy,
    pendingRequestId,
    loading,
    error,
    send,
    interrupt,
    answer,
    setMode
  }
}
