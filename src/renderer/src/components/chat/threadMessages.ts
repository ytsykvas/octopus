import type { ThreadMessageLike } from '@assistant-ui/react'

import type { ChatEntry } from '@core/transcript.js'

import { localDayKey } from './format.js'
import type { LogBlock } from './logBlocks.js'

/**
 * What a log block is, as the library's runtime sees one.
 *
 * Every block rides as a `data` part carrying itself, and nothing is mapped onto
 * the library's own `text`, `reasoning` or `tool-call` parts. The log is one row
 * per event rather than a bubble per turn, with rules the library has no word
 * for — a call and its answer as one row, an edit drawn as a diff, an answer struck
 * through because the agent took it back — and every one of them lives in the
 * block. Translating into the library's parts would mean encoding those rules
 * a second time, and being wrong about them in one of the two places.
 */
export const BLOCK_PART = 'block'

/**
 * The part that opens a day: a separator, carrying the day's key.
 *
 * A part of the message that starts the day rather than a message of its own,
 * so the thread the library holds is still one message per turn. The key and
 * never its label: "Today" is true when the chip is drawn and false a day
 * later, and a label baked in here would be cached with the message.
 */
export const DAY_PART = 'day'

/**
 * The log as a list of messages: one per turn.
 *
 * A turn is what the user said and everything the agent did in answer, up to
 * the next thing the user said. The message's id is the position of its first
 * block, which is stable for as long as it exists — the log is only ever added
 * to or cut back from the end by a rewind, never reordered, so a position names
 * one message until the message is gone (`ChatLog` keys its rows the same way).
 *
 * A message that begins a calendar day the one before it did not opens with a
 * `DAY_PART`, the first message of all included. The day is the first block's,
 * so an agent turn that runs past midnight is dated where it began: the
 * separator marks where the reader's day changed, and a mark in the middle of
 * one turn would split an answer from its question.
 *
 * The identity of what is handed over matters to the library: it caches a
 * message by the object it was given, and rebuilding every message on every
 * change makes it re-walk the thread. So this is held against the blocks by the
 * caller, and each message is a fresh object only because its turn changed.
 */
export function toThreadMessages(
  blocks: readonly LogBlock[],
  entries: readonly ChatEntry[]
): ThreadMessageLike[] {
  const messages: ThreadMessageLike[] = []
  let turn: LogBlock[] = []
  let lastDay: string | null = null

  /*
   * The separator a message opens with, if it opens a day.
   *
   * Read from the entry the block began at: a block's `at` is its position in
   * the log, and a change block keeps no entry of its own to read a time from.
   */
  const opening = (first: LogBlock): { type: 'data'; name: string; data: string }[] => {
    const entry = entries[first.at]
    // Every block is built from these entries, so its position is always in
    // range; the guard is for the type, which cannot know that.
    /* v8 ignore next */
    if (entry === undefined) return []

    const day = localDayKey(entry.at)
    if (day === lastDay) return []

    lastDay = day
    return [{ type: 'data', name: DAY_PART, data: day }]
  }

  const flush = (): void => {
    const [first] = turn
    if (first === undefined) return

    messages.push({
      id: `agent-${String(first.at)}`,
      role: 'assistant',
      content: [
        ...opening(first),
        ...turn.map((block) => ({ type: 'data' as const, name: BLOCK_PART, data: block }))
      ],
      // The runtime is never "running": the log draws its own working marker,
      // and a library-owned one would be a second.
      status: { type: 'complete', reason: 'stop' }
    })
    turn = []
  }

  for (const block of blocks) {
    if (block.kind === 'entry' && block.entry.role === 'user') {
      flush()
      messages.push({
        id: `user-${String(block.at)}`,
        role: 'user',
        content: [...opening(block), { type: 'data', name: BLOCK_PART, data: block }]
      })
      continue
    }

    turn.push(block)
  }

  flush()
  return messages
}
