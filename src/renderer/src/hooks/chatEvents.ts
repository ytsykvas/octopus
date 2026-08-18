/**
 * One subscription to the agent's events, shared by everything that wants them.
 *
 * The bridge registers a fresh `ipcRenderer.on('chats:event', …)` per call, and
 * seven hooks call it — some of them once per conversation pane. Three
 * conversations and a few workspaces visited was enough to cross Node's default
 * of ten listeners and print `MaxListenersExceededWarning`, which is a
 * diagnostic meant to catch real leaks turning into noise nobody reads.
 *
 * The fan-out was the other half. Every pane was woken for every fragment of
 * every other conversation's stream and dropped it after comparing an id, so
 * three agents streaming cost each pane three times the work it needed.
 *
 * Module state rather than a context, because there is exactly one bridge and
 * nothing here belongs to a React tree. The subscription is taken when the
 * first listener arrives and given back when the last one goes, so a window
 * with nothing open holds nothing.
 */

import type { ChatEvent } from '@core/service.js'

type Handler = (event: ChatEvent) => void

/** Listeners that asked about one conversation, by its id. */
const byChat = new Map<string, Set<Handler>>()

/** Listeners that want everything — the workspace list, the models, the limit. */
const everything = new Set<Handler>()

/** How to let go of the bridge, or null while nobody is listening. */
let release: (() => void) | null = null

function deliver(event: ChatEvent): void {
  // Copied before the walk: a handler may unsubscribe from inside its own call,
  // and a set edited mid-iteration would skip whichever came next.
  for (const handler of [...everything]) handler(event)
  for (const handler of [...(byChat.get(event.chatId) ?? [])]) handler(event)
}

function stopWhenEmpty(): void {
  if (everything.size > 0 || byChat.size > 0) return

  release?.()
  release = null
}

/**
 * Listens to the agent's events, for one conversation or for all of them.
 *
 * Give a `chatId` and the handler is woken only for that conversation — which
 * is what a pane wants, and what stops it doing the work of the other two.
 * Leave it out and the handler sees everything, which is what the readings that
 * belong to the window rather than to a pane want.
 */
export function onChatEvent(handler: Handler, chatId?: string): () => void {
  const held = chatId === undefined ? everything : (byChat.get(chatId) ?? new Set<Handler>())
  held.add(handler)
  if (chatId !== undefined) byChat.set(chatId, held)

  release ??= window.octopus.chats.onEvent(deliver)

  return () => {
    held.delete(handler)
    if (chatId !== undefined && held.size === 0) byChat.delete(chatId)
    stopWhenEmpty()
  }
}
