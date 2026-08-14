import { act } from '@testing-library/react'
import { vi } from 'vitest'

import type { Chat } from '@core/chats.js'
import type { AgentEvent } from '@core/events.js'
import type { ChatEntry } from '@core/transcript.js'

import { octopus } from './octopus.js'

export const CHAT_ID = 'chat-1'

/** A chat record as the bridge would answer with one. */
export function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: CHAT_ID,
    workspaceId: 'planner/anna',
    agent: 'claude',
    sessionId: null,
    model: null,
    effort: 'medium',
    workingMode: 'default',
    planMode: false,
    knownCommands: [],
    createdAt: '2026-08-11T09:00:00.000Z',
    ...overrides
  }
}

/**
 * Makes the stubbed bridge answer as though this chat already existed.
 *
 * Without it `chats.list` comes back empty, which is the state of a workspace
 * nobody has written in — correct, but not the one most tests are about.
 */
export function givenChat(history: ChatEntry[] = [], overrides: Partial<Chat> = {}): Chat {
  const record = chat(overrides)

  vi.mocked(octopus().chats.list).mockResolvedValue({ ok: true, value: [record] })
  vi.mocked(octopus().chats.history).mockResolvedValue({ ok: true, value: history })

  return record
}

/**
 * Delivers an agent event to whatever subscribed, as main would.
 *
 * Wrapped in `act` because it lands outside React's own event handling: the
 * broadcast arrives from IPC, not from a click.
 */
export function emitAgentEvent(event: AgentEvent, chatId: string = CHAT_ID): void {
  const handlers = vi.mocked(octopus().chats.onEvent).mock.calls.map(([handler]) => handler)

  act(() => {
    for (const handler of handlers) {
      handler({ chatId, workspaceId: 'planner/anna', event })
    }
  })
}
