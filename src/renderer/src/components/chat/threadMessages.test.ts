import { describe, expect, it } from 'vitest'

import type { ChatEntry } from '@core/transcript.js'

import { BLOCK_PART, toThreadMessages } from './threadMessages.js'
import type { LogBlock } from './toolRuns.js'

const AT = '2026-08-13T09:00:00.000Z'

const user = (at: number, text: string): LogBlock => ({
  kind: 'entry',
  at,
  entry: { role: 'user', at: AT, text }
})

const said = (at: number, text: string): LogBlock => ({
  kind: 'entry',
  at,
  entry: { role: 'agent', at: AT, event: { type: 'text', text } } as ChatEntry
})

describe('the log as the library sees it', () => {
  it('is empty for an empty log', () => {
    expect(toThreadMessages([])).toEqual([])
  })

  it('makes a message of each turn: what was said, then what the agent did', () => {
    const blocks = [user(0, 'rename it'), said(1, 'On it.'), said(2, 'Done.'), user(3, 'thanks')]

    const messages = toThreadMessages(blocks)

    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'data', name: BLOCK_PART, data: blocks[1] },
        { type: 'data', name: BLOCK_PART, data: blocks[2] }
      ]
    })
  })

  // Position is the identity: the log is append-only, so where a turn starts
  // names it for as long as it exists.
  it('names a message by where its turn begins', () => {
    const messages = toThreadMessages([user(0, 'a'), said(1, 'b'), user(2, 'c'), said(3, 'd')])

    expect(messages.map((message) => message.id)).toEqual([
      'user-0',
      'agent-1',
      'user-2',
      'agent-3'
    ])
  })

  // After a clear, or a transcript that opens on the agent speaking.
  it('keeps what the agent did before anyone spoke', () => {
    const messages = toThreadMessages([said(0, 'Welcome back.'), user(1, 'hi')])

    expect(messages.map((message) => message.role)).toEqual(['assistant', 'user'])
  })

  it('keeps a user message as a block of its own', () => {
    const [message] = toThreadMessages([user(0, 'hello')])

    expect(message).toMatchObject({
      role: 'user',
      content: [{ type: 'data', name: BLOCK_PART, data: { kind: 'entry', at: 0 } }]
    })
  })

  // Never "running": the log draws its own working marker.
  it('never says an assistant message is still running', () => {
    const [message] = toThreadMessages([said(0, 'hi')])

    expect(message).toMatchObject({ status: { type: 'complete' } })
  })

  it('gives a block that is not an entry the same treatment', () => {
    const tools: LogBlock = { kind: 'tools', at: 1, entries: [] }
    const messages = toThreadMessages([user(0, 'go'), tools])

    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'data', data: tools }]
    })
  })
})
