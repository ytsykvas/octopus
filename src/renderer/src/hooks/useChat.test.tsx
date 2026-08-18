import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Chat } from '@core/chats.js'
import type { AgentEvent } from '@core/events.js'
import type { ChatEntry } from '@core/transcript.js'

import type { Failure, Result } from '../../../preload/index.js'
import { chat, emitAgentEvent, givenChat } from '../test/chat.js'
import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { useChat } from './useChat.js'

/** The English fallback is enough here; the mapping is `useErrorMessage`'s job. */
const describeFailure = (failure: Failure): string => failure.error

/** What the tab strip does with a record the pane created; not this hook's job. */
const noted = vi.fn()

/** The hook as the pane calls it, for a conversation that already exists. */
function open(record: Chat | null = chat()): Parameters<typeof useChat> {
  return [record, 'planner/anna', 'idle', describeFailure, noted]
}

describe('without a workspace', () => {
  // The pane shows a placeholder instead, so nothing here is reachable through
  // the UI — but the hook is an API, and an API that misbehaves when handed a
  // null is one somebody will eventually hand a null.
  it('asks the bridge for nothing and does nothing when driven', async () => {
    const { result } = renderHook(() => useChat(null, null, 'idle', describeFailure, noted))

    expect(result.current.loading).toBe(false)
    expect(octopus().chats.history).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.send('hello')
      await result.current.interrupt()
      await result.current.setWorkingMode('acceptEdits')
      await result.current.setPlanMode(true)
    })

    expect(octopus().chats.open).not.toHaveBeenCalled()
    expect(octopus().chats.interrupt).not.toHaveBeenCalled()
    expect(octopus().chats.setWorkingMode).not.toHaveBeenCalled()
    expect(octopus().chats.setPlanMode).not.toHaveBeenCalled()
  })
})

describe('a conversation that is already waiting on an answer', () => {
  const request = { requestId: 'r-1', toolName: 'ExitPlanMode', input: { plan: 'a plan' } }

  /*
   * Seen for real: a plan waited half an hour.
   *
   * `permission_request` goes out once. A window that was not listening then —
   * opened afterwards, or switched to another workspace and back, which clears
   * what it was holding — showed a conversation stuck on "working" while the
   * one answer it needed was one nobody could give.
   */
  it('finds out what the agent is blocked on when the chat is opened', async () => {
    givenChat()
    vi.mocked(octopus().chats.pendingPermission).mockResolvedValue({ ok: true, value: request })

    const { result } = renderHook(() => useChat(...open()))

    await waitFor(() => {
      expect(result.current.pending).toEqual(request)
    })
    // And it says so, rather than offering a composer for a turn in flight.
    expect(result.current.busy).toBe(true)
  })

  it('stays as it was when nothing is blocked', async () => {
    givenChat()

    const { result } = renderHook(() => useChat(...open()))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.pending).toBeNull()
    expect(result.current.busy).toBe(false)
  })

  // The worst case is the state we were already in, and an error banner over a
  // conversation that opened perfectly well would be worse than that.
  it('says nothing when the question cannot be asked for', async () => {
    givenChat()
    vi.mocked(octopus().chats.pendingPermission).mockResolvedValue({
      ok: false,
      error: 'no such chat'
    })

    const { result } = renderHook(() => useChat(...open()))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.pending).toBeNull()
    expect(result.current.error).toBeNull()
  })
})

describe('a load that outlives the hook', () => {
  it('is dropped when the history comes back too late', async () => {
    vi.mocked(octopus().chats.list).mockResolvedValue({ ok: true, value: [chat()] })

    const history = held<Result<ChatEntry[]>>()
    vi.mocked(octopus().chats.history).mockReturnValue(history.promise)

    const { result, unmount } = renderHook(() => useChat(...open()))
    await waitFor(() => {
      expect(octopus().chats.history).toHaveBeenCalled()
    })

    unmount()

    await act(async () => {
      history.resolve({
        ok: true,
        value: [{ role: 'user', at: '2026-08-11T09:00:00.000Z', text: 'too late' }]
      })
      await history.promise
    })

    expect(result.current.entries).toEqual([])
  })
})

describe('a reading that belongs to the account rather than the conversation', () => {
  const READING: AgentEvent = {
    type: 'rate_limit',
    status: 'allowed_warning',
    window: 'seven_day',
    utilization: 84,
    resetsAt: null
  }

  /*
   * It arrives mid-turn, on the same stream as everything else, and used to
   * fall through to "the block being streamed has finished". So the answer
   * being written vanished until the finished block arrived, and the log gained
   * an entry that draws nothing — which breaks a run of tool calls into two
   * folds with an invisible gap between them.
   *
   * The attic shows it, from `useRateLimit`. The log has no business with it.
   */
  it('leaves the answer being written and the log alone', async () => {
    givenChat()
    const { result } = renderHook(() => useChat(...open()))
    await waitFor(() => {
      expect(result.current.chat).not.toBeNull()
    })

    emitAgentEvent({ type: 'text_delta', text: 'Look' })
    emitAgentEvent(READING)

    expect(result.current.streaming.text).toBe('Look')
    expect(result.current.entries).toEqual([])
  })
})

