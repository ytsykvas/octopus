import { useEffect, useMemo, useRef, useState } from 'react'

import type { Project } from '@core/store.js'
import type { WorkspaceView } from '@core/workspaces.js'

import {
  type Mark,
  type Notice,
  noticeFrom,
  projectMark,
  seen,
  settle,
  withNotice
} from '../attention.js'
import { onChatEvent } from './chatEvents.js'

export interface Attention {
  /** What is news, oldest first. */
  readonly notices: readonly Notice[]
  /** Each project's mark, for the ones that have one. */
  readonly marks: ReadonlyMap<string, Mark>
}

/**
 * The window's account of what needs the user, kept from every conversation.
 *
 * Nothing is recorded for the workspace on screen — the user is already
 * looking at it — and opening a workspace clears what it had.
 */
export function useAttention(
  projects: readonly Project[],
  workspaces: readonly WorkspaceView[],
  openWorkspaceId: string | null
): Attention {
  const [held, setHeld] = useState<readonly Notice[]>([])

  // Read by the listener, which is subscribed once: resubscribing on every
  // click would drop whatever arrived in between.
  const open = useRef(openWorkspaceId)
  const known = useRef(workspaces)
  useEffect(() => {
    open.current = openWorkspaceId
    known.current = workspaces
  }, [openWorkspaceId, workspaces])

  useEffect(
    () =>
      onChatEvent((chatEvent) => {
        if (chatEvent.workspaceId === open.current) return

        const notice = noticeFrom(chatEvent, known.current, Date.now())
        if (notice !== null) setHeld((list) => withNotice(list, notice))
      }),
    []
  )

  // Opening a workspace is going to look; adjusted during render rather than
  // in an effect, so the mark is never drawn for a frame after the click.
  const [lastOpen, setLastOpen] = useState(openWorkspaceId)
  if (openWorkspaceId !== lastOpen) {
    setLastOpen(openWorkspaceId)
    if (openWorkspaceId !== null) setHeld((list) => seen(list, openWorkspaceId))
  }

  const notices = useMemo(() => settle(held, workspaces), [held, workspaces])

  const marks = useMemo(() => {
    const found = new Map<string, Mark>()
    for (const project of projects) {
      const mark = projectMark(project.id, workspaces, notices)
      if (mark !== null) found.set(project.id, mark)
    }
    return found
  }, [projects, workspaces, notices])

  return { notices, marks }
}
