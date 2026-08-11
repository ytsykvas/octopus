import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { chatTranscript } from './paths.js'
import { appendEntry, type ChatEntry, readTranscript, removeTranscript } from './transcript.js'

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
