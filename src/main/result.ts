/**
 * Turning a core call into something the renderer can act on.
 *
 * Kept apart from the IPC wiring so it can be tested without Electron: this is
 * the only place that decides what a failure looks like on the far side of the
 * bridge, and getting it wrong means an error the UI cannot explain.
 */

import { isCoded } from '../core/codedError.js'
import { describeError } from '../core/persist.js'

/**
 * Every IPC call answers with this shape.
 *
 * Validation failures also carry a code and params, so the renderer can render
 * a localised message rather than the raw English fallback.
 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code?: string; params?: Readonly<Record<string, string>> }

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
    // One check rather than a list of classes. The list was written by hand and
    // nothing connected it to the classes, so a ninth could be — and was — left
    // off it silently: every skill refusal reached the window as developer
    // English with eight translations sitting unreachable behind it. A class
    // extending `CodedError` is in by construction.
    if (isCoded(error)) {
      return {
        ok: false,
        error: error.message,
        // `StateConflictError` is the one whose code is optional: most of what
        // it refuses is a condition the interface cannot reach, and an explicit
        // `undefined` is not the same as an absent key here.
        ...(error.code === undefined ? {} : { code: error.code }),
        params: error.params
      }
    }

    return { ok: false, error: describeError(error) }
  }
}