/*
 * Answering the agent's own question. Not a permission — the user is handing
 * over information rather than saying whether the agent may act — so it has its
 * own way out to the bridge.
 */
describe('answering a question', () => {
  const ANSWERS = [{ question: 'Which one?', selected: ['the first'], other: null }]

  it('sends the answers and takes the card out of the pending state', async () => {
    givenChat()
    const { result } = renderHook(() => useChat(...open()))
    await waitFor(() => {
      expect(result.current.chat).not.toBeNull()
    })

    emitAgentEvent({
      type: 'permission_request',
      requestId: 'r-q',
      toolName: 'AskUserQuestion',
      input: { questions: [] }
    })
    expect(result.current.pending).not.toBeNull()

    await act(async () => {
      await result.current.answerQuestions('r-q', ANSWERS)
    })

    expect(octopus().chats.answerQuestions).toHaveBeenCalledWith('r-q', ANSWERS)
    expect(result.current.pending).toBeNull()
  })

  it('says so when the answer could not be delivered', async () => {
    vi.mocked(octopus().chats.answerQuestions).mockResolvedValue({
      ok: false,
      error: 'the agent is gone'
    })
    givenChat()
    const { result } = renderHook(() => useChat(...open()))
    await waitFor(() => {
      expect(result.current.chat).not.toBeNull()
    })

    await act(async () => {
      await result.current.answerQuestions('r-q', ANSWERS)
    })

    expect(result.current.error).toBe('the agent is gone')
  })

  // Another window on the same workspace answered it. This one has to stop
  // offering buttons for a question that is settled.
  it('drops a card another window has answered', async () => {
    givenChat()
    const { result } = renderHook(() => useChat(...open()))
    await waitFor(() => {
      expect(result.current.chat).not.toBeNull()
    })

    emitAgentEvent({
      type: 'permission_request',
      requestId: 'r-q',
      toolName: 'AskUserQuestion',
      input: { questions: [] }
    })

    emitAgentEvent({ type: 'question_answered', requestId: 'r-q', answers: ANSWERS })

    expect(result.current.pending).toBeNull()
  })

  // An answer to some other question leaves this one alone — two questions can
  // be open at once, and the second must not take the first's card down.
  it('leaves a card that is waiting on a different question', async () => {
    givenChat()
    const { result } = renderHook(() => useChat(...open()))
    await waitFor(() => {
      expect(result.current.chat).not.toBeNull()
    })

    emitAgentEvent({
      type: 'permission_request',
      requestId: 'r-q',
      toolName: 'AskUserQuestion',
      input: { questions: [] }
    })

    emitAgentEvent({ type: 'question_answered', requestId: 'r-other', answers: ANSWERS })

    expect(result.current.pending?.requestId).toBe('r-q')
  })
})

describe('two settings changed in quick succession', () => {
  /*
   * Both writes reach the core correctly; only the pane disagrees. `change`
   * applied its patch to the record it read *before* its await, so whichever
   * answer landed last carried the other's field back to what it had been —
   * and the picker then showed a value the core no longer held.
   */
  it('keeps both, rather than letting the later answer undo the earlier', async () => {
    givenChat()
    const model = held<Result<void>>()
    const effort = held<Result<void>>()
    vi.mocked(octopus().chats.setModel).mockReturnValue(model.promise)
    vi.mocked(octopus().chats.setEffort).mockReturnValue(effort.promise)

    const { result } = renderHook(() => useChat(...open()))
    await waitFor(() => {
      expect(result.current.chat).not.toBeNull()
    })

    const both = act(async () => {
      const first = result.current.setModel('claude-opus-5')
      const second = result.current.setEffort('high')
      model.resolve({ ok: true, value: undefined })
      effort.resolve({ ok: true, value: undefined })
      await Promise.all([first, second])
    })
    await both

    expect(result.current.chat?.model).toBe('claude-opus-5')
    expect(result.current.chat?.effort).toBe('high')
  })
})

