import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '@core/events.js'
import type { ChatEntry } from '@core/transcript.js'

import { buildBlocks, type LogBlock, type ToolCall, turnStartedAt } from './logBlocks.js'

const AT = '2026-08-13T09:00:00.000Z'

const agent = (event: AgentEvent, at = AT): ChatEntry => ({ role: 'agent', at, event })
const user = (text: string, at = AT): ChatEntry => ({ role: 'user', at, text })

/**
 * A tool call shaped the way the stream sends one. The name decides the input,
 * because for `Edit` and `Write` the log reads the change out of the arguments.
 */
const call = (id: string, name = 'Read', parent?: string): ChatEntry =>
  agent({
    type: 'tool_use',
    toolUseId: id,
    name,
    input: TOOL_INPUT[name] ?? { file_path: '/a.ts' },
    ...(parent === undefined ? {} : { parentToolUseId: parent })
  })

const TOOL_INPUT: Record<string, unknown> = {
  Edit: { file_path: '/a.ts', old_string: 'one', new_string: 'two' },
  ExitPlanMode: { plan: '# Do it' },
  AskUserQuestion: {
    questions: [
      {
        question: 'Which?',
        header: 'Pick',
        multiSelect: false,
        options: [
          { label: 'A', description: 'a' },
          { label: 'B', description: 'b' }
        ]
      }
    ]
  },
  EnterWorktree: { name: 'side' }
}

const answer = (id: string, ok = true, parent?: string): ChatEntry =>
  agent({
    type: 'tool_result',
    toolUseId: id,
    ok,
    content: ok ? 'fine' : 'no such file',
    ...(parent === undefined ? {} : { parentToolUseId: parent })
  })

const said = (text: string): ChatEntry => agent({ type: 'text', text })

const footer = agent({
  type: 'result',
  ok: true,
  costUsd: 0,
  durationMs: 100,
  inputTokens: 0,
  outputTokens: 0,
  terminalReason: null
})

const kinds = (blocks: readonly LogBlock[]): string[] => blocks.map((block) => block.kind)

function toolAt(blocks: readonly LogBlock[], index: number): ToolCall {
  const block = blocks[index]
  if (block?.kind !== 'tool') throw new Error(`block ${String(index)} is not a tool call`)
  return block.call
}

describe('one row per tool call', () => {
  it('leaves a log with no tool calls exactly as it was', () => {
    expect(kinds(buildBlocks([said('first'), said('second')]))).toEqual(['entry', 'entry'])
  })

  // The shape of Claude Code's transcript: a run of greps reads as the greps it
  // was, not as a count to be opened.
  it('draws every call as its own row', () => {
    const blocks = buildBlocks([call('c-1', 'Grep'), call('c-2', 'Grep'), call('c-3')])

    expect(kinds(blocks)).toEqual(['tool', 'tool', 'tool'])
  })

  it('folds a result into the call it answers', () => {
    const blocks = buildBlocks([call('c-1'), call('c-2'), answer('c-2'), answer('c-1', false)])

    expect(kinds(blocks)).toEqual(['tool', 'tool'])
    expect(toolAt(blocks, 0).result).toMatchObject({ ok: false })
    expect(toolAt(blocks, 1).result).toMatchObject({ ok: true, content: 'fine' })
  })

  it('has no result for a call the tool has not answered yet', () => {
    expect(toolAt(buildBlocks([call('c-1')]), 0).result).toBeNull()
  })

  // Keyed by position: the answer arriving must not move the row, or a row
  // opened while the tool ran would close the moment it finished.
  it('does not move a call when its answer arrives', () => {
    const before = buildBlocks([call('c-1'), said('looking')])
    const after = buildBlocks([call('c-1'), said('looking'), answer('c-1')])

    expect(after.map((block) => block.at)).toEqual(before.map((block) => block.at))
  })

  it('keeps an answer whose call is not in the log, so a failure still shows', () => {
    const blocks = buildBlocks([said('earlier'), answer('gone', false)])

    expect(kinds(blocks)).toEqual(['entry', 'entry'])
  })

  it('reads what an edit changed off the call', () => {
    const change = toolAt(buildBlocks([call('c-1', 'Edit')]), 0).change

    expect(change).toMatchObject({ path: '/a.ts', added: 1, removed: 1 })
    expect(toolAt(buildBlocks([call('c-1', 'Read')]), 0).change).toBeNull()
  })

  // The diff runs once per edit, not once per append: the blocks are rebuilt
  // every time the log grows.
  it('reads the same change once however often the log is rebuilt', () => {
    const edit = call('c-1', 'Edit')

    expect(toolAt(buildBlocks([edit]), 0).change).toBe(
      toolAt(buildBlocks([edit, said('more')]), 0).change
    )
  })

  // A plan has its frame, a question its card, a move its warning line — and
  // their results stay beside them, where those rows read them.
  it('leaves the calls with a row of their own as entries, with their results', () => {
    const blocks = buildBlocks([
      call('p', 'ExitPlanMode'),
      answer('p', false),
      call('q', 'AskUserQuestion'),
      call('w', 'EnterWorktree'),
      answer('w', false)
    ])

    expect(kinds(blocks)).toEqual(['entry', 'entry', 'entry', 'entry', 'entry'])
  })

  it('keeps the user’s words where they were said', () => {
    expect(kinds(buildBlocks([call('c-1'), user('stop'), call('c-2')]))).toEqual([
      'tool',
      'entry',
      'tool'
    ])
  })
})

