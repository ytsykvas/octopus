import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AgentEvent } from './events.js'
import { chatTranscript } from './paths.js'
import {
  appendEntry,
  type ChatEntry,
  copyTranscript,
  readTranscript,
  removeTranscript
} from './transcript.js'

let root: string

const AT = '2026-08-11T09:00:00.000Z'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'octopus-transcript-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('reading and writing', () => {
  it('is empty for a chat that has never spoken', async () => {
    await expect(readTranscript('chat-1', root)).resolves.toEqual([])
  })

  it('keeps entries in the order they were written', async () => {
    await appendEntry('chat-1', { role: 'user', at: AT, text: 'add a test' }, root)
    await appendEntry(
      'chat-1',
      { role: 'agent', at: AT, event: { type: 'text', text: 'ok' } },
      root
    )

    await expect(readTranscript('chat-1', root)).resolves.toEqual([
      { role: 'user', at: AT, text: 'add a test' },
      { role: 'agent', at: AT, event: { type: 'text', text: 'ok' } }
    ])
  })

  it('creates the directory on the first append', async () => {
    await appendEntry('chat-1', { role: 'user', at: AT, text: 'hello' }, root)

    await expect(readFile(chatTranscript('chat-1', root), 'utf8')).resolves.toContain('hello')
  })

  it('keeps one chat out of another', async () => {
    await appendEntry('chat-1', { role: 'user', at: AT, text: 'mine' }, root)
    await appendEntry('chat-2', { role: 'user', at: AT, text: 'theirs' }, root)

    await expect(readTranscript('chat-1', root)).resolves.toEqual([
      { role: 'user', at: AT, text: 'mine' }
    ])
  })

  it('round-trips every kind of event', async () => {
    const entries: ChatEntry[] = [
      { role: 'agent', at: AT, event: { type: 'session_started', sessionId: 'sess-1' } },
      { role: 'agent', at: AT, event: { type: 'thinking', text: 'weighing it up' } },
      {
        role: 'agent',
        at: AT,
        event: { type: 'tool_use', toolUseId: 'c-1', name: 'Edit', input: { file_path: '/a.rb' } }
      },
      {
        role: 'agent',
        at: AT,
        event: { type: 'tool_result', toolUseId: 'c-1', ok: false, content: 'no such file' }
      },
      {
        role: 'agent',
        at: AT,
        event: { type: 'permission_request', requestId: 'r-1', toolName: 'Bash', input: {} }
      },
      {
        role: 'agent',
        at: AT,
        event: {
          type: 'result',
          ok: true,
          costUsd: 0.04,
          durationMs: 900,
          inputTokens: null,
          outputTokens: null,
          terminalReason: null
        }
      },
      { role: 'agent', at: AT, event: { type: 'error', message: 'gone wrong' } }
    ]

    for (const entry of entries) await appendEntry('chat-1', entry, root)

    await expect(readTranscript('chat-1', root)).resolves.toEqual(entries)
  })
})

describe('a damaged file', () => {
  // A crash mid-write leaves the last line half-finished. Refusing to open the
  // conversation over one truncated event would lose an hour of work.
  it('skips a truncated line and returns the rest', async () => {
    await appendEntry('chat-1', { role: 'user', at: AT, text: 'first' }, root)
    await writeFile(chatTranscript('chat-1', root), '{"role":"user","at":"2026-', {
      flag: 'a',
      encoding: 'utf8'
    })

    await expect(readTranscript('chat-1', root)).resolves.toEqual([
      { role: 'user', at: AT, text: 'first' }
    ])
  })

  // Valid JSON that is not an entry — an older format, or something written by
  // hand — is skipped for the same reason.
  it('skips a line that parses but is not an entry', async () => {
    await mkdir(join(root, 'chats'), { recursive: true })
    await writeFile(
      chatTranscript('chat-1', root),
      `${JSON.stringify({ role: 'narrator', text: 'x' })}\n${JSON.stringify({ role: 'user', at: AT, text: 'kept' })}\n`,
      'utf8'
    )

    await expect(readTranscript('chat-1', root)).resolves.toEqual([
      { role: 'user', at: AT, text: 'kept' }
    ])
  })

  it('ignores blank lines', async () => {
    await mkdir(join(root, 'chats'), { recursive: true })
    await writeFile(
      chatTranscript('chat-1', root),
      `\n${JSON.stringify({ role: 'user', at: AT, text: 'kept' })}\n\n`,
      'utf8'
    )

    await expect(readTranscript('chat-1', root)).resolves.toHaveLength(1)
  })
})

/*
 * A reader that skips what it cannot parse is forgiving, and that is the danger.
 *
 * `readTranscript` drops a line whose schema does not match rather than
 * failing, so an event written today with a shape that cannot be read back
 * would not break anything — it would silently stop existing the next time the
 * conversation was opened, and nothing would say so. Every kind of event worth
 * keeping therefore has to be shown making the round trip.
 */
