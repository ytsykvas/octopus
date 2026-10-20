import { describe, expect, it } from 'vitest'

import type { AgentEvent } from './events.js'
import { formatHandoff, HANDOFF_LIMIT } from './handoff.js'
import type { ChatEntry } from './transcript.js'

const AT = '2026-08-11T09:00:00.000Z'

const user = (text: string): ChatEntry => ({ role: 'user', at: AT, text })
const agent = (event: AgentEvent): ChatEntry => ({ role: 'agent', at: AT, event })
const said = (text: string, parentToolUseId?: string): ChatEntry =>
  agent({ type: 'text', text, ...(parentToolUseId !== undefined && { parentToolUseId }) })
const call = (
  name: string,
  input: unknown,
  toolUseId = 't1',
  parentToolUseId?: string
): ChatEntry =>
  agent({
    type: 'tool_use',
    toolUseId,
    name,
    input,
    ...(parentToolUseId !== undefined && { parentToolUseId })
  })
const result = (
  toolUseId: string,
  ok: boolean,
  content: string,
  parentToolUseId?: string
): ChatEntry =>
  agent({
    type: 'tool_result',
    toolUseId,
    ok,
    content,
    ...(parentToolUseId !== undefined && { parentToolUseId })
  })

const META = { title: 'Claude 1' }

