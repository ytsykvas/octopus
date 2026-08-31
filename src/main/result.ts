/**
 * Turning a core call into something the renderer can act on.
 *
 * Kept apart from the IPC wiring so it can be tested without Electron: this is
 * the only place that decides what a failure looks like on the far side of the
 * bridge, and getting it wrong means an error the UI cannot explain.
 */

import { ChatError } from '../core/chats.js'
import { DiffError } from '../core/diff.js'
import { GitHubError } from '../core/github.js'
import { describeError } from '../core/persist.js'
import { ProjectValidationError } from '../core/projects.js'
import { StateConflictError } from '../core/store.js'
import { RepoConfigError } from '../core/repoConfig.js'
import { WorkspaceError } from '../core/workspaces.js'

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
    if (
      error instanceof ProjectValidationError ||
      error instanceof GitHubError ||
      error instanceof WorkspaceError ||
      error instanceof DiffError ||
      error instanceof ChatError ||
      error instanceof RepoConfigError ||
      error instanceof StateConflictError
    ) {
      return {
        ok: false,
        error: error.message,
        // `StateConflictError` is the one of these whose code is optional: most
        // of what it refuses is a condition the interface cannot reach, and an
        // explicit `undefined` is not the same as an absent key here.
        ...(error.code === undefined ? {} : { code: error.code }),
        params: error.params
      }
    }

    return { ok: false, error: describeError(error) }
  }
}
