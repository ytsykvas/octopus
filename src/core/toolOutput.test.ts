import { describe, expect, it } from 'vitest'

import { readToolOutput } from './toolOutput.js'

/*
 * Shapes as `sdk-tools.d.ts` declares them (SDK 0.3.299). Each test carries
 * only the fields the reader looks at, plus one it ignores, so a test passing
 * says the reader picks its facts out rather than demanding the whole shape.
 */
describe('reading a tool’s structured output', () => {
  it('counts the lines a Read returned', () => {
    const read = { type: 'text', file: { filePath: '/w/a.ts', numLines: 120, totalLines: 400 } }

    expect(readToolOutput(read)).toEqual({ stats: { lines: 120 } })
  })

  it('counts the files a Glob found', () => {
    expect(readToolOutput({ numFiles: 4, filenames: [], durationMs: 3 })).toEqual({
      stats: { files: 4 }
    })
  })

  it('counts what a Grep found, in whichever mode it ran', () => {
    expect(readToolOutput({ mode: 'content', numFiles: 2, numLines: 9, filenames: [] })).toEqual({
      stats: { files: 2, lines: 9 }
    })
    expect(readToolOutput({ mode: 'count', numFiles: 2, numMatches: 17, filenames: [] })).toEqual({
      stats: { files: 2, matches: 17 }
    })
  })

  // The text of a result carries the CLI's trailer — the agent's id and a
  // usage block meant for the model. The structured output does not.
  it('takes a subagent’s report from its own words, without the trailer', () => {
    const done = {
      status: 'completed',
      agentId: 'a-1',
      content: [
        { type: 'text', text: 'Found it.' },
        { type: 'image' },
        { type: 'text', text: 'It is in core.' }
      ],
      totalToolUseCount: 3,
      totalTokens: 900,
      totalDurationMs: 4100
    }

    expect(readToolOutput(done)).toEqual({
      report: 'Found it.\n\nIt is in core.',
      stats: { toolUses: 3, tokens: 900, durationMs: 4100 }
    })
  })

  it('has no report for a subagent that said nothing', () => {
    const silent = {
      status: 'completed',
      content: [],
      totalToolUseCount: 0,
      totalTokens: 10,
      totalDurationMs: 5
    }

    expect(readToolOutput(silent)).not.toHaveProperty('report')
  })

  it('marks a subagent sent away to run on its own', () => {
    expect(readToolOutput({ status: 'async_launched', agentId: 'a-1' })).toEqual({
      stats: { background: true }
    })
    expect(readToolOutput({ status: 'remote_launched' })).toEqual({ stats: { background: true } })
  })

  it('reads the id of a task a call made', () => {
    expect(readToolOutput({ task: { id: '7', subject: 'Alpha' } })).toEqual({ taskId: '7' })
  })

  // Anything unrecognised costs a summary, never a parse failure.
  it('reads nothing from a shape it does not know', () => {
    expect(readToolOutput(undefined)).toEqual({})
    expect(readToolOutput('text')).toEqual({})
    expect(readToolOutput({ stdout: 'hi', stderr: '' })).toEqual({})
    expect(readToolOutput({ type: 'image', file: { base64: '' } })).toEqual({})
  })
})
