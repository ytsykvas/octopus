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

/**
 * And at most this many characters of them.
 *
 * Both runs go into one message beside an instruction, and a message has a
 * ceiling (`ChatMessageSchema`): 200 lines of a server logging JSON came to more
 * than it, and Send refused the very text Help had written.
 */
export const TAIL_OUTPUT_CHARS = 30_000

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

/**
 * The last `lines` lines of `text`, blank lines at its end dropped, and no more
 * than `chars` of them — whole lines where it can, the end of one where a
 * single line is longer than that.
 */
export function lastLines(text: string, lines: number, chars: number = TAIL_OUTPUT_CHARS): string {
  const all = text.split('\n')
  while (all.length > 0 && all.at(-1)?.trim() === '') all.pop()

  // Walked from the end, so the lines kept are the last ones and the newline
  // between two is counted once.
  const kept: string[] = []
  let length = -1
  for (const line of all.slice(-lines).reverse()) {
    if (kept.length > 0 && length + 1 + line.length > chars) break
    kept.unshift(line)
    length += 1 + line.length
  }

  return kept.join('\n').slice(-chars)
}

/**
 * How long a value has to be before it is masked.
 *
 * Shorter ones are `true`, `dev`, a port — words a log prints on its own, which
 * masked would turn every `true` in the output into a variable's name.
 */
export const MASK_MIN_LENGTH = 6

/**
 * `text` with every value of `variables` replaced by `[NAME]`.
 *
 * A script that runs `set -x`, `cat`s its env file or prints its connection
 * string on a failed boot puts a credential in its own output, and Help puts
 * that output in a message. Longest first, so a value that contains another is
 * masked whole rather than around the shorter one.
 */
export function maskValues(text: string, variables: Readonly<Record<string, string>>): string {
  return Object.entries(variables)
    .filter(([, value]) => value.length >= MASK_MIN_LENGTH)
    .sort(([, left], [, right]) => right.length - left.length)
    .reduce((masked, [name, value]) => masked.replaceAll(value, `[${name}]`), text)
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
