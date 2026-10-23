import { useCallback, useEffect, useRef, useState } from 'react'
import { useLatest } from './useLatest.js'

/** Prose and reasoning still being written, kept apart so they render apart. */
export interface Streaming {
  readonly text: string
  readonly thinking: string
}

export const NOTHING_STREAMING: Streaming = { text: '', thinking: '' }

/**
 * How long streamed fragments are gathered before they are drawn.
 *
 * Every fragment the agent sends used to be its own React update, and each one
 * parses the growing reply as markdown again, so drawing them one by one cost
 * more the longer the answer got. A fixed clock rather than one frame: deltas
 * often arrive slower than the screen refreshes, and a frame-based flush would
 * then gather nothing. Twenty updates a second still reads as typing.
 */
export const STREAM_FLUSH_MS = 50

/**
 * What is being written, held where only the tail that draws it need read it.
 *
 * State in the hook made every flush a render of the whole pane: the composer,
 * its attic and pickers, the side questions, twenty times a second for as long
 * as the agent wrote. A store read through `useSyncExternalStore` by the one
 * component below the thread renders that component and nothing else.
 */
export interface StreamStore {
  readonly subscribe: (listener: () => void) => () => void
  readonly read: () => Streaming
}

export interface PublishingStream extends StreamStore {
  readonly publish: (streaming: Streaming) => void
}

/** A store and the way to fill it — the hook's own, and a test's for a log. */
export function createStreamStore(initial: Streaming = NOTHING_STREAMING): PublishingStream {
  let streaming = initial
  const listeners = new Set<() => void>()

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    read: () => streaming,
    publish: (next) => {
      streaming = next
      // Copied, for the reason `chatEvents.ts` gives: a reader may leave mid-call.
      for (const listener of [...listeners]) listener()
    }
  }
}

/** A store that only ever says one thing — the default, and what a test hands a log. */
export function streamOf(streaming: Streaming): StreamStore {
  return createStreamStore(streaming)
}

export interface StreamingBuffer {
  readonly stream: StreamStore
  /**
   * Whether something is being written.
   *
   * Moves twice per block, when the first fragment is drawn and when the block
   * ends — never per flush — so the pane can count a reply being written as
   * content without being redrawn for every fragment of it.
   */
  readonly streaming: boolean
  /** Adds a fragment; it is drawn with the others at the next flush. */
  readonly append: (kind: keyof Streaming, chunk: string) => void
  /** Ends the block being written: nothing waiting, nothing drawn. */
  readonly discard: () => void
  /**
   * Clears what is drawn and touches nothing else.
   *
   * For the reset made during render on a conversation switch, where refs and
   * timers are off limits. The flush still waiting is cancelled by the switch
   * itself, through `key`, and so is what was drawn: the store is the
   * conversation's own, and the next one starts with an empty one.
   */
  readonly reset: () => void
}

/**
 * The answer being typed out, gathered into a few updates a second.
 *
 * `key` is the conversation the fragments belong to: when it changes, or the
 * pane goes, a flush still waiting is dropped rather than drawn into whatever
 * comes next.
 *
 * `drawn` is whether anybody can see the pane. Behind another tab or a file,
 * the fragments are gathered and not drawn — parsing a reply nobody is
 * reading, twenty times a second, was the whole cost of a hidden conversation
 * — and drawn once, together, the moment the pane comes forward.
 */
export function useStreaming(key: string | null, drawn = true): StreamingBuffer {
  // A store per conversation rather than one cleared on a switch: the switch
  // happens during render, where a store cannot tell its readers anything, and
  // a fresh empty one needs no telling. Adjusted during render, as React has
  // state derived from props done.
  const [held, setHeld] = useState(() => ({ key, store: createStreamStore() }))
  const store = held.key === key ? held.store : createStreamStore()
  if (held.key !== key) setHeld({ key, store })

  const [streaming, setStreaming] = useState(false)
  const pending = useRef<{ text: string; thinking: string }>({ text: '', thinking: '' })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    pending.current = { text: '', thinking: '' }
  }, [])

  // Read through a ref, so `append` keeps its identity across the pane being
  // hidden and shown: the pane's event subscription is built on it, and torn
  // down and up on a change it dropped a rewind's re-read and a queued mark.
  const shown = useLatest(drawn)

  const schedule = useCallback(() => {
    if (timer.current !== null) return

    timer.current = setTimeout(() => {
      // Taken out before the update: StrictMode runs an updater twice, and one
      // that read the buffer would add the same fragment twice.
      const { text, thinking } = pending.current
      pending.current = { text: '', thinking: '' }
      timer.current = null
      const current = store.read()
      store.publish({ text: current.text + text, thinking: current.thinking + thinking })
      setStreaming(true)
    }, STREAM_FLUSH_MS)
  }, [store])

  const append = useCallback(
    (kind: keyof Streaming, chunk: string) => {
      pending.current[kind] += chunk
      if (shown.current) schedule()
    },
    [schedule, shown]
  )

  // What gathered while the pane was hidden is drawn as it comes forward.
  useEffect(() => {
    if (!drawn) return
    if (pending.current.text !== '' || pending.current.thinking !== '') schedule()
  }, [drawn, schedule])

  const discard = useCallback(() => {
    cancel()
    store.publish(NOTHING_STREAMING)
    setStreaming(false)
  }, [cancel, store])

  const reset = useCallback(() => {
    setStreaming(false)
  }, [])

  useEffect(() => cancel, [key, cancel])

  return { stream: store, streaming, append, discard, reset }
}
