import type { AgentEvent, ChangeContext } from '@core/events.js'
import { type QuestionAnswer, readQuestions } from '@core/questions.js'
import type { ChatEntry } from '@core/transcript.js'

import { type Change, readChange } from './changeSummary.js'
import { readPlan, readWorktreeMove } from './toolSummary.js'

export type ToolResult = Extract<AgentEvent, { type: 'tool_result' }>
type ToolUse = Extract<AgentEvent, { type: 'tool_use' }>

/**
 * One tool call with everything that came back for it, as one row draws it.
 *
 * The call, its result and the lines an edit landed among arrive as separate
 * events — the result after the tool ran, the context after a file read the
 * event handler could not wait for — so they sit apart in the log and are
 * paired here by the call's id.
 */
export interface ToolCall {
  readonly toolUseId: string
  readonly name: string
  readonly input: unknown
  /** The wire id of the message that made the call, for a retraction to name. */
  readonly uuid: string | undefined
  /** Null until the tool answers — and for good, if the turn ended first. */
  readonly result: ToolResult | null
  /** What the call did to a file, when it was an edit or a write. */
  readonly change: Change | null
  /** The lines the edit landed among, when they were recorded. */
  readonly context: ChangeContext | null
  /**
   * Whether the turn the call belonged to is over.
   *
   * A call with no result in a finished turn was cut off — an interrupt, a
   * crash — and must not spin for ever as though it were still running.
   */
  readonly settled: boolean
  /** A subagent's own work, when the call started one: blocks of the same kind. */
  readonly steps: readonly LogBlock[] | null
}

/**
 * A stretch of the log: one entry as it is, or one tool call with its answer.
 *
 * `at` is the position of the entry the block began at. The log only grows
 * between rewinds, so a position names one block for as long as it exists —
 * and because a result is folded into the call that came first, the answer
 * arriving never moves a block, which is what keeps a row open across it.
 */
export type LogBlock =
  | { readonly kind: 'entry'; readonly at: number; readonly entry: ChatEntry }
  | { readonly kind: 'tool'; readonly at: number; readonly call: ToolCall }

/**
 * What an edit changed, read once per call.
 *
 * Reading it runs a line diff, and the blocks are rebuilt every time the log
 * grows: without this an `Edit` replacing a 400-line block was diffed again for
 * every entry appended after it. Keyed by the event object, which the log keeps
 * as it is from one append to the next.
 */
const changes = new WeakMap<ToolUse, Change | null>()

function changeOf(event: ToolUse): Change | null {
  const known = changes.get(event)
  if (known !== undefined) return known

  const read = readChange(event.name, event.input)
  changes.set(event, read)
  return read
}

/**
 * Whether a call is drawn as a tool row.
 *
 * Not the three that put something of their own in front of the reader: a
 * plan is the substance of the turn and gets its frame, a question is drawn by
 * the card that answers it, and a move into another worktree is a line in the
 * warning colour. Those stay entries, with their results beside them.
 */
function isToolRow(event: ToolUse): boolean {
  return (
    readPlan(event.name, event.input) === null &&
    readQuestions(event.name, event.input) === null &&
    readWorktreeMove(event.name, event.input) === null
  )
}

/**
 * The call each `tool_use` was last built into.
 *
 * The blocks are rebuilt every time the log grows, and a row is memoised on its
 * call: a fresh object for every call on every append re-rendered the whole log
 * to add one line to it. A call whose parts are all the same objects as last
 * time is handed back as it was, so only the rows that changed draw again.
 */
const built = new WeakMap<ToolUse, ToolCall>()

function sameSteps(a: readonly LogBlock[] | null, b: readonly LogBlock[] | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.length === b.length &&
    a.every((block, index) => {
      const other = b[index]
      if (other?.kind !== block.kind || other.at !== block.at) return false
      return block.kind === 'tool'
        ? other.kind === 'tool' && other.call === block.call
        : other.kind === 'entry' && other.entry === block.entry
    })
  )
}

/** The call as last built when nothing about it moved; the fresh one otherwise. */
function reuse(event: ToolUse, fresh: ToolCall): ToolCall {
  const last = built.get(event)
  if (
    // A result is never undefined, so this also says `last` is there.
    last?.result === fresh.result &&
    last.context === fresh.context &&
    last.settled === fresh.settled &&
    sameSteps(last.steps, fresh.steps)
  ) {
    return last
  }

  built.set(event, fresh)
  return fresh
}

/** The id an entry hangs under, when it is a subagent's. */
function parentOf(entry: ChatEntry): string | undefined {
  return entry.role === 'agent' && 'parentToolUseId' in entry.event
    ? entry.event.parentToolUseId
    : undefined
}

/**
 * The log as the rows that draw it.
 *
 * Every call is its own row, with its answer folded into it — the shape of
 * Claude Code's own transcript, where a run of greps reads as the greps it was
 * rather than as a count to be opened. What a subagent did goes inside the
 * call that started it, built by this same function, so its rows are the same
 * rows a level down. Only an entry whose parent call is actually in the log is
 * nested: one whose call is not there (a conversation cleared halfway) stays
 * where it is rather than vanishing.
 */
