import { useCallback, useState } from 'react'

import { commentKey, type PullRequestComment } from '@core/pullRequestShapes.js'

/**
 * A remark from the review, waiting to go out with the next message.
 *
 * Flattened out of `PullRequestComment` rather than held as one: what the
 * composer needs is a line naming where it came from and the text of it, and
 * the three kinds of comment answer that differently. Deciding it here means
 * the chip and the message agree by construction.
 */
export interface PullRequestQuote {
  /** `commentKey` — the kind and the id, which is what makes it the same remark. */
  readonly key: string
  /** Which request it was said on, so the message names it. */
  readonly reference: string
  readonly author: string | null
  /** `src/core/git.ts:42` for an inline note, null for anything else. */
  readonly place: string | null
  /** The hunk GitHub kept, where there is one. */
  readonly quote: string | null
  readonly body: string
}

export interface PullRequestQuoteController {
  readonly pending: readonly PullRequestQuote[]
  readonly add: (quote: PullRequestQuote) => void
  readonly remove: (quote: PullRequestQuote) => void
  readonly clear: () => void
}

/** What a comment becomes on its way to the composer. */
export function toQuote(comment: PullRequestComment, number: number): PullRequestQuote {
  return {
    key: commentKey(comment),
    reference: `#${String(number)}`,
    author: comment.author,
    place:
      comment.kind === 'inline'
        ? comment.line === null
          ? comment.path
          : `${comment.path}:${String(comment.line)}`
        : null,
    quote: comment.kind === 'inline' ? comment.quote : null,
    body: comment.body
  }
}

/**
 * Remarks from a review waiting to go out with the next message.
 *
 * Kept per workspace, the way the diff's notes are, so switching away and back
 * finds them where they were left and never shows another branch's review.
 *
 * Deliberately not persisted — and for a different reason from the diff's,
 * which is worth writing down because the old one does not carry over. A note
 * on the diff points at a line that is about to move; a quote from GitHub
 * points at a comment id that will not. What makes this temporary is what it is
 * for: it is context for a question being typed now, and a question nobody
 * finished asking is not one to restore three days later.
 */
export function usePullRequestQuotes(workspaceId: string | null): PullRequestQuoteController {
  const [byWorkspace, setByWorkspace] = useState<ReadonlyMap<string, readonly PullRequestQuote[]>>(
    new Map()
  )

  const update = useCallback(
    (change: (quotes: readonly PullRequestQuote[]) => readonly PullRequestQuote[]) => {
      if (workspaceId === null) return

      setByWorkspace((current) => {
        const next = new Map(current)
        next.set(workspaceId, change(current.get(workspaceId) ?? []))
        return next
      })
    },
    [workspaceId]
  )

  const add = useCallback(
    (quote: PullRequestQuote) => {
      // The same remark twice is one remark. The button is disabled once it is
      // there, so this is the race rather than the ordinary path.
      update((quotes) =>
        quotes.some((held) => held.key === quote.key) ? quotes : [...quotes, quote]
      )
    },
    [update]
  )

  const remove = useCallback(
    (quote: PullRequestQuote) => {
      update((quotes) => quotes.filter((held) => held.key !== quote.key))
    },
    [update]
  )

  const clear = useCallback(() => {
    update(() => [])
  }, [update])

  return {
    pending: (workspaceId === null ? undefined : byWorkspace.get(workspaceId)) ?? [],
    add,
    remove,
    clear
  }
}
