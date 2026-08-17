import { useCallback, useState } from 'react'

/**
 * A note against a passage of the diff, waiting to be sent.
 *
 * There is no id: a note is identified by where it is, and a second note over
 * the same passage replaces the first rather than sitting under it. One
 * passage, one remark — a thread would be a conversation this app has no way to
 * continue.
 *
 * A passage is one line when the trigger in the gutter was used and as many as
 * were dragged over when the selection was. Two ranges may overlap, which the
 * single-line rule it replaces could not: refusing the second would mean
 * deciding which of two overlapping selections wins, and neither gesture asks
 * that question.
 */
export interface DiffComment {
  readonly path: string
  /** Which file the lines belong to: the one as it was, or as it is. */
  readonly side: 'old' | 'new'
  readonly line: number
  /** The last line the note covers; equal to `line` when it covers one. */
  readonly endLine: number
  /**
   * The lines as they read when the note was written, so the prompt can quote
   * them — joined by newlines, and whole even where half of one was selected.
   */
  readonly code: string
  readonly text: string
}

/** A note's place, which a row knows before there is a remark to put there. */
export type CommentAnchor = Omit<DiffComment, 'text' | 'code'>

export interface DiffCommentController {
  /** Notes for the open workspace, in the order they were written. */
  readonly pending: readonly DiffComment[]
  readonly add: (comment: DiffComment) => void
  readonly remove: (comment: DiffComment) => void
  readonly clear: () => void
}

/**
 * Where a note sits, which is also what makes it the same note.
 *
 * The one spelling of it. This was written out in three modules — here, in the
 * row that opens an editor, and in the `key` of the composer's chip — and the
 * way that fails is silent: change the separator or add a field in one of them
 * and notes stop deduplicating, or a chip stops matching the line it belongs
 * to, with nothing failing to say so.
 *
 * Takes less than a whole note, because a row has a place before it has a
 * remark, and it is the place that identifies both. The end of the range is
 * part of it: two notes starting on one line and covering different amounts are
 * two notes, and a key that dropped the end would silently merge them.
 */
export function anchorKey(anchor: CommentAnchor): string {
  return `${anchor.path}:${anchor.side}:${String(anchor.line)}-${String(anchor.endLine)}`
}

/**
 * Review notes waiting to go out with the next message.
 *
 * Kept per workspace, so switching away and back finds the review where it was
 * left and never shows another workspace's remarks.
 *
 * Deliberately not persisted. A note points at a line that is about to change,
 * and one restored after a restart would point wherever that text has since
 * ended up — the mistake `readChangeContext` avoids by recording context the
 * moment an edit lands rather than looking it up later.
 */
export function useDiffComments(workspaceId: string | null): DiffCommentController {
  const [byWorkspace, setByWorkspace] = useState<ReadonlyMap<string, readonly DiffComment[]>>(
    new Map()
  )

  const update = useCallback(
    (change: (comments: readonly DiffComment[]) => readonly DiffComment[]) => {
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
    (comment: DiffComment) => {
      update((comments) => [
        ...comments.filter((held) => anchorKey(held) !== anchorKey(comment)),
        comment
      ])
    },
    [update]
  )

  const remove = useCallback(
    (comment: DiffComment) => {
      update((comments) => comments.filter((held) => anchorKey(held) !== anchorKey(comment)))
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
