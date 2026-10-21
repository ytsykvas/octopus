import { useCallback, useEffect, useRef, useState } from 'react'

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

export interface StreamingBuffer {
  readonly streaming: Streaming
  /** Adds a fragment; it is drawn with the others at the next flush. */
  readonly append: (kind: keyof Streaming, chunk: string) => void
  /** Ends the block being written: nothing waiting, nothing drawn. */
  readonly discard: () => void
  /**
   * Clears what is drawn and touches nothing else.
   *
   * For the reset made during render on a conversation switch, where refs and
   * timers are off limits. The flush still waiting is cancelled by the switch
   * itself, through `key`.
   */
  readonly reset: () => void
}

/**
 * The answer being typed out, gathered into a few updates a second.
 *
 * `key` is the conversation the fragments belong to: when it changes, or the
 * pane goes, a flush still waiting is dropped rather than drawn into whatever
 * comes next.
 */
export function useStreaming(key: string | null): StreamingBuffer {
  const [streaming, setStreaming] = useState<Streaming>(NOTHING_STREAMING)
  const pending = useRef<{ text: string; thinking: string }>({ text: '', thinking: '' })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    pending.current = { text: '', thinking: '' }
  }, [])

  const append = useCallback((kind: keyof Streaming, chunk: string) => {
    pending.current[kind] += chunk
    if (timer.current !== null) return

    timer.current = setTimeout(() => {
      // Taken out before the update: StrictMode runs an updater twice, and one
      // that read the buffer would add the same fragment twice.
      const { text, thinking } = pending.current
      pending.current = { text: '', thinking: '' }
      timer.current = null
      setStreaming((current) => ({
        text: current.text + text,
        thinking: current.thinking + thinking
      }))
    }, STREAM_FLUSH_MS)
  }, [])

  const discard = useCallback(() => {
    cancel()
    setStreaming(NOTHING_STREAMING)
  }, [cancel])

  const reset = useCallback(() => {
    setStreaming(NOTHING_STREAMING)
  }, [])

  useEffect(() => cancel, [key, cancel])

  return { streaming, append, discard, reset }
}
