/**
 * Turning a core call into something the renderer can act on.
 *
 * Kept apart from the IPC wiring so it can be tested without Electron. What a
 * failure looks like is decided in `core/failure.ts`, which a push uses too.
 */

import { type Failure, failureOf } from '../core/failure.js'

/** Every IPC call answers with this shape. */
export type Result<T> = { ok: true; value: T } | Failure

/**
 * Runs an operation and reports the outcome rather than throwing across IPC.
 *
 * An exception thrown in a handler reaches the renderer as an opaque Electron
 * error with the original message mangled, so failures are converted here
 * instead — with the code intact where there is one.
 */
export async function attempt<T>(operation: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    return failureOf(error)
  }
}
