/**
 * The one shape a failure crosses the bridge in.
 *
 * `attempt` in `src/main/result.ts` decides what carries a code, and it used to
 * decide by a chain of `instanceof`s naming each class one at a time — written
 * by hand, connected to nothing. So a ninth class was left off it silently, and
 * every skill refusal reached the window as the developer English meant for a
 * log, with eight translations sitting unreachable behind it. A tenth cannot be
 * left off now: extending this is what puts it in.
 *
 * Nothing but the standard library behind it, so it is safe to import from the
 * renderer — which matters because the window's `useErrorMessage` is typed
 * against the code unions these classes carry.
 *
 * The parameter is constrained to `string | undefined` rather than `string`,
 * which is what lets `StateConflictError` join: most of what that one refuses is
 * a state the interface cannot reach, and those carry no code deliberately.
 * Every other subclass names its own union and the inherited constructor then
 * holds each of its throw sites to it.
 */
export abstract class CodedError<
  Code extends string | undefined = string | undefined
> extends Error {
  constructor(
    readonly code: Code,
    readonly params: Readonly<Record<string, string>>,
    message: string
  ) {
    super(message)
  }
}

/**
 * Whether a failure carries a code, as a predicate rather than an `instanceof`.
 *
 * Written out because `instanceof` on a **generic** class narrows to
 * `CodedError<any>`, and reading `code` off that is an `any` reaching the one
 * place whose whole job is deciding what the window gets told. The predicate
 * names the answer, so the caller reads `string | undefined` as it should.
 */
export function isCoded(error: unknown): error is CodedError {
  return error instanceof CodedError
}