describe('what a handoff says', () => {
  it('names the conversation and tells the reader what it is holding', () => {
    const text = formatHandoff([], META)

    expect(text).toContain('# Earlier conversation: Claude 1')
    expect(text).toContain('previous session')
  })

  it('writes the exchange in order, one heading per speaker', () => {
    const text = formatHandoff([user('add a test'), said('Done, it is in a.test.ts.')], META)

    expect(text).toMatch(/## User\n\nadd a test\n\n## Assistant\n\nDone, it is in a.test.ts\./)
  })

  it('keeps what the assistant said between its tool calls under one heading', () => {
    const text = formatHandoff(
      [user('go'), said('Looking.'), call('Read', { file_path: 'src/a.ts' }), said('Found it.')],
      META
    )

    expect(text.match(/## Assistant/g)).toHaveLength(1)
    expect(text).toContain('Looking.\n\n- Read: `src/a.ts`\n\nFound it.')
  })

  it('starts a new heading when the user speaks again', () => {
    const text = formatHandoff([user('one'), said('a'), user('two'), said('b')], META)

    expect(text.match(/## User/g)).toHaveLength(2)
    expect(text.match(/## Assistant/g)).toHaveLength(2)
  })

  it('does not merge two messages from the user into one', () => {
    const text = formatHandoff([user('one'), user('two')], META)

    expect(text.match(/## User/g)).toHaveLength(2)
  })
})

describe('what a tool call is reduced to', () => {
  const lineFor = (name: string, input: unknown): string =>
    formatHandoff([call(name, input)], META)
      .split('\n')
      .find((line) => line.startsWith('- ')) ?? ''

  it.each([
    ['Edit', { file_path: 'src/a.ts' }, '- Edit: `src/a.ts`'],
    ['Glob', { path: 'src', pattern: '*.ts' }, '- Glob: `src`'],
    ['Bash', { command: 'npm test' }, '- Bash: `npm test`'],
    ['Grep', { pattern: 'TODO' }, '- Grep: `TODO`'],
    ['WebFetch', { url: 'https://example.com' }, '- WebFetch: `https://example.com`'],
    ['Agent', { description: 'survey the tests' }, '- Agent: `survey the tests`']
  ])('names %s by the argument that says what it was for', (name, input, expected) => {
    expect(lineFor(name, input)).toBe(expected)
  })

  it('names a call with no usable argument on its own', () => {
    expect(lineFor('TaskList', {})).toBe('- TaskList')
    expect(lineFor('TaskList', null)).toBe('- TaskList')
    expect(lineFor('TaskList', { file_path: 3 })).toBe('- TaskList')
  })

  it('keeps only the first line of a command and cuts a long one', () => {
    expect(lineFor('Bash', { command: 'git add .\ngit commit' })).toBe('- Bash: `git add .`')

    const long = lineFor('Bash', { command: 'x'.repeat(500) })

    expect(long.length).toBeLessThan(200)
    expect(long).toContain('…')
  })
})

describe('what is left out', () => {
  it('drops tool output, thinking and the interface talking to itself', () => {
    const text = formatHandoff(
      [
        user('go'),
        agent({ type: 'thinking', text: 'SECRET-THOUGHT' }),
        agent({ type: 'text_delta', text: 'DELTA' }),
        call('Read', { file_path: 'a.ts' }),
        result('t1', true, 'FILE-CONTENTS'),
        agent({ type: 'session_started', sessionId: 's1' })
      ],
      META
    )

    expect(text).not.toMatch(/SECRET-THOUGHT|DELTA|FILE-CONTENTS|s1/)
    expect(text).toContain('- Read: `a.ts`')
  })

  it('drops what a subagent said and did on the way', () => {
    const text = formatHandoff(
      [
        user('go'),
        call('Agent', { description: 'dig' }, 'outer'),
        said('SUB-TEXT', 'outer'),
        call('Read', { file_path: 'sub.ts' }, 'inner', 'outer'),
        result('inner', false, 'SUB-FAILURE', 'outer')
      ],
      META
    )

    expect(text).not.toMatch(/SUB-TEXT|sub\.ts|SUB-FAILURE/)
    expect(text).toContain('- Agent: `dig`')
  })

  it('keeps a failed call, named, because it is a dead end', () => {
    const text = formatHandoff(
      [user('go'), call('Bash', { command: 'npm test' }), result('t1', false, 'boom\nstack')],
      META
    )

    expect(text).toContain('- Bash failed: boom')
    expect(text).not.toContain('stack')
  })

  it('names a failure whose call is not in the record "tool"', () => {
    const text = formatHandoff([result('lost', false, 'boom')], META)

    expect(text).toContain('- tool failed: boom')
  })
})

describe('a conversation too long to paste', () => {
  const turns = (count: number): ChatEntry[] =>
    Array.from({ length: count }, (_, index) => [
      user(`question ${String(index)}`),
      said(`answer ${String(index)} ${'x'.repeat(100)}`)
    ]).flat()

  it('is left whole when it fits', () => {
    const text = formatHandoff(turns(3), META)

    expect(text).not.toContain('in between')
    expect(text).toContain('question 0')
    expect(text).toContain('question 2')
  })

  it('keeps the opening request and the newest turns, and says what went', () => {
    const text = formatHandoff(turns(20), META, 700)

    expect(text).toContain('question 0')
    expect(text).toContain('answer 19')
    expect(text).not.toContain('question 10')
    expect(text).toMatch(/\d+ messages in between are left out/)
  })

  it('counts the messages it left out', () => {
    const text = formatHandoff(turns(20), META, 700)
    const [, omitted] = /_(\d+) messages in between/.exec(text) ?? []
    const shown = text.match(/^## /gm)?.length ?? 0

    expect(Number(omitted) + shown).toBe(40)
  })

  it('keeps the newest message even when it alone is over the limit', () => {
    const text = formatHandoff([user('first'), user('second'), said('y'.repeat(2000))], META, 100)

    expect(text).toContain('first')
    expect(text).toContain('y'.repeat(2000))
    expect(text).not.toContain('second')
  })

  it('has a default ceiling', () => {
    const text = formatHandoff(
      Array.from({ length: 400 }, (_, index) => user(`${String(index)} ${'z'.repeat(500)}`)),
      META
    )

    expect(text.length).toBeLessThan(HANDOFF_LIMIT + 2000)
    expect(text).toContain('399 ')
  })
})
