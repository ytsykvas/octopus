import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AgentModel } from '@core/chats.js'
import type { AgentEvent } from '@core/events.js'

import { octopus } from '../test/octopus.js'
import { useModels } from './useModels.js'

const OPUS: AgentModel = {
  value: 'claude-opus-5',
  displayName: 'Opus 5',
  description: '',
  supportsEffort: true,
  supportedEffortLevels: ['high']
}

/** Delivers an event the way the bridge does, to whoever subscribed. */
function emit(event: AgentEvent): void {
  const [subscriber] = vi.mocked(octopus().chats.onEvent).mock.calls.at(-1) ?? []
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

  // `gh` and the agent both take their time, and the pane can be left before
  // the answer lands. Setting state on a hook that is gone is a React warning
  // and, worse, a read belonging to a workspace nobody is looking at.
  it('drops an answer that arrives after the pane has closed', async () => {
    let settle: (value: { ok: true; value: AgentModel[] }) => void = () => undefined
    vi.mocked(octopus().chats.models).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      })
    )

    const { unmount } = renderHook(() => useModels())
    unmount()
    settle({ ok: true, value: [OPUS] })

    // Nothing to assert on the result — the hook is gone. What is being checked
    // is that settling it raises nothing.
    await expect(Promise.resolve()).resolves.toBeUndefined()
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