describe('a call the log has already built', () => {
  // A row is memoised on its call: a fresh object on every append re-rendered
  // the whole log to add one line to it.
  it('is handed back as it was when nothing about it moved', () => {
    const entries = [call('c-1'), answer('c-1'), call('c-2')]

    const before = buildBlocks(entries)
    const after = buildBlocks([...entries, said('more')])

    expect(toolAt(after, 0)).toBe(toolAt(before, 0))
    expect(toolAt(after, 1)).toBe(toolAt(before, 1))
  })

  it('is built again once its answer arrives, or its turn closes', () => {
    const asked = call('c-1')
    const running = toolAt(buildBlocks([asked]), 0)
    const answered = toolAt(buildBlocks([asked, answer('c-1')]), 0)
    const closed = toolAt(buildBlocks([asked, answer('c-1'), footer]), 0)

    expect(answered).not.toBe(running)
    expect(answered.result).not.toBeNull()
    expect(closed).not.toBe(answered)
  })

  it('is built again when its subagent took another step', () => {
    const task = call('t', 'Task')
    const step = call('s-1', 'Grep', 't')
    const one = toolAt(buildBlocks([task, step]), 0)

    expect(toolAt(buildBlocks([task, step]), 0)).toBe(one)
    expect(toolAt(buildBlocks([task, step, call('s-2', 'Read', 't')]), 0)).not.toBe(one)
    expect(
      toolAt(
        buildBlocks([task, step, agent({ type: 'text', text: 'hm', parentToolUseId: 't' })]),
        0
      )
    ).not.toBe(one)
    // The same step, answered: the nested call is new, so the parent is too.
    expect(toolAt(buildBlocks([task, step, answer('s-1', true, 't')]), 0)).not.toBe(one)
  })

  it('compares a subagent’s remarks by the entries they are', () => {
    const task = call('t', 'Task')
    const remark = agent({ type: 'text', text: 'hm', parentToolUseId: 't' })
    const first = toolAt(buildBlocks([task, remark]), 0)

    expect(toolAt(buildBlocks([task, remark]), 0)).toBe(first)
    expect(
      toolAt(buildBlocks([task, agent({ type: 'text', text: 'hm', parentToolUseId: 't' })]), 0)
    ).not.toBe(first)
    // A step that was a remark becoming a call, at the same place.
    expect(toolAt(buildBlocks([task, call('s-1', 'Grep', 't')]), 0)).not.toBe(first)
  })
})

