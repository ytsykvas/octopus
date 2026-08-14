import { useCallback, useState } from 'react'

/**
 * A note against one line of the diff, waiting to be sent.
 *
 * There is no id: a line is identified by where it is, and a second note on the
 * same line replaces the first rather than sitting under it. One line, one
 * remark — a thread would be a conversation this app has no way to continue.
 */
export interface DiffComment {
  readonly path: string
  /** Which file the line belongs to: the one as it was, or as it is. */
  readonly side: 'old' | 'new'
  readonly line: number
  /** The line as it read when the note was written, so the prompt can quote it. */
  readonly code: string
  readonly text: string
}

export interface DiffCommentController {
  /** Notes for the open workspace, in the order they were written. */
  readonly pending: readonly DiffComment[]
  readonly add: (comment: DiffComment) => void
  readonly remove: (comment: DiffComment) => void
  readonly clear: () => void
}

/** Where a note sits, which is also what makes it the same note. */
function keyOf(comment: DiffComment): string {
  return `${comment.path}:${comment.side}:${String(comment.line)}`
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
      update((comments) => [...comments.filter((held) => keyOf(held) !== keyOf(comment)), comment])
    },
    [update]
  )

  const remove = useCallback(
    (comment: DiffComment) => {
      update((comments) => comments.filter((held) => keyOf(held) !== keyOf(comment)))
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
