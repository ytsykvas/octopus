/**
 * The last lines a script printed, kept for somebody asking why it failed.
 *
 * A run's output otherwise lives only in the terminal on screen, and the window
 * throws a pane's buffer away when it unmounts — so by the time anybody asks
 * "why does Run not work?" the answer has usually gone. `main` keeps the raw
 * tail of each run as it streams; this module holds the pure parts: how much is
 * kept, how raw terminal bytes become readable lines, and how the env set's
 * values are masked out of them before Help quotes them.
 */

import { z } from 'zod'

import type { EnvSecret } from './envBlock.js'
import type { TerminalPurpose } from './terminal.js'

/**
 * How much raw output a reader is handed per run, in characters — `main` holds
 * up to twice this between trims (`appendTail`).
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

/**
 * How much of a refusal's reason a reader is handed: what the Scripts tab
 * showed in its banner, which a long one — a malformed config's every issue —
 * would otherwise take a message's whole ceiling with.
 */
export const REFUSAL_CHARS = 2000

/**
 * `kept` with `chunk` after it, trimmed to its last `TAIL_CHARS` once twice
 * that has piled up.
 *
 * Trimmed on every chunk, the whole tail was copied for each one: 18 ms per
 * 10 000 chunks against 0.3 ms this way, on a stream `main` also relays. A
 * reader takes the last `TAIL_CHARS` itself (`helpRun`).
 */
export function appendTail(kept: string, chunk: string): string {
  const next = kept + chunk
  return next.length > 2 * TAIL_CHARS ? next.slice(-TAIL_CHARS) : next
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
 * its last one — a trailing one is a CRLF line ending, dropped first: what was
 * on screen when the next line began. The catch-all
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
export function lastLines(text: string, lines: number, chars: number): string {
  const all = text.split('\n')
  while (all.length > 0 && all.at(-1)?.trim() === '') all.pop()

  // `length` starts at -1: n lines are joined by n − 1 newlines.
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
 * `text` with every secret in it replaced by `[NAME]`, or `[masked]` where no
 * name owns it.
 *
 * A script that runs `set -x`, `cat`s an env file or prints its connection
 * string on a failed boot puts a credential in its own output, and Help puts
 * that output in a message. Longest first, so a value that contains another is
 * masked whole rather than around the shorter one.
 */
export function maskValues(text: string, secrets: readonly EnvSecret[]): string {
  const labels = new Map<string, string>()
  for (const { name, value } of secrets) {
    if (value.length >= MASK_MIN_LENGTH && !labels.has(value))
      labels.set(value, `[${name ?? 'masked'}]`)
  }

  return [...labels]
    .sort(([left], [right]) => right.length - left.length)
    .reduce((masked, [value, label]) => masked.replaceAll(value, label), text)
}

/** The two purposes worth asking about afterwards, in the order a Run starts them. */
export const RUN_PURPOSES = ['setup', 'run'] as const satisfies readonly TerminalPurpose[]

export const RunPurposeSchema = z.enum(RUN_PURPOSES)

export type RunPurpose = z.infer<typeof RunPurposeSchema>

export function isRunPurpose(purpose: string): purpose is RunPurpose {
  return RunPurposeSchema.safeParse(purpose).success
}

/** Where a run got to. */
export type RunOutcome =
  | { readonly kind: 'running' }
  /** `exitCode` is null when a signal ended it, as `terminal:exit` reports it. */
  | { readonly kind: 'exited'; readonly at: string; readonly exitCode: number | null }
  /** Stopped before its script ran, and why, in the words the Scripts tab showed. */
  | { readonly kind: 'refused'; readonly reason: string }

/**
 * A workspace's most recent build or server as `main` keeps it.
 *
 * `raw` is what the terminal was sent — not cleaned, masked or cut yet — so it
 * is never handed to the window; `helpRun` makes a `LastRun` of it.
 */
export interface RecordedRun {
  readonly purpose: RunPurpose
  readonly outcome: RunOutcome
  readonly raw: string
}

/**
 * A workspace's last build and server, whichever it has, in the shape whoever
 * keeps them holds a record in.
 */
export type WorkspaceRuns<R> = Partial<Record<RunPurpose, R>>

/**
 * `runs` once `purpose` has started afresh as `record`, which replaces its last.
 *
 * A build starts a new Run, so it drops the server too: the one from the Run
 * before would read as this one's — a fresh failed build beside an older
 * server that came up.
 */
export function withRun<R>(
  runs: WorkspaceRuns<R> | undefined,
  purpose: RunPurpose,
  record: R
): WorkspaceRuns<R> {
  return { ...(purpose === 'setup' ? {} : runs), [purpose]: record }
}

/**
 * One script's most recent run in a workspace, as somebody asking about it
 * reads it. A refused one never ran, so it has no output to read.
 */
export type LastRun =
  | { readonly purpose: RunPurpose; readonly outcome: Extract<RunOutcome, { kind: 'refused' }> }
  | {
      readonly purpose: RunPurpose
      readonly outcome: Exclude<RunOutcome, { kind: 'refused' }>
      readonly output: string
    }

/**
 * The last `TAIL_CHARS` of `raw`, from its first whole line where anything was
 * cut.
 *
 * A cut lands anywhere, and the line it lands in keeps only its end: the rest
 * of a secret, which no longer matches what masking looks for, or half an
 * escape. A tail at the limit has been cut — or is exactly that long, and
 * loses a line it did not have to.
 */
function fromWholeLine(raw: string): string {
  if (raw.length < TAIL_CHARS) return raw

  const tail = raw.slice(-TAIL_CHARS)
  const start = tail.indexOf('\n')
  return start === -1 ? '' : tail.slice(start + 1)
}

/**
 * A recorded run as Help may quote it: cleaned, masked, then cut.
 *
 * Masked before it is cut, so a cut cannot land inside a value and leave the
 * rest of it unmatched.
 */
export function helpRun(
  { purpose, outcome, raw }: RecordedRun,
  secrets: readonly EnvSecret[]
): LastRun {
  // A refusal can quote what it refused: a port's holder, a file's contents.
  if (outcome.kind === 'refused') {
    // Masked before it is cut, for the same reason the output is.
    const reason = maskValues(outcome.reason, secrets).slice(0, REFUSAL_CHARS)
    return { purpose, outcome: { kind: 'refused', reason } }
  }

  const masked = maskValues(cleanTerminalOutput(fromWholeLine(raw)), secrets)
  return { purpose, outcome, output: lastLines(masked, TAIL_LINES, TAIL_OUTPUT_CHARS) }
}
