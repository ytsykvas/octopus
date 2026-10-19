import { describe, expect, it } from 'vitest'

import type { ChatEntry } from '@core/transcript.js'

import { BLOCK_PART, DAY_PART, toThreadMessages } from './threadMessages.js'
import type { LogBlock } from './logBlocks.js'

const AT = '2026-08-13T09:00:00.000Z'

const user = (at: number, text: string, when = AT): LogBlock => ({
  kind: 'entry',
  at,
  entry: { role: 'user', at: when, text }
})

const said = (at: number, text: string, when = AT): LogBlock => ({
  kind: 'entry',
  at,
  entry: { role: 'agent', at: when, event: { type: 'text', text } } as ChatEntry
})

/**
 * The blocks with the log they were built from, as `ChatLog` hands them over.
 *
 * A block that is not one entry stands on the entry at its position, which is
 * what the real grouping does: a run of tools starts with its first call.
 */
function messagesOf(...blocks: LogBlock[]): ReturnType<typeof toThreadMessages> {
  const entries: ChatEntry[] = []
  for (const block of blocks) {
    entries[block.at] =
      block.kind === 'entry'
        ? block.entry
        : { role: 'agent', at: AT, event: { type: 'text', text: '' } }
  }

  return toThreadMessages(blocks, entries)
}

/** The day each message opens, or null for one that continues a day. */
const days = (messages: ReturnType<typeof toThreadMessages>): (string | null)[] =>
  messages.map((message) => {
    const [first] = message.content as readonly { name?: string; data?: unknown }[]
    return first?.name === DAY_PART ? (first.data as string) : null
  })

describe('the log as the library sees it', () => {
  it('is empty for an empty log', () => {
    expect(messagesOf()).toEqual([])
  })

  it('makes a message of each turn: what was said, then what the agent did', () => {
    const blocks = [user(0, 'rename it'), said(1, 'On it.'), said(2, 'Done.'), user(3, 'thanks')]

    const messages = messagesOf(...blocks)

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
    const messages = messagesOf(user(0, 'a'), said(1, 'b'), user(2, 'c'), said(3, 'd'))

    expect(messages.map((message) => message.id)).toEqual([
      'user-0',
      'agent-1',
      'user-2',
      'agent-3'
    ])
  })

  // After a clear, or a transcript that opens on the agent speaking.
  it('keeps what the agent did before anyone spoke', () => {
    const messages = messagesOf(said(0, 'Welcome back.'), user(1, 'hi'))

    expect(messages.map((message) => message.role)).toEqual(['assistant', 'user'])
  })

  it('keeps a user message as a block of its own', () => {
    const [message] = messagesOf(user(0, 'hello'))

    expect(message).toMatchObject({
      role: 'user',
      content: [
        { type: 'data', name: DAY_PART },
        { type: 'data', name: BLOCK_PART, data: { kind: 'entry', at: 0 } }
      ]
    })
  })

  // Never "running": the log draws its own working marker.
  it('never says an assistant message is still running', () => {
    const [message] = messagesOf(said(0, 'hi'))

    expect(message).toMatchObject({ status: { type: 'complete' } })
  })

  it('gives a block that is not an entry the same treatment', () => {
    const tools: LogBlock = {
      kind: 'tool',
      at: 1,
      call: {
        toolUseId: 'c-1',
        name: 'Read',
        input: {},
        uuid: undefined,
        result: null,
        change: null,
        context: null,
        settled: false,
        steps: null
      }
    }
    const messages = messagesOf(user(0, 'go'), tools)

    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'data', data: tools }]
    })
  })

  // Kyiv time (`vitest.shared.ts`): 21:30 UTC is already half past midnight.
  describe('where a day begins', () => {
    it('opens the first message with its day, and only it while the day holds', () => {
      const messages = messagesOf(user(0, 'a'), said(1, 'b'), user(2, 'c'))

      expect(days(messages)).toEqual(['2026-08-13', null, null])
    })

    it('opens the message that starts another day, by the reader’s clock', () => {
      const messages = messagesOf(
        user(0, 'evening', '2026-08-13T18:00:00.000Z'),
        said(1, 'late', '2026-08-13T20:30:00.000Z'),
        user(2, 'after midnight', '2026-08-13T21:30:00.000Z')
      )

      expect(days(messages)).toEqual(['2026-08-13', null, '2026-08-14'])
    })

    it('dates an agent turn by where it began, not by where it ran to', () => {
      const messages = messagesOf(
        user(0, 'go', '2026-08-13T20:50:00.000Z'),
        said(1, 'started', '2026-08-13T20:55:00.000Z'),
        said(2, 'finished', '2026-08-13T21:10:00.000Z')
      )

      expect(days(messages)).toEqual(['2026-08-13', null])
    })

    it('lets an agent turn open a day when it is the first thing on it', () => {
      const messages = messagesOf(
        user(0, 'go', '2026-08-12T09:00:00.000Z'),
        said(1, 'done next morning', '2026-08-13T09:00:00.000Z')
      )

      expect(days(messages)).toEqual(['2026-08-12', '2026-08-13'])
    })
  })
})