export function buildBlocks(entries: readonly ChatEntry[]): LogBlock[] {
  const results = new Map<string, ToolResult>()
  const contexts = new Map<string, ChangeContext>()
  const rows = new Set<string>()
  let lastResult = -1

  for (const [index, entry] of entries.entries()) {
    if (entry.role !== 'agent') continue
    const { event } = entry

    if (event.type === 'tool_use' && isToolRow(event)) rows.add(event.toolUseId)
    else if (event.type === 'tool_result') results.set(event.toolUseId, event)
    else if (event.type === 'change_context') contexts.set(event.toolUseId, event.context)
    else if (event.type === 'result') lastResult = index
  }

  const children = new Map<string, { index: number; entry: ChatEntry }[]>()
  const top: { index: number; entry: ChatEntry }[] = []

  for (const [index, entry] of entries.entries()) {
    const parent = parentOf(entry)
    const under = parent === undefined ? undefined : children.get(parent)

    if (parent !== undefined && rows.has(parent)) {
      if (under === undefined) children.set(parent, [{ index, entry }])
      else under.push({ index, entry })
    } else {
      top.push({ index, entry })
    }
  }

  const blocksFor = (list: readonly { index: number; entry: ChatEntry }[]): LogBlock[] =>
    list.flatMap(({ index, entry }): LogBlock[] => {
      if (entry.role === 'user') return [{ kind: 'entry', at: index, entry }]
      const { event } = entry

      if (event.type === 'tool_use' && rows.has(event.toolUseId)) {
        const nested = children.get(event.toolUseId)
        const call = reuse(event, {
          toolUseId: event.toolUseId,
          name: event.name,
          input: event.input,
          uuid: event.uuid,
          result: results.get(event.toolUseId) ?? null,
          change: changeOf(event),
          context: contexts.get(event.toolUseId) ?? null,
          settled: index < lastResult,
          steps: nested === undefined ? null : blocksFor(nested)
        })
        return [{ kind: 'tool', at: index, call }]
      }

      // Drawn inside the row of the call they answer.
      if (
        (event.type === 'tool_result' || event.type === 'change_context') &&
        rows.has(event.toolUseId)
      ) {
        return []
      }

      return [{ kind: 'entry', at: index, entry }]
    })

  /*
   * A footer at the head of the log is stray.
   *
   * A `result` closes the turn above it, and at the head of the log there is no
   * turn above it to close. `/clear` is what leaves one there: the transcript
   * goes the moment the reset arrives and the command's own result lands a tick
   * later, so an emptied conversation opened on a single row reading
   * `0.1s · 0 tokens` — three facts about a turn nobody can see.
   *
   * `service.ts` no longer writes that entry, so new conversations never carry
   * one. This is what the ones already on disk need.
   */
  const first = top.findIndex(
    ({ entry }) => !(entry.role === 'agent' && entry.event.type === 'result')
  )

  return blocksFor(first === -1 ? [] : top.slice(first))
}

/**
 * The wire ids the agent has taken back.
 *
 * Gathered rather than applied by filtering. The log only grows between rewinds
 * and its React keys are positions in it, so dropping an entry would renumber
 * every row below and remount the rest of the conversation — and the reader would lose
 * the fact that the agent started down a road and abandoned it, which is the
 * one thing the retraction is evidence of.
 *
 * Ids nothing matches are ordinary: the CLI names what it evicted, and some of
 * it may never have reached this transcript.
 */
export function retractedUuids(entries: readonly ChatEntry[]): ReadonlySet<string> {
  const taken = new Set<string>()

  for (const entry of entries) {
    if (entry.role === 'agent' && entry.event.type === 'retracted') {
      for (const uuid of entry.event.uuids) taken.add(uuid)
    }
  }

  return taken
}

/**
 * What the user chose, by the request that asked.
 *
 * Gathered in one pass: the answer is recorded as its own event, so it sits
 * further down the log than the question whose card draws it.
 */
export function answersByRequest(
  entries: readonly ChatEntry[]
): Map<string, readonly QuestionAnswer[]> {
  const found = new Map<string, readonly QuestionAnswer[]>()

  for (const entry of entries) {
    if (entry.role === 'agent' && entry.event.type === 'question_answered') {
      found.set(entry.event.requestId, entry.event.answers)
    }
  }

  return found
}

/**
 * What became of each MCP server's question, by the request that asked.
 *
 * The same walk and the same reason: the outcome is its own event and sits
 * further down the log than the card that draws it.
 */
export function elicitationsByRequest(
  entries: readonly ChatEntry[]
): Map<string, 'accept' | 'decline' | 'cancel'> {
  const found = new Map<string, 'accept' | 'decline' | 'cancel'>()

  for (const entry of entries) {
    if (entry.role === 'agent' && entry.event.type === 'elicitation_answered') {
      found.set(entry.event.requestId, entry.event.action)
    }
  }

  return found
}

/**
 * Which calls were the agent handing a plan over.
 *
 * Gathered because the result of one has to be told apart from a real failure,
 * and a result carries only the id of the call it answers. A plan sent back for
 * another round is recorded as a failed `ExitPlanMode` whose content is what
 * the person typed into the dialog — true of the call, and misleading about the
 * moment, since nothing went wrong.
 */
export function planCalls(entries: readonly ChatEntry[]): ReadonlySet<string> {
  const found = new Set<string>()

  for (const entry of entries) {
    if (
      entry.role === 'agent' &&
      entry.event.type === 'tool_use' &&
      readPlan(entry.event.name, entry.event.input) !== null
    ) {
      found.add(entry.event.toolUseId)
    }
  }

  return found
}
