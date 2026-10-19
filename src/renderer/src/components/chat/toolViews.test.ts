import { describe, expect, it } from 'vitest'

import type { ToolCall, ToolResult } from './logBlocks.js'
import { agentReport, cleanOutput, kindOf, summarise, type ToolLabel, viewOf } from './toolViews.js'

const label = (name: string, input: unknown): ToolLabel => viewOf(name).label(name, input)

function result(overrides: Partial<ToolResult> = {}): ToolResult {
  return { type: 'tool_result', toolUseId: 'c-1', ok: true, content: '', ...overrides }
}

function called(name: string, answer: ToolResult | null): ToolCall {
  return {
    toolUseId: 'c-1',
    name,
    input: {},
    uuid: undefined,
    result: answer,
    change: null,
    context: null,
    settled: false,
    steps: null
  }
}

const lines = (count: number): string =>
  Array.from({ length: count }, (_, index) => `line ${String(index + 1)}`).join('\n')

describe('which view a tool gets', () => {
  it('knows the CLI’s own tools, MCP tools and everything else', () => {
    expect(kindOf('Read')).toBe('read')
    expect(kindOf('MultiEdit')).toBe('change')
    expect(kindOf('Agent')).toBe('agent')
    expect(kindOf('Task')).toBe('agent')
    expect(kindOf('mcp__github__get_issue')).toBe('mcp')
    expect(kindOf('SomethingNew')).toBe('other')
  })
})

describe('what a row names', () => {
  it('names a file a file tool touched, as a path the row can open', () => {
    expect(label('Read', { file_path: '/w/a.ts' })).toMatchObject({
      name: 'Read',
      target: '/w/a.ts',
      path: '/w/a.ts'
    })
    expect(label('NotebookEdit', { notebook_path: '/w/n.ipynb' })).toMatchObject({
      path: '/w/n.ipynb'
    })
  })

  it('names the first line of a command, with its description beside it', () => {
    expect(label('Bash', { command: 'npm test\nnpm run lint', description: 'Run tests' })).toEqual({
      name: 'Bash',
      target: 'npm test',
      scope: null,
      path: null,
      hint: 'Run tests'
    })
    expect(label('Bash', { command: 'ls' })).toMatchObject({ hint: null })
  })

  it('quotes what a grep looked for, and says where', () => {
    expect(label('Grep', { pattern: 'useChat', path: 'src' })).toMatchObject({
      target: '"useChat"',
      scope: 'src'
    })
    expect(label('Glob', { pattern: '**/*.ts' })).toMatchObject({ target: '**/*.ts', scope: null })
  })

  it('names the host a fetch went to', () => {
    expect(label('WebFetch', { url: 'https://example.com/a/b' })).toMatchObject({
      target: 'example.com',
      hint: 'https://example.com/a/b'
    })
    expect(label('WebFetch', { url: 'not a url' })).toMatchObject({ target: 'not a url' })
    // Parses, but names no host: the address itself says more than nothing.
    expect(label('WebFetch', { url: 'mailto:me@example.com' })).toMatchObject({
      target: 'mailto:me@example.com'
    })
    expect(label('WebSearch', { query: 'zod v4' })).toMatchObject({ target: '"zod v4"' })
  })

  it('names what a subagent was sent to do, and which kind it is', () => {
    expect(label('Agent', { description: 'Find the bug', subagent_type: 'Explore' })).toMatchObject(
      { target: 'Find the bug', hint: 'Explore' }
    )
    expect(label('Task', {})).toMatchObject({ target: null, hint: null })
  })

  it('names a task by its subject, and an update by what it moved to', () => {
    expect(label('TaskCreate', { subject: 'Write tests' })).toMatchObject({
      target: 'Write tests'
    })
    expect(label('TaskUpdate', { taskId: '3', status: 'completed' })).toMatchObject({
      target: '#3 → completed'
    })
    expect(label('TaskUpdate', { taskId: '3' })).toMatchObject({ target: '#3' })
  })

  it('leaves a task list its checklist to speak for it', () => {
    expect(label('TodoWrite', { todos: [] })).toMatchObject({ target: null })
  })

  it('names an MCP tool by its server and its own name', () => {
    expect(label('mcp__github__get_issue', { url: 'x' })).toMatchObject({
      name: 'github · get_issue',
      target: 'x'
    })
  })

  // The input is whatever the model produced; one that does not match its
  // tool's shape still gets a row, from the generic reading.
  it('falls back to the first readable field when the input is not what the name promises', () => {
    for (const name of ['Read', 'NotebookEdit', 'Bash', 'Grep', 'WebFetch', 'WebSearch']) {
      expect(label(name, { description: 'odd' })).toMatchObject({ target: 'odd', path: null })
    }
    expect(label('Agent', 'not an object')).toMatchObject({ target: null })
    expect(label('TaskUpdate', { status: 'done' })).toMatchObject({ target: null })
    expect(label('Unknown', { command: 'x' })).toMatchObject({ name: 'Unknown', target: 'x' })
  })
})

describe('what opening a row shows of the input', () => {
  it('is the whole command for a shell call, which the row cuts to one line', () => {
    expect(viewOf('Bash').detail({ command: 'npm test\nnpm run lint' })).toBe(
      'npm test\nnpm run lint'
    )
    expect(viewOf('Bash').detail({ cmd: 'odd' })).toBe('{\n  "cmd": "odd"\n}')
  })

  it('is the input as sent, for a tool whose row cannot say all of it', () => {
    expect(viewOf('Grep').detail({ pattern: 'x', glob: '*.ts' })).toBe(
      '{\n  "pattern": "x",\n  "glob": "*.ts"\n}'
    )
    expect(viewOf('mcp__x__y').detail(undefined)).toBeNull()
  })

  it('is nothing where the row already says it all', () => {
    expect(viewOf('Read').detail({ file_path: '/a.ts' })).toBeNull()
    expect(viewOf('Edit').detail({ file_path: '/a.ts' })).toBeNull()
  })
})

