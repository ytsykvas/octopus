import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '@core/events.js'
import type { ChatEntry } from '@core/transcript.js'

import { groupToolRuns, toolCount } from './toolRuns.js'

const AT = '2026-08-13T09:00:00.000Z'

const agent = (event: AgentEvent): ChatEntry => ({ role: 'agent', at: AT, event })

/**
 * A tool call shaped the way the stream sends one.
 *
 * The name decides the input, because for `Edit` and `Write` the log reads the
 * text out of the arguments to draw the change. A fixture without it folds like
 * a grep — which is the opposite of the rule this file exists to pin down, and
 * is what these tests asserted for a while.
 */
const call = (name: string): ChatEntry =>
  agent({
    type: 'tool_use',
    toolUseId: `c-${name}`,
    name,
    input: TOOL_INPUT[name] ?? { file_path: '/a.ts' }
  })

const TOOL_INPUT: Record<string, unknown> = {
  Edit: { file_path: '/a.ts', old_string: 'one', new_string: 'two' },
  Write: { file_path: '/a.ts', content: 'all of it' }
}

const result = (ok: boolean): ChatEntry =>
  agent({ type: 'tool_result', toolUseId: 'c-1', ok, content: ok ? 'fine' : 'no such file' })

const said = (text: string): ChatEntry => agent({ type: 'text', text })

describe('folding a run of tool calls', () => {
  it('leaves a log with no tool calls exactly as it was', () => {
    const entries = [said('first'), said('second')]

    expect(groupToolRuns(entries).map((block) => block.kind)).toEqual(['entry', 'entry'])
  })

  // "1 step" that has to be opened to say `Read en.ts` is more work than the
  // row it replaced.
  it('leaves a lone call as itself', () => {
    const blocks = groupToolRuns([call('Read'), said('done')])

    expect(blocks.map((block) => block.kind)).toEqual(['entry', 'entry'])
  })

  it('folds two or more into one block', () => {
    const blocks = groupToolRuns([call('Grep'), call('Grep'), call('Read')])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.kind).toBe('tools')
  })

  /*
   * A successful result sits between almost every pair of calls and draws
   * nothing. Treated as a break, a run of twenty greps became twenty runs of
   * one — which is the state this was written to fix, so it is the case worth
   * asserting.
   */
  it('is not broken by the results that draw nothing', () => {
    const entries = [call('Grep'), result(true), call('Grep'), result(true), call('Grep')]

    const blocks = groupToolRuns(entries)

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.kind === 'tools' && toolCount(blocks[0].entries)).toBe(3)
  })

  // A failure is a finding, not working out: it stays where it happened, with
  // the work either side of it.
  it('is broken by a failure, and by anything the agent said', () => {
    const entries = [call('Grep'), call('Grep'), result(false), call('Read'), call('Read')]

    expect(groupToolRuns(entries).map((block) => block.kind)).toEqual(['tools', 'entry', 'tools'])
  })

  // Two edits either side of nothing are still two changes: the run is what
  // folds, and a change is never part of one.
  it('folds nothing away when the calls are edits', () => {
    const entries = [call('Grep'), call('Grep'), result(false), call('Edit'), call('Write')]

    expect(groupToolRuns(entries).map((block) => block.kind)).toEqual([
      'tools',
      'entry',
      'change',
      'change'
    ])
  })

  /*
   * What the agent looked at folds; what it changed does not.
   *
   * A grep is how the answer was found and an edit is the answer, so folding
   * both away left a log that could say "twenty-five steps" and never what any
   * of them did to a file.
   */
  it('never folds away a change to a file', () => {
    const edit = agent({
      type: 'tool_use',
      toolUseId: 'c-edit',
      name: 'Edit',
      input: { file_path: '/a.ts', old_string: 'one', new_string: 'two' }
    })

    const blocks = groupToolRuns([call('Grep'), call('Grep'), edit, call('Read'), call('Read')])

    expect(blocks.map((block) => block.kind)).toEqual(['tools', 'change', 'tools'])
  })

  // Sent while the agent was working, so it lands between two tool calls. It is
  // the one thing on screen the reader put there, and it stays where they put
  // it rather than being folded into a count.
  it('is broken by something the user said mid-run', () => {
    const said: ChatEntry = { role: 'user', at: AT, text: 'actually, stop' }

    expect(groupToolRuns([call('Grep'), call('Grep'), said, call('Read'), call('Read')])).toEqual([
      expect.objectContaining({ kind: 'tools' }),
      expect.objectContaining({ kind: 'entry', entry: said }),
      expect.objectContaining({ kind: 'tools' })
    ])
  })

  it('counts the calls rather than the results', () => {
    expect(toolCount([call('Grep'), result(true), call('Read'), result(true)])).toBe(2)
  })

  /*
   * A plan arrives as a tool call and is the substance of the turn — the one
   * thing that must never be folded away into a count.
   */
  it('never folds a plan into the working out', () => {
    const plan = agent({
      type: 'tool_use',
      toolUseId: 'c-plan',
      name: 'ExitPlanMode',
      input: { plan: '# Do the thing' }
    })

    expect(groupToolRuns([call('Grep'), call('Grep'), plan]).map((block) => block.kind)).toEqual([
      'tools',
      'entry'
    ])
  })

  // The position is the key React draws with, and the log is append-only, so a
  // block has to be identified by where it starts.
  it('remembers where each block began', () => {
    const blocks = groupToolRuns([said('hello'), call('Grep'), call('Grep'), said('done')])

    expect(blocks.map((block) => block.at)).toEqual([0, 1, 3])
  })
})

