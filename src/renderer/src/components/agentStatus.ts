/**
 * How an agent's state is drawn, wherever it is drawn.
 *
 * Two places read this now — the workspace list's dot and the chat tab strip's
 * — and they have to agree: the strip says which conversation is waiting on an
 * answer, and the list says which workspace holds it. A reader who learns the
 * colours in one should not have to learn them again in the other.
 */

import type { WorkspaceChat, WorkspaceView } from '@core/workspaces.js'

/**
 * What a conversation's dot and its name for it are read from.
 *
 * One object rather than three arguments, two of them booleans that read the
 * same at the call site. The list's summary and the strip's tab both carry it.
 */
export type ChatState = Pick<WorkspaceChat, 'status' | 'started' | 'interrupted'>

/**
 * What the agent is doing there, when it is doing anything.
 *
 * The whole point of a list of workspaces — and of a strip of tabs — is that
 * several are working at once, and without this the only way to find out was to
 * open each one. The colour is the difference that matters: `warning` means the
 * turn has stopped and is waiting on you, which is the one state worth crossing
 * the window for.
 *
 * Keyed by the workspace's enum so both callers fit; `idle` is deliberately
 * absent, being the one state with nothing to announce.
 */
export const AGENT_TONES: Partial<Record<WorkspaceView['status'], string>> = {
  running: 'bg-accent animate-pulse',
  waiting_permission: 'bg-warning',
  error: 'bg-danger'
}

/** What a conversation nobody has written in yet looks like — a hollow dot. */
export const EMPTY_TONE = 'border-ink-faint border'

/**
 * A conversation that has run and is not doing anything now.
 *
 * `idle` used to draw the hollow dot as well, which made "finished, nothing
 * wrong" and "never used" the same mark — and those are the two states a
 * glance down the list is most often trying to tell apart. Green is the
 * ordinary end of a turn, so it is the quiet green rather than a lit one.
 */
export const DONE_TONE = 'bg-success'

/**
 * A conversation whose last turn the application's exit cut off.
 *
 * The waiting colour, because it means the same thing — the work stopped and
 * goes nowhere until you act — but a ring rather than a dot: in the tile of
 * several conversations and in the tab strip there is no icon to tell the two
 * apart, and "it is asking you something" is not what happened here.
 */
export const INTERRUPTED_TONE = 'border-warning border'

/**
 * The label for each tone.
 *
 * Written out rather than built from the status: `t` is typed against the
 * locale, and a key assembled at runtime is a string it cannot check — which is
 * the whole point of typing the locales against each other.
 */
export const AGENT_LABELS: Partial<
  Record<
    WorkspaceView['status'],
    'workspaces.statusRunning' | 'workspaces.statusWaiting' | 'workspaces.statusError'
  >
> = {
  running: 'workspaces.statusRunning',
  waiting_permission: 'workspaces.statusWaiting',
  error: 'workspaces.statusError'
}

/** The six things a workspace row can say about its agent. */
export type WorkspaceMood = 'running' | 'waiting' | 'error' | 'interrupted' | 'done' | 'idle'

/**
 * What a workspace row says about its agent, in a word and in a colour.
 *
 * The colours are the dots' (`AGENT_TONES`, `DONE_TONE`) as text, so the list
 * and the tab strip keep to one vocabulary. Written out rather than derived, for
 * the reason `AGENT_LABELS` is.
 */
export const WORKSPACE_MOODS: Record<
  WorkspaceMood,
  {
    line:
      | 'workspaces.lineRunning'
      | 'workspaces.lineWaiting'
      | 'workspaces.lineError'
      | 'workspaces.lineInterrupted'
      | 'workspaces.lineDone'
      | 'workspaces.lineIdle'
    text: string
  }
> = {
  running: { line: 'workspaces.lineRunning', text: 'text-accent' },
  waiting: { line: 'workspaces.lineWaiting', text: 'text-warning' },
  error: { line: 'workspaces.lineError', text: 'text-danger' },
  interrupted: { line: 'workspaces.lineInterrupted', text: 'text-warning' },
  done: { line: 'workspaces.lineDone', text: 'text-success' },
  idle: { line: 'workspaces.lineIdle', text: 'text-ink-faint' }
}

/**
 * Which of the six a workspace is in.
 *
 * `idle` is the one status that is three states, as it is for a conversation: a
 * workspace where a session has run and stopped is finished, one nobody has
 * written in is not started, and one whose turn the application's exit cut off
 * is interrupted. That last one wins over finished: a single conversation left
 * mid-command is the reason to go back, whatever the others did.
 */
export function workspaceMood(workspace: WorkspaceView): WorkspaceMood {
  switch (workspace.status) {
    case 'running':
      return 'running'
    case 'waiting_permission':
      return 'waiting'
    case 'error':
      return 'error'
    case 'idle':
      if (workspace.chats.some((chat) => chat.interrupted)) return 'interrupted'
      return workspace.chats.some((chat) => chat.started) ? 'done' : 'idle'
  }
}

/**
 * The label for a conversation, which unlike a workspace has words for `idle`.
 *
 * A tab's dot is always there — the strip would jump by six pixels the moment a
 * turn started otherwise — so the quiet states need something to be called, and
 * there are three of them: one where a turn ended, one where the application's
 * exit cut it off, and one where none has run.
 */
export function chatStatusLabel({
  status,
  started,
  interrupted
}: ChatState):
  | 'workspaces.statusRunning'
  | 'workspaces.statusWaiting'
  | 'workspaces.statusError'
  | 'chat.tabStatusInterrupted'
  | 'chat.tabStatusDone'
  | 'chat.tabStatusIdle' {
  if (interrupted) return 'chat.tabStatusInterrupted'
  return AGENT_LABELS[status] ?? (started ? 'chat.tabStatusDone' : 'chat.tabStatusIdle')
}

/**
 * The tone for a conversation.
 *
 * `started` and `interrupted` only decide the quiet case. A conversation that
 * is running, or waiting, or ended in an error has something to say about
 * right now, and how it began is not part of it — and `interrupted` is only
 * ever set on an `idle` one, so asking it first changes nothing for the rest.
 */
export function chatStatusTone({ status, started, interrupted }: ChatState): string {
  if (interrupted) return INTERRUPTED_TONE
  return AGENT_TONES[status] ?? (started ? DONE_TONE : EMPTY_TONE)
}
