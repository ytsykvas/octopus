/**
 * Chat history on disk — one append-only JSONL file per chat.
 *
 * The SDK's `resume` restores what the *model* remembers, which is not the
 * same thing as what the screen has to draw. Without our own record a chat
 * comes back empty after a restart while its session is very much alive.
 *
 * Appended to, one line per entry, because the alternative is rewriting a
 * growing JSON document on every event: a chat that has run for an hour would
 * spend most of its time serialising its own past. The one rewrite is a rewind,
 * which only ever takes lines off the end (`truncateTranscript`).
 */

import { appendFile, copyFile, type FileHandle, mkdir, open, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { AgentEventSchema } from './events.js'
import { chatTranscript } from './paths.js'
import { writeTextFile } from './persist.js'
import type { ChatId } from './types.js'

export const ChatEntrySchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('user'),
    at: z.iso.datetime(),
    text: z.string(),
    /**
     * The id the agent knows this message by, which is what putting the files
     * back to it is asked with. Absent on a message sent before it was kept, and
     * such a message simply offers no rewind.
     */
    uuid: z.string().optional()
  }),
  z.object({ role: z.literal('agent'), at: z.iso.datetime(), event: AgentEventSchema })
])

export type ChatEntry = Readonly<z.infer<typeof ChatEntrySchema>>

/** Appends one entry, creating the file and its directory on first use. */
export async function appendEntry(chatId: ChatId, entry: ChatEntry, root?: string): Promise<void> {
  const path = chatTranscript(chatId, root)

  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8')
}

/**
 * Everything recorded for a chat; empty when it has never spoken.
 *
 * A line that does not parse is skipped rather than thrown on. A crash during
 * a write leaves a half-finished last line, and refusing to open the whole
 * conversation over one truncated event would lose an hour of work to a
 * partial byte.
 */
export async function readTranscript(chatId: ChatId, root?: string): Promise<ChatEntry[]> {
  let contents: string
  try {
    contents = await readFile(chatTranscript(chatId, root), 'utf8')
  } catch {
    return []
  }

  const entries: ChatEntry[] = []
  for (const line of contents.split('\n')) {
    if (line.trim() === '') continue

    const parsed = ChatEntrySchema.safeParse(parseJson(line))
    if (parsed.success) entries.push(parsed.data)
  }

  return entries
}

/** How much of a conversation's first message a list of them shows. */
export const MAX_PREVIEW = 80

/**
 * The first thing the user said, as one short line — what a closed
 * conversation is recognised by.
 *
 * A name is rarely given and the automatic one is a place in a strip it no
 * longer holds, so "Claude 2" tells nobody which conversation it was. The
 * opening message does. Empty for one that never had one.
 */
export async function previewOf(chatId: ChatId, root?: string): Promise<string> {
  let handle: FileHandle
  try {
    handle = await open(chatTranscript(chatId, root), 'r')
  } catch {
    return ''
  }

  // Read line by line and left at the first message the user wrote: a list of
  // twenty conversations should not cost twenty whole transcripts, which for a
  // long one is megabytes read to find a line near the top. `readLines` closes
  // the handle when the loop is left, early or not.
  for await (const text of handle.readLines({ encoding: 'utf8' })) {
    if (text.trim() === '') continue

    const parsed = ChatEntrySchema.safeParse(parseJson(text))
    if (!parsed.success || parsed.data.role !== 'user') continue

    const line = parsed.data.text.replace(/\s+/g, ' ').trim()
    return line.length > MAX_PREVIEW ? `${line.slice(0, MAX_PREVIEW - 1)}…` : line
  }

  return ''
}

/**
 * Copies one chat's history onto another — what forking a conversation needs.
 *
 * The SDK's own `forkSession` copies what the *model* remembers; this copies
 * what the *screen* draws. Both halves are needed, and this is the one nothing
 * upstream can do: without it the forked conversation opens empty above an
 * agent that remembers all of it — this module's opening problem, inverted.
 *
 * Silent when it cannot be done, matching `readTranscript` rather than
 * `appendEntry`. A conversation whose log was cleared has a live session and no
 * history, and forking it is a reasonable thing to want; and a copy that fails
 * for any other reason leaves the new conversation looking exactly like that
 * one — empty, above an agent that remembers. Failing the fork instead would
 * cost the conversation itself over a file the caller can live without.
 */
export async function copyTranscript(from: ChatId, to: ChatId, root?: string): Promise<void> {
  const source = chatTranscript(from, root)
  const target = chatTranscript(to, root)

  try {
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target)
  } catch {
    // Nothing was said in the source, or nothing can be written for it.
  }
}

/**
 * Cuts a chat's history back to just before a message the user sent, and
 * answers with that message's text — which is what the composer is handed back.
 *
 * Null, with the file untouched, when no such message is in it: the caller has
 * already checked, and a cut at a guess would lose lines for nothing.
 *
 * The lines kept are kept byte for byte, an unreadable one included: this takes
 * a suffix away and has no business reformatting what stays. Written whole and
 * renamed into place, so a crash leaves either history and never half of one.
 */
export async function truncateTranscript(
  chatId: ChatId,
  messageId: string,
  root?: string
): Promise<string | null> {
  const path = chatTranscript(chatId, root)

  let contents: string
  try {
    contents = await readFile(path, 'utf8')
  } catch {
    return null
  }

  const lines = contents.split('\n')
  for (const [index, line] of lines.entries()) {
    const parsed = ChatEntrySchema.safeParse(parseJson(line))
    if (!parsed.success || parsed.data.role !== 'user' || parsed.data.uuid !== messageId) continue

    const kept = lines.slice(0, index)
    await writeTextFile(path, kept.length === 0 ? '' : `${kept.join('\n')}\n`)
    return parsed.data.text
  }

  return null
}

/** Discards a chat's history — called when its workspace goes. */
export async function removeTranscript(chatId: ChatId, root?: string): Promise<void> {
  await rm(chatTranscript(chatId, root), { force: true })
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}
