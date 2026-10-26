/**
 * What a failure looks like on the far side of the bridge.
 *
 * Moved out of `src/main/result.ts`, where it was the `catch` of `attempt`,
 * because a failure now crosses in a push as well as in an invoke reply: the
 * pull-request draft runs on after the window that asked has moved on, and its
 * outcome is announced rather than returned. Two places deciding this shape
 * would be two places for a code to be dropped from.
 */

import { ZodError } from 'zod'

import { isCoded } from './codedError.js'
import { describeError } from './persist.js'

/**
 * A failure as the window receives it.
 *
 * Validation failures also carry a code and params, so the renderer can render
 * a localised message rather than the raw English fallback.
 */
export interface Failure {
  readonly ok: false
  readonly error: string
  readonly code?: string
  readonly params?: Readonly<Record<string, string>>
}

/** Any thrown value, as something the window can explain. */
export function failureOf(error: unknown): Failure {
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

  /*
   * A value the boundary refused, said in words rather than in JSON.
   *
   * Under zod 4 a `ZodError`'s `message` **is** `JSON.stringify(issues)`, so
   * this fell to the uncoded fallback and the window pasted a multi-line
   * array of `origin` / `code` / `maximum` objects into its generic frame.
   *
   * Most of the `.parse` sites here refuse values the interface cannot
   * produce, and `docs/ipc.md` says plainly they exist for a buggy renderer
   * rather than for a person. The handful somebody genuinely reaches by
   * typing or pasting are the reason this arm exists: a chat message past
   * 100,000 characters is an ordinary outcome of pasting a file, and the
   * refusal has to name the limit.
   *
   * The issues are flattened the way `readJsonFile` already flattens them —
   * the project's own precedent that a raw `ZodError` is not presentable.
   * One code carrying the reason rather than one code per site: the sentence
   * differs because the reason does, which is what a bare `invalidArgument`
   * would have lost.
   */
  if (error instanceof ZodError) {
    const reason = error.issues.map((issue) => issue.message).join('; ')

    return { ok: false, error: reason, code: 'valueRefused', params: { reason } }
  }

  return { ok: false, error: describeError(error) }
}
