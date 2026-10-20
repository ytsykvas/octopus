import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AgentEntry } from '@core/chats.js'
import type { AgentEvent } from '@core/events.js'

import { refuseSilence } from '../test/chat.js'
import { octopus } from '../test/octopus.js'
import { useAgents } from './useAgents.js'

const EXPLORE: AgentEntry = { name: 'Explore', description: 'Searches the code' }
const PLAN: AgentEntry = { name: 'Plan', description: 'Designs the change' }

/** Delivers an event the way the bridge does, to whoever subscribed. */
function emit(event: AgentEvent): void {
  const calls = vi.mocked(octopus().chats.onEvent).mock.calls
  refuseSilence(calls.length, 'chats.onEvent')

  const [subscriber] = calls.at(-1) ?? []
  subscriber?.({ chatId: 'chat-1', workspaceId: 'planner/kyiv', event })
}

/*
 * The `@` list rides on the same hook as the commands — `useSessionAnswer`,
 * whose behaviour `useCommands.test` pins — so this pins only what is the
 * agents' own: where they are read from, and the event that replaces them.
 */
describe('the subagents a chat may mention', () => {
  it('asks the chat for its agents when it opens', async () => {
    vi.mocked(octopus().chats.agents).mockResolvedValue({ ok: true, value: [EXPLORE] })

    const { result } = renderHook(() => useAgents('chat-1'))

    await waitFor(() => {
      expect(result.current).toEqual([EXPLORE])
    })
    expect(octopus().chats.agents).toHaveBeenCalledWith('chat-1')
  })

  it('takes the list the session announces, and nothing else', async () => {
    vi.mocked(octopus().chats.agents).mockResolvedValue({ ok: true, value: [EXPLORE] })
    const { result } = renderHook(() => useAgents('chat-1'))
    await waitFor(() => {
      expect(result.current).toEqual([EXPLORE])
    })

    // A command list is not an agent list, however alike they are shaped.
    emit({ type: 'commands_changed', commands: [] })
    emit({ type: 'agents_changed', agents: [PLAN] })

    await waitFor(() => {
      expect(result.current).toEqual([PLAN])
    })
  })
})
