/**
 * How a signal reaches a process, injected so tests never send a real one.
 *
 * Signal 0 sends nothing: it throws when no such process — or, for a negative
 * pid, no such group — exists, which is how a stop knows a group has emptied.
 */
export type Kill = (pid: number, signal: NodeJS.Signals | 0) => void

export const killProcess: Kill = (pid, signal) => {
  process.kill(pid, signal)
}

/** Signals a process, or a group as `-leader`; one already gone is what was wanted. */
export function signalQuietly(
  kill: (target: number, signal: NodeJS.Signals) => void,
  target: number,
  signal: NodeJS.Signals
): void {
  try {
    kill(target, signal)
  } catch {
    // Gone between being read and being signalled.
  }
}
