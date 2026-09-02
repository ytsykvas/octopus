import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { AgentModel } from '@core/chats.js'
import type { AgentEvent } from '@core/events.js'

import type { Result } from '../../../preload/index.js'
import { refuseSilence } from '../test/chat.js'
import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { useModels } from './useModels.js'

const OPUS: AgentModel = {
  value: 'claude-opus-5',
  resolvedModel: null,
  displayName: 'Opus 5',
  description: '',
  supportsEffort: true,
  supportedEffortLevels: ['high']
}

const SONNET: AgentModel = {
  value: 'claude-sonnet-5',
  resolvedModel: null,
  displayName: 'Sonnet 5',
  description: '',
  supportsEffort: true,
  supportedEffortLevels: ['high']
}

/** Delivers an event the way the bridge does, to whoever subscribed. */
function emit(event: AgentEvent): void {
  const calls = vi.mocked(octopus().chats.onEvent).mock.calls
  refuseSilence(calls.length, 'chats.onEvent')

  const [subscriber] = calls.at(-1) ?? []
  subscriber?.({ chatId: 'chat-1', workspaceId: 'planner/kyiv', event })
}

describe('the models the account may use', () => {
  it('asks once when the pane opens', async () => {
    vi.mocked(octopus().chats.models).mockResolvedValue({ ok: true, value: [OPUS] })

    const { result } = renderHook(() => useModels())

    await waitFor(() => {
      expect(result.current).toHaveLength(1)
    })
  })

  // The agent can only be asked while a session is running, so a session
  // starting is the one moment the answer can have changed.
  it('asks again when a session starts', async () => {
    vi.mocked(octopus().chats.models).mockResolvedValue({ ok: true, value: [] })
    const { result } = renderHook(() => useModels())
    await waitFor(() => {
      expect(octopus().chats.models).toHaveBeenCalledTimes(1)
    })

    vi.mocked(octopus().chats.models).mockResolvedValue({ ok: true, value: [OPUS] })
    emit({ type: 'session_started', sessionId: 'sess-1' })

    await waitFor(() => {
      expect(result.current).toHaveLength(1)
    })
  })

  it('ignores an event that is not a session starting', async () => {
    vi.mocked(octopus().chats.models).mockResolvedValue({ ok: true, value: [] })
    renderHook(() => useModels())
    await waitFor(() => {
      expect(octopus().chats.models).toHaveBeenCalledTimes(1)
    })

    emit({ type: 'text', text: 'working on it' })

    expect(octopus().chats.models).toHaveBeenCalledTimes(1)
  })

  /*
   * The agent takes its time answering, and the read can be abandoned before it
   * does — the window mounts the hook, tears it down and mounts it again under
   * `StrictMode`, which is how the application actually runs in development.
   * Without the guard both reads apply and the abandoned one can land last,
   * leaving the picker showing a list that has already been replaced.
   *
   * This used to unmount and then assert on a promise the test had made itself,
   * which meant deleting the guard left the suite green.
   */
  it('drops the answer to a read it has already abandoned', async () => {
    const abandoned = held<Result<AgentModel[]>>()
    vi.mocked(octopus().chats.models)
      .mockReturnValueOnce(abandoned.promise)
      .mockResolvedValue({ ok: true, value: [SONNET] })

    const { result } = renderHook(() => useModels(), { wrapper: StrictMode })
    await waitFor(() => {
      expect(result.current).toEqual([SONNET])
    })

    await act(async () => {
      abandoned.resolve({ ok: true, value: [OPUS] })
      await abandoned.promise
    })

    expect(result.current).toEqual([SONNET])
  })

  // An empty picker would claim the account has no models, which is a different
  // and wrong statement from "could not ask just now".
  it('keeps the list it had when the next read fails', async () => {
    vi.mocked(octopus().chats.models).mockResolvedValue({ ok: true, value: [OPUS] })
    const { result } = renderHook(() => useModels())
    await waitFor(() => {
      expect(result.current).toHaveLength(1)
    })

    vi.mocked(octopus().chats.models).mockResolvedValue({ ok: false, error: 'no session' })
    emit({ type: 'session_started', sessionId: 'sess-1' })

    await waitFor(() => {
      expect(octopus().chats.models).toHaveBeenCalledTimes(2)
    })
    expect(result.current).toHaveLength(1)
  })
})
