/**
 * The last lines a script printed, kept for somebody asking why it failed.
 *
 * A run's output otherwise lives only in the terminal on screen, and the window
 * throws a pane's buffer away when it unmounts — so by the time anybody asks
 * "why does Run not work?" the answer has usually gone. `main` keeps the raw
 * tail of each run as it streams; these are the pure halves of that: how much
 * is kept, and how the raw bytes of a terminal become lines a person — or an
 * agent — can read.
 */

/**
 * How much raw output is kept per run, in characters.
 *
 * Raw rather than cleaned, because cleaning on every chunk would cost more than
 * the stream it is reading; and generous, because colour codes and redrawn
 * progress bars take most of it.
 */
export const TAIL_CHARS = 64 * 1024

/** How many cleaned lines a reader is handed. */
export const TAIL_LINES = 200

/** `kept` with `chunk` appended, cut to the last `TAIL_CHARS`. */
export function appendTail(kept: string, chunk: string): string {
  return (kept + chunk).slice(-TAIL_CHARS)
}

/** Control sequences: colours, cursor moves, line erases. */
// eslint-disable-next-line no-control-regex -- an escape is a control character by definition
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g
/** Operating-system commands, the window title among them, ended by BEL or ST. */
// eslint-disable-next-line no-control-regex -- an escape is a control character by definition
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g
/**
 * Every other escape: one final character, after any intermediates — the
 * keypad modes, saving the cursor, and the `ESC ( B` that `tput sgr0` prints.
 */
// eslint-disable-next-line no-control-regex -- an escape is a control character by definition
const SINGLE = /\u001b[ -/]*[0-~]/g

/**
 * The text a terminal would show, without the bytes that told it how.
 *
 * A progress bar redraws itself with `\r`, so a line keeps only what follows
 * its last one: what was on screen when the next line began. The catch-all
 * pattern runs last: it matches `ESC ]` and `ESC [` too, and run first it
 * would take those alone and leave a window title or a colour's digits behind
 * as text.
 */
export function cleanTerminalOutput(raw: string): string {
  return raw
    .replace(OSC, '')
    .replace(CSI, '')
    .replace(SINGLE, '')
    .split('\n')
    .map((line) => {
      const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line
      return trimmed.slice(trimmed.lastIndexOf('\r') + 1)
    })
    .join('\n')
}

/** The last `lines` lines of `text`, blank lines at its end dropped. */
export function lastLines(text: string, lines: number): string {
  const all = text.split('\n')
  while (all.length > 0 && all.at(-1)?.trim() === '') all.pop()
  return all.slice(-lines).join('\n')
}

/** One script's most recent run in a workspace, as somebody asking about it reads it. */
export interface LastRun {
  readonly purpose: 'setup' | 'run'
  /** When the shell ended, or null while it is still running. */
  readonly endedAt: string | null
  /** Null while running or when a signal ended it, as `terminal:exit` reports it. */
  readonly exitCode: number | null
  /** Cleaned, at most the last `TAIL_LINES` lines. */
  readonly output: string
}
