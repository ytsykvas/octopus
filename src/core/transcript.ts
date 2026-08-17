/**
 * Chat history on disk — one append-only JSONL file per chat.
 *
 * The SDK's `resume` restores what the *model* remembers, which is not the
 * same thing as what the screen has to draw. Without our own record a chat
 * comes back empty after a restart while its session is very much alive.
 *
 * Append-only, and one line per entry, because the alternative is rewriting a
 * growing JSON document on every event: a chat that has run for an hour would
 * spend most of its time serialising its own past.
 */

import { appendFile, copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { AgentEventSchema } from './events.js'
import { chatTranscript } from './paths.js'
import type { ChatId } from './types.js'

export const ChatEntrySchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), at: z.iso.datetime(), text: z.string() }),
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
