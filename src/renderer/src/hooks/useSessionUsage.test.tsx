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
  context: {
    percentage: 48,
    usedTokens: 48_000,
    maxTokens: 200_000,
    compactsAt: null,
    autoCompactOn: null,
    model: 'claude-opus-5',
    modelWindow: null,
    breakdown: null
  },
  autoCompact: null
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
    answering({ context: null, autoCompact: null })
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
    answering({ context: null, autoCompact: null })
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

  // The reading counts to where the agent compacts, so the figure a compaction
  // leaves is counted to it as well. 97 400 is 20% of a 487k threshold and 19%
  // of the 500k window; the second would then jump when the next turn read it.
  it('counts the figure after a compaction to the threshold when there is one', async () => {
    answering({
      ...READING,
      context: { ...READING.context!, maxTokens: 500_000, compactsAt: 487_000, autoCompactOn: true }
    })
    const { result } = renderHook(() => useSessionUsage(CHAT))
    await waitFor(() => {
      expect(result.current.context?.compactsAt).toBe(487_000)
    })

    act(() => {
      emit({
        type: 'conversation_compacted',
        trigger: 'auto',
        preTokens: 487_000,
        postTokens: 97_400
      })
    })

    expect(result.current.context?.percentage).toBe(20)
    expect(result.current.context?.maxTokens).toBe(500_000)
  })

  // A compaction can arrive before any reading has: there is no window to
  // measure the figure against, so it waits for the next turn like everything
  // else the strip has nothing to say about.
  it('claims nothing when a compaction arrives before the first reading', async () => {
    answering({ context: null, autoCompact: null })
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
    answering({ context: null, autoCompact: null })
    renderHook(() => useSessionUsage(CHAT))
    await waitFor(() => {
      expect(octopus().chats.usage).toHaveBeenCalledTimes(1)
    })

    emit({ type: 'text', text: 'working on it' })

    expect(octopus().chats.usage).toHaveBeenCalledTimes(1)
  })

  it('ignores a turn that ended in another conversation', async () => {
    answering({ context: null, autoCompact: null })
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

    expect(result.current).toEqual({ context: null, autoCompact: null })
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

    expect(result.current).toEqual({ context: null, autoCompact: null })
  })
})

/*
 * A window chosen in the menu starts the session again, and the reading is
 * measured against the window — so it is asked for again each time the caller
 * says a choice has landed, the same window chosen twice included. A model
 * chosen in the panel moves the session at once too.
 */
describe('a choice that moves the session', () => {
  /*
   * The reading takes most of a second, and the model it named before the
   * choice is the one the composer would otherwise go on calling "chosen by
   * /model" — under the reader's own click. Unknown is the honest answer until
   * the new reading lands; the share of the window is still right.
   */
  it('forgets the running model until the new reading lands', async () => {
    answering(READING)
    const { result, rerender } = renderHook(
      ({ asked }: { asked: number }) => useSessionUsage(CHAT, asked),
      { initialProps: { asked: 0 } }
    )
    await waitFor(() => {
      expect(result.current.context?.model).toBe('claude-opus-5')
    })
    const reading = held<Result<SessionUsage>>()
    vi.mocked(octopus().chats.usage).mockReturnValueOnce(reading.promise)

    rerender({ asked: 1 })

    expect(result.current.context?.model).toBeNull()
    expect(result.current.context?.percentage).toBe(48)

    await act(async () => {
      reading.resolve({
        ok: true,
        value: { ...READING, context: { ...READING.context!, model: 'claude-sonnet-5' } }
      })
      await reading.promise
    })
    expect(result.current.context?.model).toBe('claude-sonnet-5')
  })

  it('asks again each time a choice has been applied', async () => {
    answering(READING)
    const { rerender } = renderHook(
      ({ asked }: { asked: number }) => useSessionUsage(CHAT, asked),
      {
        initialProps: { asked: 0 }
      }
    )
    await waitFor(() => {
      expect(octopus().chats.usage).toHaveBeenCalledTimes(1)
    })

    rerender({ asked: 1 })
    await waitFor(() => {
      expect(octopus().chats.usage).toHaveBeenCalledTimes(2)
    })

    rerender({ asked: 2 })
    await waitFor(() => {
      expect(octopus().chats.usage).toHaveBeenCalledTimes(3)
    })
  })
})
