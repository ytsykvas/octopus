/**
 * Rewinding a conversation — what can be put back, and where the cut falls.
 *
 * Pure, and importing nothing but zod, so the window may take values from it:
 * the scopes are what the rewind dialog offers.
 */

import { z } from 'zod'

import type { FileRewind } from './chats.js'

/**
 * What a rewind puts back: the conversation, the files, or both.
 *
 * The three Claude Code's own `/rewind` offers, for the same reason it offers
 * them. The two halves are independent — a wrong turn in the code with a useful
 * discussion around it wants the files alone, a conversation that wandered
 * over code worth keeping wants the conversation alone.
 */
export const REWIND_SCOPES = ['both', 'conversation', 'files'] as const
export const RewindScopeSchema = z.enum(REWIND_SCOPES)
export type RewindScope = z.infer<typeof RewindScopeSchema>

/** Whether a scope touches the conversation, the files, or both. */
export const rewindsConversation = (scope: RewindScope): boolean => scope !== 'files'
export const rewindsFiles = (scope: RewindScope): boolean => scope !== 'conversation'

/**
 * What a rewind to a message could do, asked before anything is done.
 *
 * `files` is null when the files cannot be asked about at all — another
 * conversation of the workspace is working — and otherwise the agent's own
 * dry run, `canRewind` false included. Neither half failing refuses the other:
 * the dialog shows each choice with its own reason.
 */
export interface RewindPreview {
  readonly conversation: boolean
  readonly files: FileRewind | null
}

/** What a rewind did. */
export interface RewindOutcome {
  /** The files' half, when it was asked for. */
  readonly files: FileRewind | null
  /**
   * The text of the message rewound to, when the conversation was: it goes
   * back into the composer to be edited and sent again.
   */
  readonly text: string | null
}

/**
 * A session's history as the SDK reads it back, narrowed to what the cut needs.
 *
 * Only the ids: a chain entry's `message` is the CLI's own shape, and nothing
 * here should depend on it.
 */
export const SessionChainSchema = z.array(z.object({ uuid: z.string() }))

/**
 * Where the agent's memory is cut to rewind to a message.
 *
 * `at` names the entry just before the message — the last thing the agent
 * will remember. `fresh` is a message nothing precedes, so there is nothing to
 * keep and the next session simply starts new. `missing` is a message the
 * chain does not hold: one from before a compaction, which replaces the early
 * chain with a summary, or one from a conversation forked off another, whose
 * ids the fork rewrote.
 */
export type CutPoint =
  | { readonly kind: 'at'; readonly uuid: string }
  | { readonly kind: 'fresh' }
  | { readonly kind: 'missing' }

export function cutBefore(chain: unknown, messageId: string): CutPoint {
  const parsed = SessionChainSchema.safeParse(chain)
  if (!parsed.success) return { kind: 'missing' }

  const at = parsed.data.findIndex((entry) => entry.uuid === messageId)
  if (at === -1) return { kind: 'missing' }

  const before = parsed.data[at - 1]
  return before === undefined ? { kind: 'fresh' } : { kind: 'at', uuid: before.uuid }
}