describe('a call the turn left behind', () => {
  // Without this a call cut off by an interrupt would spin for ever.
  it('is settled once a later turn has closed', () => {
    const blocks = buildBlocks([call('c-1'), footer, user('again'), call('c-2')])

    expect(toolAt(blocks, 0).settled).toBe(true)
    expect(toolAt(blocks, 3).settled).toBe(false)
  })
})

describe('the lines a change landed among', () => {
  const context = agent({
    type: 'change_context',
    toolUseId: 'c-1',
    context: { before: ['a'], after: ['c'], startLine: 2 }
  })

  it('reaches the change it belongs to, however late it arrives', () => {
    const blocks = buildBlocks([call('c-1', 'Edit'), call('c-2'), answer('c-1'), context])

    expect(kinds(blocks)).toEqual(['tool', 'tool'])
    expect(toolAt(blocks, 0).context).toMatchObject({ startLine: 2 })
    expect(toolAt(blocks, 1).context).toBeNull()
  })
})

describe('a footer with no turn above it', () => {
  it('draws nothing when it opens the log', () => {
    expect(buildBlocks([footer])).toEqual([])
  })

  it('does not move the entries after it', () => {
    expect(buildBlocks([footer, said('hello')]).map((block) => block.at)).toEqual([1])
  })

  it('is drawn wherever there is a turn above it', () => {
    expect(kinds(buildBlocks([said('done'), footer]))).toEqual(['entry', 'entry'])
  })
})

describe('what a subagent did', () => {
  const task = call('t', 'Task')

  it('goes inside the call that started it, as rows of the same kind', () => {
    const blocks = buildBlocks([
      task,
      call('s-1', 'Grep', 't'),
      answer('s-1', true, 't'),
      agent({ type: 'text', text: 'Found it', parentToolUseId: 't' }),
      answer('t'),
      said('All done')
    ])

    expect(kinds(blocks)).toEqual(['tool', 'entry'])
    const steps = toolAt(blocks, 0).steps ?? []
    expect(kinds(steps)).toEqual(['tool', 'entry'])
    expect(toolAt(steps, 0).result).toMatchObject({ ok: true })
  })

  // Its edits are drawn by the same row a level down, with their diff.
  it('nests its edits too', () => {
    const blocks = buildBlocks([task, call('s-1', 'Edit', 't')])

    expect(kinds(blocks)).toEqual(['tool'])
    expect(toolAt(toolAt(blocks, 0).steps ?? [], 0).change).not.toBeNull()
  })

  it('has no steps on a call that started no subagent', () => {
    expect(toolAt(buildBlocks([call('c-1')]), 0).steps).toBeNull()
  })

  it('does not hide a step whose call is not in the log', () => {
    expect(kinds(buildBlocks([call('s-1', 'Grep', 'gone')]))).toEqual(['tool'])
  })

  it('nests one subagent inside another', () => {
    const blocks = buildBlocks([task, call('inner', 'Task', 't'), call('deep', 'Read', 'inner')])
    const inner = toolAt(toolAt(blocks, 0).steps ?? [], 0)

    expect(kinds(inner.steps ?? [])).toEqual(['tool'])
  })
})

describe('when the turn under way began', () => {
  it('is the first thing said after the last turn closed', () => {
    const entries = [user('one', '09:00'), footer, user('two', '09:05'), call('c-1')]

    expect(turnStartedAt(entries)).toBe('09:05')
  })

  it('is the start of the log when no turn has closed yet', () => {
    expect(turnStartedAt([user('one', '09:00')])).toBe('09:00')
  })

  it('is nothing when nothing has been said since', () => {
    expect(turnStartedAt([user('one'), footer])).toBeNull()
    expect(turnStartedAt([])).toBeNull()
  })
})
