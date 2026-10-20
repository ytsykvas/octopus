import { useCallback, useState, useSyncExternalStore } from 'react'

import { SIDE_HISTORY_LIMIT, type SideAnswer, type SideExchange } from '@core/sideQuestions.js'

import type { Failure, Result } from '../../../preload/index.js'
import { useErrorMessage } from './useErrorMessage.js'

export type SideItem =
  | { readonly id: number; readonly question: string; readonly state: 'pending' }
  | {
      readonly id: number
      readonly question: string
      readonly state: 'answered'
      readonly answer: string
      readonly synthetic: boolean
    }
  | { readonly id: number; readonly question: string; readonly state: 'empty' }
  | {
      readonly id: number
      readonly question: string
      readonly state: 'failed'
      readonly error: string
    }

export interface SideThread {
  readonly items: readonly SideItem[]
  readonly open: boolean
  /** An answer landed while the drawer was shut. */
  readonly unread: boolean
}

const EMPTY: SideThread = { items: [], open: false, unread: false }

export interface SideQuestionController {
  readonly threadFor: (chatId: string | null) => SideThread
  /** Opens the drawer and asks; resolves once the answer or the failure is in. */
  readonly ask: (chatId: string, question: string) => Promise<void>
  readonly setOpen: (chatId: string, open: boolean) => void
  readonly clear: (chatId: string) => void
  /** Drops a thread whose conversation was cleared, rewound or closed. */
  readonly forget: (chatId: string) => void
}

/** The earlier exchanges a question is asked with: answered ones, newest last. */
export function sideHistory(items: readonly SideItem[]): SideExchange[] {
  return items
    .flatMap((item) =>
      item.state === 'answered' ? [{ question: item.question, response: item.answer }] : []
    )
    .slice(-SIDE_HISTORY_LIMIT)
}

function settle(
  id: number,
  question: string,
  result: Result<SideAnswer | null>,
  describeFailure: (failure: Failure) => string
): SideItem {
  if (!result.ok) return { id, question, state: 'failed', error: describeFailure(result) }
  if (result.value === null) return { id, question, state: 'empty' }
  return {
    id,
    question,
    state: 'answered',
    answer: result.value.text,
    synthetic: result.value.synthetic
  }
}

interface SideStore {
  readonly read: () => ReadonlyMap<string, SideThread>
  readonly subscribe: (listener: () => void) => () => void
  readonly nextId: () => number
  readonly update: (chatId: string, change: (thread: SideThread) => SideThread) => void
  readonly remove: (chatId: string) => void
}

/**
 * Every conversation's thread for the window's lifetime, not stored: the CLI
 * keeps its own in memory and lets it go on exit too.
 *
 * An external store rather than state because `ask` reads the thread after an
 * await, when a state snapshot would be stale.
 */
function createStore(): SideStore {
  let threads: ReadonlyMap<string, SideThread> = new Map()
  const listeners = new Set<() => void>()
  let nextId = 1

  const publish = (next: ReadonlyMap<string, SideThread>): void => {
    threads = next
    for (const listener of listeners) listener()
  }

  return {
    read: () => threads,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    nextId: () => nextId++,
    update: (chatId, change) => {
      const current = threads.get(chatId) ?? EMPTY
      const next = change(current)
      if (next !== current) publish(new Map(threads).set(chatId, next))
    },
    remove: (chatId) => {
      if (!threads.has(chatId)) return
      const next = new Map(threads)
      next.delete(chatId)
      publish(next)
    }
  }
}

/** The window's `/btw` threads, one per conversation; held by `App`. */
export function useSideQuestions(): SideQuestionController {
  const describeFailure = useErrorMessage()
  const [store] = useState(createStore)
  const threads = useSyncExternalStore(store.subscribe, store.read)

  const threadFor = useCallback(
    (chatId: string | null) => (chatId === null ? undefined : threads.get(chatId)) ?? EMPTY,
    [threads]
  )

  const ask = useCallback(
    async (chatId: string, question: string) => {
      const id = store.nextId()
      const history = sideHistory(store.read().get(chatId)?.items ?? [])
      store.update(chatId, (thread) => ({
        open: true,
        unread: false,
        items: [...thread.items, { id, question, state: 'pending' }]
      }))

      const result = await window.octopus.chats.sideQuestion(chatId, question, history)
      const settled = settle(id, question, result, describeFailure)

      store.update(chatId, (thread) =>
        // Cleared while it was out: the answer has nowhere to go.
        thread.items.some((item) => item.id === id)
          ? {
              ...thread,
              items: thread.items.map((item) => (item.id === id ? settled : item)),
              unread: thread.unread || !thread.open
            }
          : thread
      )
    },
    [store, describeFailure]
  )

  const setOpen = useCallback(
    (chatId: string, open: boolean) => {
      store.update(chatId, (thread) => ({ ...thread, open, unread: open ? false : thread.unread }))
    },
    [store]
  )

  const clear = useCallback(
    (chatId: string) => {
      store.update(chatId, (thread) => ({ ...thread, items: [], unread: false }))
    },
    [store]
  )

  const forget = useCallback(
    (chatId: string) => {
      store.remove(chatId)
    },
    [store]
  )

  return { threadFor, ask, setOpen, clear, forget }
}
