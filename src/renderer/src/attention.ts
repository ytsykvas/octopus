/**
 * What needs the user's attention, across every project at once.
 *
 * Several agents run in parallel, and without this the only way to learn that
 * one had finished, failed or stopped to ask was to visit each workspace in
 * turn. A notice is that news, kept until the user goes to look.
 *
 * Window state rather than a stored field: "seen" is about one person looking
 * at one window, and a field under `StateSchema` is the kind of change that has
 * already stopped the application opening once. The cost is that a notice does
 * not outlive a restart — which ends every turn anyway.
 */

import { EXIT_PLAN_MODE } from '@core/chats.js'
import { readQuestions } from '@core/questions.js'
import type { ChatEvent } from '@core/service.js'
import type { WorkspaceView } from '@core/workspaces.js'

/** What happened: the turn ended, failed, or stopped to ask about something. */
export type NoticeKind = 'done' | 'error' | 'question' | 'plan' | 'permission'

export interface Notice {
  readonly chatId: string
  readonly workspaceId: string
  readonly projectId: string
  readonly kind: NoticeKind
  /** The tool a permission is about, for saying which; empty otherwise. */
  readonly toolName: string
  /** When it happened, for ordering the newest first. */
  readonly at: number
}

/** What a project's tab says, the most pressing first. */
export type Mark = 'waiting' | 'error' | 'done'

/**
 * The notice an agent event amounts to, or null when it is not news.
 *
 * An event for a workspace the window does not know is dropped: the notice
 * names a project, and there is nothing to name.
 */
export function noticeFrom(
  { chatId, workspaceId, event }: ChatEvent,
  workspaces: readonly WorkspaceView[],
  at: number
): Notice | null {
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId)
  if (workspace === undefined) return null

  const notice = { chatId, workspaceId, projectId: workspace.projectId, toolName: '', at }

  if (event.type === 'result') return { ...notice, kind: event.ok ? 'done' : 'error' }
  if (event.type === 'error') return { ...notice, kind: 'error' }
  if (event.type !== 'permission_request') return null

  // A question and a plan are permission requests in shape only, and the user
  // is asked something different about each.
  if (readQuestions(event.toolName, event.input) !== null) return { ...notice, kind: 'question' }
  if (event.toolName === EXIT_PLAN_MODE) return { ...notice, kind: 'plan' }
  return { ...notice, kind: 'permission', toolName: event.toolName }
}

/**
 * The list with this notice in it.
 *
 * One per **conversation**, the newest replacing the one before: a workspace
 * holds up to three, and keyed by workspace a chat that finished would wipe out
 * another that was still waiting on an answer.
 */
export function withNotice(list: readonly Notice[], notice: Notice): Notice[] {
  return [...list.filter((held) => held.chatId !== notice.chatId), notice]
}

/** The list without a workspace's notices — the user has gone to look. */
export function seen(list: readonly Notice[], workspaceId: string): Notice[] {
  return list.filter((notice) => notice.workspaceId !== workspaceId)
}

const WAITING: ReadonlySet<NoticeKind> = new Set(['question', 'plan', 'permission'])

/**
 * The notices still true.
 *
 * A wait ends when its conversation stops waiting — answered in another
 * window, or the turn stopped — so one whose chat is no longer
 * `waiting_permission` says nothing any more. The list itself when nothing
 * changed, so a caller memoising on it does not redraw for nothing.
 */
export function settle(
  list: readonly Notice[],
  workspaces: readonly WorkspaceView[]
): readonly Notice[] {
  const waiting = new Set(
    workspaces.flatMap((workspace) =>
      workspace.chats.filter((chat) => chat.status === 'waiting_permission').map((chat) => chat.id)
    )
  )
  const kept = list.filter((notice) => !WAITING.has(notice.kind) || waiting.has(notice.chatId))

  return kept.length === list.length ? list : kept
}

/**
 * What a project's tab should say, if anything.
 *
 * Waiting is read from the live status rather than from a notice: it holds
 * until the question is answered, wherever the user is looking — including the
 * workspace on screen. A finished or failed turn is news only until it is seen.
 */
export function projectMark(
  projectId: string,
  workspaces: readonly WorkspaceView[],
  notices: readonly Notice[]
): Mark | null {
  const own = (workspace: { readonly projectId: string }): boolean =>
    workspace.projectId === projectId

  if (workspaces.some((workspace) => own(workspace) && workspace.status === 'waiting_permission')) {
    return 'waiting'
  }
  if (notices.some((notice) => own(notice) && notice.kind === 'error')) return 'error'
  if (notices.some((notice) => own(notice) && notice.kind === 'done')) return 'done'

  return null
}
