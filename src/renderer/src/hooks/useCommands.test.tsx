import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { AgentCommand } from '@core/chats.js'
import type { AgentEvent } from '@core/events.js'

import type { Result } from '../../../preload/index.js'
import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { useCommands } from './useCommands.js'

const CLEAR: AgentCommand = {
  name: 'clear',
  description: 'Start a new session with empty context',
  argumentHint: '[name]',
  aliases: ['reset']
}

const DEPLOY: AgentCommand = {
  name: 'deploy',
  description: 'Ship it',
  argumentHint: '<env>',
  aliases: []
}

/** Delivers an event the way the bridge does, to whoever subscribed. */
function emit(event: AgentEvent, chatId = 'chat-1'): void {
  const [subscriber] = vi.mocked(octopus().chats.onEvent).mock.calls.at(-1) ?? []
  subscriber?.({ chatId, workspaceId: 'planner/kyiv', event })
}

describe('the commands a chat may use', () => {
  it('asks when the chat opens', async () => {
    vi.mocked(octopus().chats.commands).mockResolvedValue({ ok: true, value: [CLEAR] })

    const { result } = renderHook(() => useCommands('chat-1'))

    await waitFor(() => {
      expect(result.current).toEqual([CLEAR])
    })
    expect(octopus().chats.commands).toHaveBeenCalledWith('chat-1')
  })

  // A workspace nobody has written in has no chat yet, and nothing to ask about.
  it('asks nothing when there is no chat', () => {
    renderHook(() => useCommands(null))

    expect(octopus().chats.commands).not.toHaveBeenCalled()
  })

  // The agent can only be asked while a session is running, so a session
  // starting is the one moment a list that was empty can stop being empty.
  it('asks again when a session starts', async () => {
    vi.mocked(octopus().chats.commands).mockResolvedValue({ ok: true, value: [] })
    const { result } = renderHook(() => useCommands('chat-1'))
    await waitFor(() => {
      expect(octopus().chats.commands).toHaveBeenCalledTimes(1)
    })

    vi.mocked(octopus().chats.commands).mockResolvedValue({ ok: true, value: [CLEAR] })
    emit({ type: 'session_started', sessionId: 'sess-1' })

    await waitFor(() => {
      expect(result.current).toEqual([CLEAR])
    })
  })

  /*
   * Taken from the event rather than asked for again. The SDK pushes the whole
   * list and says to replace the cached one, and a round trip here would only
   * be a chance for the two to disagree.
   */
  it('takes a new list straight from the announcement', async () => {
    vi.mocked(octopus().chats.commands).mockResolvedValue({ ok: true, value: [CLEAR] })
    const { result } = renderHook(() => useCommands('chat-1'))
    await waitFor(() => {
      expect(result.current).toEqual([CLEAR])
    })

    emit({ type: 'commands_changed', commands: [DEPLOY] })

    await waitFor(() => {
      expect(result.current).toEqual([DEPLOY])
    })
    expect(octopus().chats.commands).toHaveBeenCalledTimes(1)
  })

  // Events are broadcast to every window and cover every chat. A command from
  // another worktree may not exist in this one at all.
  it('ignores what another chat was told', async () => {
    vi.mocked(octopus().chats.commands).mockResolvedValue({ ok: true, value: [CLEAR] })
    const { result } = renderHook(() => useCommands('chat-1'))
    await waitFor(() => {
      expect(result.current).toEqual([CLEAR])
    })

    emit({ type: 'commands_changed', commands: [DEPLOY] }, 'chat-2')

    expect(result.current).toEqual([CLEAR])
  })

  it('ignores an event that changes nothing about the list', async () => {
    vi.mocked(octopus().chats.commands).mockResolvedValue({ ok: true, value: [CLEAR] })
    const { result } = renderHook(() => useCommands('chat-1'))
    await waitFor(() => {
      expect(result.current).toEqual([CLEAR])
    })

    emit({ type: 'text', text: 'working on it' })

    expect(octopus().chats.commands).toHaveBeenCalledTimes(1)
    expect(result.current).toEqual([CLEAR])
  })

  /*
   * Cleared during render rather than in an effect: an effect runs after the
   * paint, so the previous chat's commands would be offered for a frame — and
   * offering a command that does not exist in this worktree is worse than
   * offering none.
   */
  it('forgets the previous chat immediately when the workspace changes', async () => {
    vi.mocked(octopus().chats.commands).mockResolvedValue({ ok: true, value: [CLEAR] })
    const { result, rerender } = renderHook(({ id }: { id: string }) => useCommands(id), {
      initialProps: { id: 'chat-1' }
    })
    await waitFor(() => {
      expect(result.current).toEqual([CLEAR])
    })

    vi.mocked(octopus().chats.commands).mockResolvedValue({ ok: true, value: [DEPLOY] })
    rerender({ id: 'chat-2' })

    // Empty on the very first render after the switch, not one paint later.
    expect(result.current).toEqual([])
    await waitFor(() => {
      expect(result.current).toEqual([DEPLOY])
    })
  })

  /*
   * The agent takes its time, and the read can be abandoned before it answers —
   * the window mounts the hook, tears it down and mounts it again under
   * `StrictMode`, which is how the application runs in development.
   */
  it('drops the answer to a read it has already abandoned', async () => {
    const abandoned = held<Result<AgentCommand[]>>()
    vi.mocked(octopus().chats.commands)
      .mockReturnValueOnce(abandoned.promise)
      .mockResolvedValue({ ok: true, value: [DEPLOY] })

    const { result } = renderHook(() => useCommands('chat-1'), { wrapper: StrictMode })
    await waitFor(() => {
      expect(result.current).toEqual([DEPLOY])
    })

    await act(async () => {
      abandoned.resolve({ ok: true, value: [CLEAR] })
      await abandoned.promise
    })

    expect(result.current).toEqual([DEPLOY])
  })

  // An empty list would claim this workspace has no commands, which is a
  // different and wrong statement from "could not ask just now".
  it('keeps the list it had when the next read fails', async () => {
    vi.mocked(octopus().chats.commands).mockResolvedValue({ ok: true, value: [CLEAR] })
    const { result } = renderHook(() => useCommands('chat-1'))
    await waitFor(() => {
      expect(result.current).toEqual([CLEAR])
    })

    vi.mocked(octopus().chats.commands).mockResolvedValue({ ok: false, error: 'no session' })
    emit({ type: 'session_started', sessionId: 'sess-1' })

    await waitFor(() => {
      expect(octopus().chats.commands).toHaveBeenCalledTimes(2)
    })
    expect(result.current).toEqual([CLEAR])
  })
})
