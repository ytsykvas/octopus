import { useCallback, useEffect, useMemo, useState } from 'react'

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
import { chime } from '../sound.js'
import { onChatEvent } from './chatEvents.js'
import { useLatest } from './useLatest.js'

/** How many toasts are drawn at once; older news stays on the project's tab. */
export const TOAST_LIMIT = 3

export interface Attention {
  /** What is news, oldest first. */
  readonly notices: readonly Notice[]
  /** Each project's mark, for the ones that have one. */
  readonly marks: ReadonlyMap<string, Mark>
  /** The notices still drawn as toasts, newest first. */
  readonly toasts: readonly Notice[]
  /** Takes a toast down; the project's mark stays until the workspace is opened. */
  readonly dismiss: (notice: Notice) => void
}

/**
 * The window's account of what needs the user, kept from every conversation.
 *
 * Nothing is recorded for the workspace on screen — the user is already
 * looking at it — and opening a workspace clears what it had. The one thing
 * the open workspace still gets is the sound, when the window is not in front:
 * somebody in another application is not looking at it either.
 *
 * `sound` is the id of the sound to play, or `null` when the switch is off.
 */
export function useAttention(
  projects: readonly Project[],
  workspaces: readonly WorkspaceView[],
  openWorkspaceId: string | null,
  sound: string | null
): Attention {
  const [held, setHeld] = useState<readonly Notice[]>([])
  // By identity: a newer notice for the same conversation is a new object, and
  // is news again.
  const [closed, setClosed] = useState<ReadonlySet<Notice>>(new Set())

  // Read by the listener, which is subscribed once: resubscribing on every
  // click would drop whatever arrived in between.
  const open = useLatest(openWorkspaceId)
  const known = useLatest(workspaces)
  const audible = useLatest(sound)

  useEffect(
    () =>
      onChatEvent((chatEvent) => {
        const notice = noticeFrom(chatEvent, known.current, Date.now())
        if (notice === null) return

        const onScreen = chatEvent.workspaceId === open.current
        if (!onScreen) setHeld((list) => withNotice(list, notice))
        if (audible.current !== null && (!onScreen || !document.hasFocus())) {
          chime(notice.kind, audible.current)
        }
      }),
    [audible, known, open]
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

  const toasts = useMemo(
    () =>
      notices
        .filter((notice) => !closed.has(notice))
        .toReversed()
        .slice(0, TOAST_LIMIT),
    [notices, closed]
  )

  const dismiss = useCallback((notice: Notice) => {
    setClosed((current) => new Set(current).add(notice))
  }, [])

  return { notices, marks, toasts, dismiss }
}