describe('every kind of event survives being written and read', () => {
  const events: AgentEvent[] = [
    { type: 'session_started', sessionId: 'sess-1' },
    { type: 'text', text: 'Looking at auth.rb' },
    { type: 'thinking', text: 'weighing it up' },
    { type: 'tool_use', toolUseId: 'c-1', name: 'Edit', input: { file_path: '/a.ts' } },
    { type: 'tool_result', toolUseId: 'c-1', ok: true, content: 'done' },
    // The cut mark has to survive the round trip too, or a fold that offered
    // to show the rest would offer it on every result it read back.
    { type: 'tool_result', toolUseId: 'c-2', ok: true, content: 'head', truncated: true },
    {
      type: 'change_context',
      toolUseId: 'c-1',
      context: { before: ['one'], after: ['three'], startLine: 2 }
    },
    { type: 'permission_request', requestId: 'r-1', toolName: 'Bash', input: { command: 'ls' } },
    {
      type: 'result',
      ok: true,
      costUsd: null,
      durationMs: 900,
      inputTokens: 10,
      outputTokens: 2,
      terminalReason: 'completed'
    },
    { type: 'error', message: 'claude exited with code 1' },
    /* Both refusals, which were missing from this list while one of them was
       being written to disk. The pair is the reason the list is worth keeping
       whole: they differ in three fields, and a shape that cannot be read back
       takes the only account of why a turn went the way it did with it. */
    {
      type: 'model_refusal_fallback',
      originalModel: 'claude-opus-5',
      fallbackModel: 'claude-sonnet-5',
      scope: 'session',
      category: 'cyber',
      explanation: 'It looked like credential harvesting.'
    },
    {
      type: 'model_refusal_no_fallback',
      originalModel: 'claude-opus-5',
      category: null,
      explanation: null
    },
    // What the agent took back. It is the only record that a road was started
    // and abandoned, so it has to survive a restart like everything else here.
    { type: 'retracted', uuids: ['u-1', 'u-1-tool'] },
    // And the id the retraction points at, on the entry it points at.
    { type: 'text', text: 'Looking at auth.rb', uuid: 'u-1' }
  ]

  it.each(events.map((event) => [event.type, event] as const))(
    'reads back a %s exactly as it was written',
    async (_type, event) => {
      await appendEntry('chat-1', { role: 'agent', at: AT, event }, root)

      await expect(readTranscript('chat-1', root)).resolves.toEqual([
        { role: 'agent', at: AT, event }
      ])
    }
  )
})

describe('removal', () => {
  it('discards the history', async () => {
    await appendEntry('chat-1', { role: 'user', at: AT, text: 'gone soon' }, root)
    await removeTranscript('chat-1', root)

    await expect(readTranscript('chat-1', root)).resolves.toEqual([])
  })

  // Called when a workspace is removed, which may well have had no chat.
  it('says nothing about a chat that never wrote anything', async () => {
    await expect(removeTranscript('chat-nothing', root)).resolves.toBeUndefined()
  })
})

describe('copying, which is what forking a conversation needs', () => {
  it('carries every entry over', async () => {
    await appendEntry('chat-1', { role: 'user', at: AT, text: 'add a test' }, root)
    await appendEntry('chat-1', { role: 'user', at: AT, text: 'and another' }, root)

    await copyTranscript('chat-1', 'chat-2', root)

    await expect(readTranscript('chat-2', root)).resolves.toEqual([
      { role: 'user', at: AT, text: 'add a test' },
      { role: 'user', at: AT, text: 'and another' }
    ])
  })

  it('leaves the conversation it came from alone', async () => {
    await appendEntry('chat-1', { role: 'user', at: AT, text: 'add a test' }, root)
    await copyTranscript('chat-1', 'chat-2', root)
    await appendEntry('chat-2', { role: 'user', at: AT, text: 'only here' }, root)

    await expect(readTranscript('chat-1', root)).resolves.toEqual([
      { role: 'user', at: AT, text: 'add a test' }
    ])
  })

  it('creates the directory on first use', async () => {
    const fresh = join(root, 'nested')
    await appendEntry('chat-1', { role: 'user', at: AT, text: 'add a test' }, fresh)

    await copyTranscript('chat-1', 'chat-2', fresh)

    await expect(readTranscript('chat-2', fresh)).resolves.toHaveLength(1)
  })

  /*
   * Silence rather than a throw, matching `readTranscript`: a conversation
   * whose log was cleared has a live session and no history, and continuing it
   * is a reasonable thing to want.
   */
  it('says nothing about a source that has written nothing', async () => {
    await expect(copyTranscript('chat-nothing', 'chat-2', root)).resolves.toBeUndefined()
    await expect(readTranscript('chat-2', root)).resolves.toEqual([])
  })
})
