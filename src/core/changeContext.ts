/**
 * The lines an edit landed among.
 *
 * Read the moment the edit succeeds rather than when the conversation is drawn:
 * a later edit shifts every line after it, so context looked up afterwards
 * would surround a change that has moved or gone. Recorded once, it stays true
 * however long the transcript is kept.
 */

import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import { z } from 'zod'

import type { ChangeContext } from './events.js'

const EditSchema = z.object({
  file_path: z.string().min(1),
  new_string: z.string().min(1)
})

/** A file an edit touched, and the text it left there. */
export interface EditTarget {
  readonly path: string
  readonly written: string
}

/**
 * What an `Edit` acted on, or null for anything else.
 *
 * `Write` is deliberately not one of these: the file *is* the change, so there
 * are no lines around it to show. Nor is an edit that wrote nothing — there
 * would be no text to find the change by.
 */
export function readEditTarget(toolName: string, input: unknown): EditTarget | null {
  if (toolName !== 'Edit') return null

  const parsed = EditSchema.safeParse(input)
  return parsed.success ? { path: parsed.data.file_path, written: parsed.data.new_string } : null
}

/**
 * Tools that leave a file changed, named by `file_path`.
 *
 * An allowlist, and it has to be one: `Read` names a `file_path` too, and
 * attributing a file to whoever merely looked at it would make the pane wrong
 * rather than incomplete — which is the more expensive of the two on a review
 * surface. A tool not on this list attributes nothing, so something added
 * upstream is silent until somebody adds it here.
 *
 * `Bash` writes files and is deliberately absent: what a command touched is not
 * knowable from its arguments, and guessing at it is the same mistake.
 */
const WRITING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/**
 * The file a tool call left changed, or null.
 *
 * Wider than `readEditTarget` above and asking a different question: that one
 * wants the text an edit left, so the lines around it can be found, and only
 * `Edit` leaves such text. This one wants only **which file**.
 */
export function writtenPath(toolName: string, input: unknown): string | null {
  if (!WRITING_TOOLS.has(toolName)) return null
  if (typeof input !== 'object' || input === null) return null

  const value = (input as Record<string, unknown>).file_path
  return typeof value === 'string' && value !== '' ? value : null
}

/** How many lines either side. Enough to place a change, short enough to scan. */
const RADIUS = 3

/**
 * Whether a path is inside a directory.
 *
 * The file path comes from the agent, so it is the agent's word for where it
 * edited. A worktree is what a workspace may show, and a relative path climbing
 * out of one — or an absolute path somewhere else entirely — is a request this
 * has no business answering.
 */
function isInside(directory: string, path: string): boolean {
  const step = relative(resolve(directory), resolve(directory, path))
  return step !== '' && !step.startsWith('..') && !isAbsolute(step)
}

/**
 * Splits a file the way its lines are numbered.
 *
 * A trailing newline ends the last line rather than starting an empty one, so
 * the count matches what an editor would show.
 */
function toLines(text: string): string[] {
  // Nothing is no lines, so an edit that wrote nothing has nothing to be found
  // by — rather than a single empty line to hunt for through the file.
  if (text === '') return []

  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/**
 * Where a run of lines sits in a file, or -1 when it is not there exactly once.
 *
 * Once is the whole point. Text that appears twice gives no way to say which
 * copy was edited, and picking one would put the change among lines it never
 * touched — a mistake nobody reading the log could catch.
 */
function soleIndex(lines: readonly string[], needle: readonly string[]): number {
  if (needle.length === 0) return -1

  let found = -1

  for (let start = 0; start + needle.length <= lines.length; start++) {
    if (needle.some((line, offset) => lines[start + offset] !== line)) continue
    if (found !== -1) return -1
    found = start
  }

  return found
}

/**
 * The lines around `written`, as the file now stands.
 *
 * Answers null rather than guessing: the file may be unreadable, outside the
 * worktree, or hold the text more than once. Context is a courtesy, and a wrong
 * one is worse than none — it would show a change sitting among lines it never
 * touched.
 */
export async function readChangeContext(
  worktree: string,
  path: string,
  written: string
): Promise<ChangeContext | null> {
  if (!isInside(worktree, path)) return null

  let contents: string
  try {
    contents = await readFile(resolve(worktree, path), 'utf8')
  } catch {
    return null
  }

  const lines = toLines(contents)
  const needle = toLines(written)
  const at = soleIndex(lines, needle)
  if (at === -1) return null

  return {
    before: lines.slice(Math.max(0, at - RADIUS), at),
    after: lines.slice(at + needle.length, at + needle.length + RADIUS),
    // 1-based, as every editor counts them.
    startLine: at + 1
  }
}
