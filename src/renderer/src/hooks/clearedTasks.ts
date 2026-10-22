/**
 * The ended tasks a person cleared from a conversation's agent map.
 *
 * Module state rather than a pane's, so a cleared map stays cleared when the
 * tab is switched away and back — a pane is unmounted then, and its state with
 * it. Not written to disk: the list is housekeeping for the eye, and a restart
 * bringing the old runs back from the transcript costs nothing.
 */

import { useSyncExternalStore } from 'react'

const NONE: ReadonlySet<string> = new Set()

let byChat: ReadonlyMap<string, ReadonlySet<string>> = new Map()
const readers = new Set<() => void>()

function subscribe(reader: () => void): () => void {
  readers.add(reader)
  return () => {
    readers.delete(reader)
  }
}

/** The task ids cleared in one conversation — the same set until it changes. */
export function useClearedTasks(chatId: string): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => byChat.get(chatId) ?? NONE)
}

/** Takes these tasks off the conversation's map. */
export function clearTasks(chatId: string, taskIds: readonly string[]): void {
  const next = new Map(byChat)
  next.set(chatId, new Set([...(byChat.get(chatId) ?? NONE), ...taskIds]))
  byChat = next
  // Copied for the reason `chatEvents.ts` gives: a reader may leave mid-call.
  for (const reader of [...readers]) reader()
}