describe('the record the pane creates for itself', () => {
  /*
   * The first conversation of a workspace is written by the first message, so
   * its id reaches the tab strip and comes back here as a prop a render later.
   *
   * Read as an arrival — which the obvious comparison does — that render wipes
   * the message just drawn, the answer already being streamed in reply to it,
   * and the flag that says a turn is in flight. It happened on the first
   * message of every new workspace.
   */
  it('does not read its own id, arriving as a prop, as a different conversation', async () => {
    const created = chat()
    vi.mocked(octopus().chats.open).mockResolvedValue({ ok: true, value: created })

    const { result, rerender } = renderHook(
      ({ record }: { record: Chat | null }) =>
        useChat(record, 'planner/anna', 'idle', describeFailure, noted),
      { initialProps: { record: null as Chat | null } }
    )

    await act(async () => {
      await result.current.send('add a test')
    })
    expect(result.current.entries).toHaveLength(1)

    // What the strip does with `onOpened`: the tab now carries the record.
    rerender({ record: created })

    expect(result.current.entries).toHaveLength(1)
    expect(result.current.busy).toBe(true)
  })

  /*
   * The composer clears the field and the review on this answer.
   *
   * A review is minutes of reading and nothing writes it to disk, so a send
   * reported as having gone when it did not is the one way to lose it outright.
   */
  it('answers whether the message went', async () => {
    const created = chat()
    vi.mocked(octopus().chats.open).mockResolvedValue({ ok: true, value: created })

    const { result } = renderHook(() =>
      useChat(null, 'planner/anna', 'idle', describeFailure, noted)
    )

    let went: boolean | undefined
    await act(async () => {
      went = await result.current.send('add a test')
    })
    expect(went).toBe(true)

    vi.mocked(octopus().chats.send).mockResolvedValue({ ok: false, error: 'no session' })
    await act(async () => {
      went = await result.current.send('add another')
    })
    expect(went).toBe(false)
  })

  // The conversation could not be created, so there was never anywhere to send.
  it('answers no when the conversation could not be opened', async () => {
    vi.mocked(octopus().chats.open).mockResolvedValue({ ok: false, error: 'no workspace' })

    const { result } = renderHook(() =>
      useChat(null, 'planner/anna', 'idle', describeFailure, noted)
    )

    let went: boolean | undefined
    await act(async () => {
      went = await result.current.send('add a test')
    })

    expect(went).toBe(false)
  })

  it('tells the strip about the record it created', async () => {
    const created = chat()
    vi.mocked(octopus().chats.open).mockResolvedValue({ ok: true, value: created })

    const { result } = renderHook(() =>
      useChat(null, 'planner/anna', 'idle', describeFailure, noted)
    )

    await act(async () => {
      await result.current.send('add a test')
    })

    expect(noted).toHaveBeenCalledWith(created)
  })

  // Its history is what this pane has just written; reading it back would draw
  // the message twice.
  it('does not read back the history of a conversation it just created', async () => {
    const created = chat()
    vi.mocked(octopus().chats.open).mockResolvedValue({ ok: true, value: created })

    const { result, rerender } = renderHook(
      ({ record }: { record: Chat | null }) =>
        useChat(record, 'planner/anna', 'idle', describeFailure, noted),
      { initialProps: { record: null as Chat | null } }
    )

    await act(async () => {
      await result.current.send('add a test')
    })
    rerender({ record: created })

    expect(octopus().chats.history).not.toHaveBeenCalled()
  })
})

describe('a different conversation in the same pane', () => {
  // Switching tabs is not a continuation: the log, the answer being streamed
  // and the question being waited on all belong to the one being left.
  it('clears what it was showing', async () => {
    const first = chat()
    const second = chat({ id: 'chat-2' })
    vi.mocked(octopus().chats.history).mockResolvedValue({
      ok: true,
      value: [{ role: 'user', at: '2026-08-11T09:00:00.000Z', text: 'the first one' }]
    })

    const { result, rerender } = renderHook(
      ({ record }: { record: Chat }) =>
        useChat(record, 'planner/anna', 'idle', describeFailure, noted),
      { initialProps: { record: first } }
    )
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1)
    })

    vi.mocked(octopus().chats.history).mockResolvedValue({ ok: true, value: [] })
    rerender({ record: second })

    expect(result.current.entries).toEqual([])
    expect(result.current.chat?.id).toBe('chat-2')
  })
})

describe('a turn already in flight when the pane opens', () => {
  /*
   * The conversation's own status, not its workspace's. A workspace holds up to
   * three and they run at once, so the one that finished used to report the
   * other two idle — and take the stop button away from turns still going.
   */
  it('is busy when the record says the conversation is running', async () => {
    const { result } = renderHook(() =>
      useChat(chat(), 'planner/anna', 'running', describeFailure, noted)
    )

    await waitFor(() => {
      expect(result.current.busy).toBe(true)
    })
  })

  it('is busy when it is waiting on an answer', async () => {
    const { result } = renderHook(() =>
      useChat(chat(), 'planner/anna', 'waiting_permission', describeFailure, noted)
    )

    await waitFor(() => {
      expect(result.current.busy).toBe(true)
    })
  })

  it('is not busy for a conversation that is doing nothing', async () => {
    const { result } = renderHook(() => useChat(...open()))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.busy).toBe(false)
  })
})