describe('the line under a row', () => {
  it('is pending until the tool answers', () => {
    expect(summarise(called('Read', null))).toEqual({ kind: 'pending' })
  })

  it('is the head of the failure for any tool', () => {
    const failed = result({ ok: false, content: 'one\ntwo\nthree\nfour' })

    expect(summarise(called('Bash', failed))).toEqual({
      kind: 'failed',
      head: ['one', 'two', 'three']
    })
  })

  it('counts the lines a Read returned', () => {
    expect(summarise(called('Read', result({ stats: { lines: 120 } })))).toEqual({
      kind: 'lines',
      count: 120,
      atLeast: false
    })
    expect(summarise(called('Read', result({ content: lines(3) })))).toMatchObject({ count: 3 })
  })

  // A `<system-reminder>` comes back after the file, and counted as lines of
  // it every file was a dozen lines longer than it was.
  it('does not count what the harness appended for the model', () => {
    const read = result({ content: `${lines(2)}\n<system-reminder>\nx\ny\n</system-reminder>\n` })

    expect(summarise(called('Read', read))).toMatchObject({ count: 2 })
  })

  // Reopened, only the head was kept: the stored count says how long it was,
  // and without one — a conversation recorded before it was kept — the count
  // is a floor and says so.
  it('counts the whole output when only its head was kept', () => {
    const cut = result({ content: lines(5), truncated: true })

    expect(summarise(called('Read', { ...cut, lineCount: 900 }))).toMatchObject({
      count: 900,
      atLeast: false
    })
    expect(summarise(called('Read', cut))).toMatchObject({ count: 5, atLeast: true })
  })

  it('shows the first lines of a command’s output and how many more there were', () => {
    expect(summarise(called('Bash', result({ content: lines(10) })))).toEqual({
      kind: 'output',
      head: ['line 1', 'line 2', 'line 3', 'line 4'],
      more: 6
    })
    expect(summarise(called('Bash', result({ content: lines(2) })))).toMatchObject({ more: 0 })
    expect(summarise(called('Bash', result({ content: '\n' })))).toEqual({ kind: 'empty' })
  })

  it('counts what a search found, by whichever measure it reported', () => {
    expect(summarise(called('Grep', result({ stats: { files: 2, matches: 9 } })))).toEqual({
      kind: 'matches',
      count: 9
    })
    expect(summarise(called('Grep', result({ stats: { files: 2, lines: 4 } })))).toMatchObject({
      kind: 'lines',
      count: 4
    })
    expect(summarise(called('Grep', result({ stats: { files: 2 } })))).toEqual({
      kind: 'files',
      count: 2
    })
    expect(summarise(called('Glob', result({ stats: { files: 7 } })))).toEqual({
      kind: 'files',
      count: 7
    })
  })

  it('falls back to the output of a search that reported no counts', () => {
    expect(summarise(called('Grep', result({ content: 'a.ts' })))).toMatchObject({
      kind: 'output'
    })
    expect(summarise(called('Glob', result({ content: 'a.ts' })))).toMatchObject({
      kind: 'output'
    })
  })

  it('is the first line of a fetch, shortened to fit', () => {
    expect(summarise(called('WebFetch', result({ content: 'Fetched\nmore' })))).toEqual({
      kind: 'line',
      text: 'Fetched'
    })
    const long = summarise(called('WebSearch', result({ content: 'x'.repeat(200) })))
    expect(long).toMatchObject({ kind: 'line' })
    expect(long.kind === 'line' && long.text).toHaveLength(121)
    expect(summarise(called('TaskCreate', result({ content: '  ' })))).toEqual({ kind: 'empty' })
  })

  it('counts what a subagent did, and says when it went off on its own', () => {
    expect(summarise(called('Agent', result({ stats: { toolUses: 12 } })))).toEqual({
      kind: 'agent',
      toolUses: 12,
      background: false
    })
    expect(summarise(called('Task', result({ stats: { background: true } })))).toEqual({
      kind: 'agent',
      toolUses: null,
      background: true
    })
  })

  it('leaves an edit and a task list to what the row draws', () => {
    expect(summarise(called('Edit', result()))).toEqual({ kind: 'none' })
    expect(summarise(called('TodoWrite', result()))).toEqual({ kind: 'none' })
  })

  it('shows the output of an MCP tool or an unknown one', () => {
    expect(summarise(called('mcp__x__y', result({ content: 'ok' })))).toMatchObject({
      kind: 'output',
      head: ['ok']
    })
    expect(summarise(called('NotebookEdit', result({ content: 'Updated cell' })))).toEqual({
      kind: 'line',
      text: 'Updated cell'
    })
  })
})

describe('a subagent’s report', () => {
  it('is its own words when they were kept', () => {
    expect(agentReport(result({ report: 'All clear.', content: 'All clear.\nagentId: a-1' }))).toBe(
      'All clear.'
    )
  })

  // Recorded before the report had a field of its own: the trailer the CLI
  // appends for the model is taken off.
  it('is the result without the CLI’s trailer, for an older conversation', () => {
    const content =
      'Found it.\nagentId: a52c (internal ID - do not mention)\n<usage><subagent_tokens>9</subagent_tokens></usage>'

    expect(agentReport(result({ content }))).toBe('Found it.')
  })
})

describe('an output without the harness’s additions', () => {
  it('keeps everything the tool itself said', () => {
    expect(cleanOutput('a\nb\n\n')).toBe('a\nb')
  })
})
