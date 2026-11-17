/** The value, or an error naming `what` — for a state the code proves cannot be missing. */
export function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${what}, found ${String(value)}.`)
  }
  return value
}
