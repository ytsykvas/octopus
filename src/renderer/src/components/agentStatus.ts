/**
 * How an agent's state is drawn, wherever it is drawn.
 *
 * Two places read this now — the workspace list's dot and the chat tab strip's
 * — and they have to agree: the strip says which conversation is waiting on an
 * answer, and the list says which workspace holds it. A reader who learns the
 * colours in one should not have to learn them again in the other.
 */

import type { ChatStatus } from '@core/chats.js'
import type { WorkspaceView } from '@core/workspaces.js'

/**
 * What the agent is doing there, when it is doing anything.
 *
 * The whole point of a list of workspaces — and of a strip of tabs — is that
 * several are working at once, and without this the only way to find out was to
 * open each one. The colour is the difference that matters: `warning` means the
 * turn has stopped and is waiting on you, which is the one state worth crossing
 * the window for.
 *
 * Keyed by the workspace's wider enum so both callers fit; `archived` and
 * `idle` are deliberately absent, being the states with nothing to announce.
 */
export const AGENT_TONES: Partial<Record<WorkspaceView['status'], string>> = {
  running: 'bg-accent animate-pulse',
  waiting_permission: 'bg-warning',
  error: 'bg-danger'
}

/** What a conversation with nothing to report looks like — a hollow dot. */
export const QUIET_TONE = 'border-ink-faint border'

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

/**
 * The label for a conversation, which unlike a workspace has a word for `idle`.
 *
 * A tab's dot is always there — the strip would jump by six pixels the moment a
 * turn started otherwise — so the quiet state needs something to be called.
 */
export function chatStatusLabel(
  status: ChatStatus
):
  | 'workspaces.statusRunning'
  | 'workspaces.statusWaiting'
  | 'workspaces.statusError'
  | 'chat.tabStatusIdle' {
  return AGENT_LABELS[status] ?? 'chat.tabStatusIdle'
}

/** The tone for a conversation, falling back to the hollow dot. */
export function chatStatusTone(status: ChatStatus): string {
  return AGENT_TONES[status] ?? QUIET_TONE
}
