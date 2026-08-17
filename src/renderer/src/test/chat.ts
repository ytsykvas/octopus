import { act } from '@testing-library/react'
import { vi } from 'vitest'

import type { Chat, ChatStatus } from '@core/chats.js'
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
    status: 'idle',
    title: null,
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
 * Makes the bridge answer with several conversations — a workspace with tabs.
 *
 * Separate from `givenChat` rather than replacing it: most tests are about one
 * conversation and would only be made longer by naming the others.
 */
export function givenChats(records: readonly Chat[]): readonly Chat[] {
  vi.mocked(octopus().chats.list).mockResolvedValue({ ok: true, value: [...records] })
  return records
}

/**
 * Delivers a status change to whatever subscribed, as main would.
 *
 * The twin of `emitAgentEvent`, and wrapped in `act` for the same reason: it
 * arrives from IPC rather than from a click.
 */
export function emitChatStatus(
  chatId: string,
  status: ChatStatus,
  workspaceId = 'planner/anna'
): void {
  const handlers = vi.mocked(octopus().chats.onStatus).mock.calls.map(([handler]) => handler)

  act(() => {
    for (const handler of handlers) {
      handler({ chatId, workspaceId, status })
    }
  })
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
