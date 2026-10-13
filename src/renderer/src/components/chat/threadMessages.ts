import type { ThreadMessageLike } from '@assistant-ui/react'

import type { LogBlock } from './toolRuns.js'

/**
 * What a log block is, as the library's runtime sees one.
 *
 * Every block rides as a `data` part carrying itself, and nothing is mapped onto
 * the library's own `text`, `reasoning` or `tool-call` parts. The log is one row
 * per event rather than a bubble per turn, with rules the library has no word
 * for — a run folded into its count, an edit drawn as a diff, an answer struck
 * through because the agent took it back — and every one of them lives in the
 * block. Translating into the library's parts would mean encoding those rules
 * a second time, and being wrong about them in one of the two places.
 */
export const BLOCK_PART = 'block'

/**
 * The log as a list of messages: one per turn.
 *
 * A turn is what the user said and everything the agent did in answer, up to
 * the next thing the user said. The message's id is the position of its first
 * block, which is stable for as long as it exists — the log is append-only, and
 * nothing is ever reordered or removed (`ChatLog` keys its rows the same way).
 *
 * The identity of what is handed over matters to the library: it caches a
 * message by the object it was given, and rebuilding every message on every
 * change makes it re-walk the thread. So this is held against the blocks by the
 * caller, and each message is a fresh object only because its turn changed.
 */
export function toThreadMessages(blocks: readonly LogBlock[]): ThreadMessageLike[] {
  const messages: ThreadMessageLike[] = []
  let turn: LogBlock[] = []

  const flush = (): void => {
    const [first] = turn
    if (first === undefined) return

    messages.push({
      id: `agent-${String(first.at)}`,
      role: 'assistant',
      content: turn.map((block) => ({ type: 'data', name: BLOCK_PART, data: block })),
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
        content: [{ type: 'data', name: BLOCK_PART, data: block }]
      })
      continue
    }

    turn.push(block)
  }

  flush()
  return messages
}