describe('the lines a change landed among', () => {
  const edit = (id: string): ChatEntry =>
    agent({
      type: 'tool_use',
      toolUseId: id,
      name: 'Edit',
      input: { file_path: '/a.ts', old_string: 'one', new_string: 'two' }
    })

  const context = (id: string, startLine: number): ChatEntry =>
    agent({
      type: 'change_context',
      toolUseId: id,
      context: { before: ['before'], after: ['after'], startLine }
    })

  /*
   * The context arrives as its own event, after the edit — reading a file is
   * not something the event handler can wait for — so it sits further down the
   * log than the call it describes. Pairing is by id, never by position.
   */
  it('reaches the change it belongs to', () => {
    const blocks = groupToolRuns([edit('c-1'), context('c-1', 42)])

    expect(blocks[0]?.kind === 'change' && blocks[0].context?.startLine).toBe(42)
  })

  it('never reaches a change it does not belong to', () => {
    const blocks = groupToolRuns([edit('c-1'), edit('c-2'), context('c-2', 7)])

    expect(blocks[0]?.kind === 'change' && blocks[0].context).toBeNull()
    expect(blocks[1]?.kind === 'change' && blocks[1].context?.startLine).toBe(7)
  })

  /*
   * The context is read from disk after the edit finishes, so it is emitted
   * whenever that read returns — by which time the agent may already have run
   * several more tools. It therefore lands in the middle of a later run.
   *
   * It draws nothing, so it must be transparent there: counted as a break, a
   * run of twenty greps becomes two folds with an invisible entry between them,
   * for no reason the reader can see.
   */
  it('does not split a fold when it arrives late', () => {
    const blocks = groupToolRuns([
      call('Grep'),
      context('c-earlier', 3),
      call('Grep'),
      call('Grep')
    ])

    expect(blocks.map((block) => block.kind)).toEqual(['tools'])
    expect(blocks[0]?.kind === 'tools' && toolCount(blocks[0].entries)).toBe(3)
  })

  // An older transcript, a file since changed, a write: the change is drawn
  // without it rather than not at all.
  it('leaves a change without context alone', () => {
    const blocks = groupToolRuns([edit('c-1')])

    expect(blocks[0]?.kind === 'change' && blocks[0].context).toBeNull()
  })
})

/*
 * Reported from a running app: `/clear` emptied the pane and left one row at
 * the top of it reading `0.1s · 0 tokens`.
 *
 * A footer closes the turn above it, and at the head of the log there is no
 * turn above it to close. `service.ts` no longer writes that entry, so a
 * conversation cleared from now on never carries one — this is what the
 * transcripts already on disk need, and a clear is not a way to be rid of it
 * because clearing is what leaves it.
 */
describe('a footer with no turn above it', () => {
  const footer = (): ChatEntry =>
    agent({
      type: 'result',
      ok: true,
      costUsd: 0,
      durationMs: 75,
      inputTokens: 0,
      outputTokens: 0,
      terminalReason: null
    })

  it('draws nothing when it opens the log', () => {
    expect(groupToolRuns([footer()])).toEqual([])
  })

  it('leaves the conversation that follows it untouched', () => {
    const blocks = groupToolRuns([footer(), said('go on'), call('Grep'), call('Grep')])

    expect(blocks.map((block) => block.kind)).toEqual(['entry', 'tools'])
  })

  // Position is the block's key for as long as it exists, and the log is
  // append-only. Skipping rather than filtering is what keeps the surviving
  // entries on the indices they had.
  it('does not move the entries after it', () => {
    const blocks = groupToolRuns([footer(), said('go on')])

    expect(blocks.map((block) => block.at)).toEqual([1])
  })

  // Everywhere else it closes the turn it belongs to, which is the whole reason
  // the row exists.
  it('is drawn wherever there is a turn above it', () => {
    const blocks = groupToolRuns([said('done'), footer()])

    expect(blocks.map((block) => block.kind)).toEqual(['entry', 'entry'])
  })
})
