import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AgentEvent } from '@core/events.js'
import type { SessionUsage } from '@core/service.js'

import type { Result } from '../../../preload/index.js'
import { refuseSilence } from '../test/chat.js'
import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { useSessionUsage } from './useSessionUsage.js'

const CHAT = 'chat-1'

const READING: SessionUsage = {
  context: { percentage: 48, usedTokens: 48_000, maxTokens: 200_000, model: 'claude-opus-5' }
}

/** Delivers an event the way the bridge does, to whoever subscribed. */
function emit(event: AgentEvent, chatId = CHAT): void {
  const calls = vi.mocked(octopus().chats.onEvent).mock.calls
  refuseSilence(calls.length, 'chats.onEvent')

  const [subscriber] = calls.at(-1) ?? []
  subscriber?.({ chatId, workspaceId: 'planner/kyiv', event })
}

const answering = (usage: SessionUsage): void => {
  vi.mocked(octopus().chats.usage).mockResolvedValue({ ok: true, value: usage })
}

describe('what the running session says about usage', () => {
  it('asks as soon as there is a conversation to ask about', async () => {
    answering(READING)

    const { result } = renderHook(() => useSessionUsage(CHAT))

    await waitFor(() => {
      expect(result.current.context?.percentage).toBe(48)
    })
  })

  // A workspace nobody has spoken to has no record, so there is nothing to ask
  // about and no reason to reach the main process at all.
  it('asks nothing before the conversation exists', () => {
    renderHook(() => useSessionUsage(null))

    expect(octopus().chats.usage).not.toHaveBeenCalled()
  })

  it('asks again when a session starts', async () => {
    answering({ context: null })
    renderHook(() => useSessionUsage(CHAT))
    await waitFor(() => {
      expect(octopus().chats.usage).toHaveBeenCalledTimes(1)
    })

    emit({ type: 'session_started', sessionId: 'sess-1' })

    await waitFor(() => {
      expect(octopus().chats.usage).toHaveBeenCalledTimes(2)
    })
  })

  it('asks again when a turn ends, since both figures have moved', async () => {
    answering({ context: null })
    renderHook(() => useSessionUsage(CHAT))
    await waitFor(() => {
      expect(octopus().chats.usage).toHaveBeenCalledTimes(1)
    })

    emit({
      type: 'result',
      ok: true,
      costUsd: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      terminalReason: null
    })

    await waitFor(() => {
      expect(octopus().chats.usage).toHaveBeenCalledTimes(2)
    })
  })

  /*
   * A compaction is the one moment the figure is taken from the event rather
   * than asked for.
   *
   * Measured live: 74k tokens before, 16k after, and the reading stayed where
   * it was. The reading is the reason the command was run, so someone who
   * compacts to make room and sees the same percentage runs it again — another
   * minute and another dollar for nothing.
   *
   * `postTokens` is what the CLI itself computed for the conversation it has
   * just written, so it is right whether or not `getContextUsage` has caught
   * up — and a re-read would put the stale figure back if the CLI only updates
   * on the next request, which is the question the note could not settle.
   */
  it('takes the figure from a compaction rather than asking again', async () => {
    answering(READING)
    const { result } = renderHook(() => useSessionUsage(CHAT))
    await waitFor(() => {
      expect(result.current.context?.usedTokens).toBe(48_000)
    })

    act(() => {
      emit({
        type: 'conversation_compacted',
        trigger: 'manual',
        preTokens: 73_984,
        postTokens: 16_023
      })
    })

    expect(result.current.context?.usedTokens).toBe(16_023)
    expect(result.current.context?.percentage).toBe(8)
    // The window and the model did not move, and neither did the round trip.
    expect(result.current.context?.maxTokens).toBe(200_000)
    expect(octopus().chats.usage).toHaveBeenCalledTimes(1)
  })

  // A compaction can arrive before any reading has: there is no window to
  // measure the figure against, so it waits for the next turn like everything
  // else the strip has nothing to say about.
  it('claims nothing when a compaction arrives before the first reading', async () => {
    answering({ context: null })
    const { result } = renderHook(() => useSessionUsage(CHAT))
    await waitFor(() => {
      expect(octopus().chats.usage).toHaveBeenCalledTimes(1)
    })

    act(() => {
      emit({
        type: 'conversation_compacted',
        trigger: 'auto',
        preTokens: 73_984,
        postTokens: 16_023
      })
    })

    expect(result.current.context).toBeNull()
  })

  // Nothing to take, so nothing is claimed: the row in the log still says the
  // conversation was compacted, and the reading waits for the next turn.
  it('leaves the figure alone when a compaction says nothing about the size', async () => {
    answering(READING)
    const { result } = renderHook(() => useSessionUsage(CHAT))
    await waitFor(() => {
      expect(result.current.context?.usedTokens).toBe(48_000)
    })

    act(() => {
      emit({ type: 'conversation_compacted', trigger: null, preTokens: null, postTokens: null })
    })

    expect(result.current.context?.usedTokens).toBe(48_000)
    expect(octopus().chats.usage).toHaveBeenCalledTimes(1)
  })

  // Every read is a round trip, and one of the two goes on to the network.
  it('ignores the events that say nothing about usage', async () => {
    answering({ context: null })
    renderHook(() => useSessionUsage(CHAT))
    await waitFor(() => {
      expect(octopus().chats.usage).toHaveBeenCalledTimes(1)
    })

    emit({ type: 'text', text: 'working on it' })

    expect(octopus().chats.usage).toHaveBeenCalledTimes(1)
  })

  it('ignores a turn that ended in another conversation', async () => {
    answering({ context: null })
    renderHook(() => useSessionUsage(CHAT))
    await waitFor(() => {
      expect(octopus().chats.usage).toHaveBeenCalledTimes(1)
    })

    emit({ type: 'session_started', sessionId: 'sess-2' }, 'chat-2')

    expect(octopus().chats.usage).toHaveBeenCalledTimes(1)
  })

  // "Could not ask" and "nothing to report" are different statements, and
  // blanking the strip would make the first look like the second.
  it('keeps the figures it had when a later read fails', async () => {
    answering(READING)
    const { result } = renderHook(() => useSessionUsage(CHAT))
    await waitFor(() => {
      expect(result.current.context?.percentage).toBe(48)
    })

    vi.mocked(octopus().chats.usage).mockResolvedValue({ ok: false, error: 'no such chat' })
    emit({ type: 'session_started', sessionId: 'sess-1' })

    await waitFor(() => {
      expect(octopus().chats.usage).toHaveBeenCalledTimes(2)
    })
    expect(result.current.context?.percentage).toBe(48)
  })

  // The context share belongs to one conversation. The previous one left on
  // screen is not a stale number, it is a wrong one.
  it('forgets everything the moment the conversation changes', async () => {
    answering(READING)
    const { result, rerender } = renderHook(({ id }) => useSessionUsage(id), {
      initialProps: { id: CHAT }
    })
    await waitFor(() => {
      expect(result.current.context?.percentage).toBe(48)
    })

    vi.mocked(octopus().chats.usage).mockReturnValue(new Promise(() => undefined))
    rerender({ id: 'chat-2' })

    expect(result.current).toEqual({ context: null })
  })

  /*
   * The read the pane left behind. `sessionUsage` asks the running agent and
   * then the network for the account's windows, so the answer for the
   * conversation just left can easily land after the next one is on screen —
   * and it would put one conversation's context share under another's name.
   *
   * The previous test asserted a promise the test itself had made, so deleting
   * the guard left the suite green. This one settles the abandoned read while
   * the pane is showing the next conversation, which is the case that matters.
   */
  it('drops the answer for the conversation the pane has left', async () => {
    const abandoned = held<Result<SessionUsage>>()
    vi.mocked(octopus().chats.usage)
      .mockReturnValueOnce(abandoned.promise)
      .mockReturnValue(new Promise(() => undefined))

    const { result, rerender } = renderHook(({ id }) => useSessionUsage(id), {
      initialProps: { id: CHAT }
    })
    await waitFor(() => {
      expect(octopus().chats.usage).toHaveBeenCalledWith(CHAT)
    })

    rerender({ id: 'chat-2' })
    await act(async () => {
      abandoned.resolve({ ok: true, value: READING })
      await abandoned.promise
    })

    expect(result.current).toEqual({ context: null })
  })
})
