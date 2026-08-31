import type { ChangeContext } from '@core/events.js'
import { type QuestionAnswer, readQuestions } from '@core/questions.js'
import type { ChatEntry } from '@core/transcript.js'

import { type Change, readChange } from './changeSummary.js'
import { readPlan } from './toolSummary.js'

/** A stretch of the log, either one entry as it is or a run of tool calls. */
export type LogBlock =
  | { readonly kind: 'entry'; readonly at: number; readonly entry: ChatEntry }
  | { readonly kind: 'tools'; readonly at: number; readonly entries: readonly ChatEntry[] }
  | {
      readonly kind: 'change'
      readonly at: number
      readonly name: string
      readonly change: Change
      /** The lines it landed among, when they were recorded. */
      readonly context: ChangeContext | null
    }

/**
 * The lines recorded around each change, by the call they belong to.
 *
 * Gathered in one pass before the blocks are built, because the context arrives
 * as its own event after the edit — reading a file is not something the event
 * handler can wait for — so it sits further down the log than the call it
 * describes.
 */
function contextsById(entries: readonly ChatEntry[]): Map<string, ChangeContext> {
  const found = new Map<string, ChangeContext>()

  for (const entry of entries) {
    if (entry.role === 'agent' && entry.event.type === 'change_context') {
      found.set(entry.event.toolUseId, entry.event.context)
    }
  }

  return found
}

/**
 * What the user chose, by the request that asked.
 *
 * Gathered in one pass for the same reason as the contexts above: the answer is
 * recorded as its own event, so it sits further down the log than the question
 * whose card draws it.
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
 * A tool call that is working out rather than a result.
 *
 * What the agent looked at folds; what it changed does not. A grep is how the
 * answer was found and an edit is the answer, so folding both away left a log
 * that could say "twenty-five steps" and never what any of them did to a file.
 *
 * Neither are the two tools that exist to put something in front of the user: a
 * plan is the substance of the whole turn, and a question is drawn by the card
 * that answers it. Counting either as a step would put a number on the fold
 * that no row inside it accounts for.
 */
function isToolRow(entry: ChatEntry, change: Change | null = changeIn(entry)): boolean {
  return (
    entry.role === 'agent' &&
    entry.event.type === 'tool_use' &&
    readPlan(entry.event.name, entry.event.input) === null &&
    readQuestions(entry.event.name, entry.event.input) === null &&
    change === null
  )
}

/**
 * What an entry changed, when it is a tool call at all.
 *
 * Taken as a parameter above rather than read twice: reading it runs a line
 * diff, and the walk below needs the same answer to decide whether the entry is
 * an ordinary tool row *and* to build the block if it is not. `toolCount` has
 * no such answer to hand, which is what the default is for.
 */
function changeIn(entry: ChatEntry): Change | null {
  return entry.role === 'agent' && entry.event.type === 'tool_use'
    ? readChange(entry.event.name, entry.event.input)
    : null
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

/**
 * An entry that draws nothing at all.
 *
 * Counted as part of a run rather than as something between two of them,
 * because a break the reader cannot see is a fold that comes apart for no
 * visible reason:
 *
 * - a **successful result** sits between almost every pair of tool calls, so
 *   treating it as a break left a run of twenty greps as twenty runs of one;
 * - a **change's context** is read from disk after its edit finishes, and
 *   emitted whenever that read returns — by which time the agent may be several
 *   tools further on, which lands it in the middle of a later run.
 * - **the call that asks a question** is drawn by the card that answers it,
 *   which arrives separately, so the call itself has nothing to show.
 */
function drawsNothing(entry: ChatEntry): boolean {
  if (entry.role !== 'agent') return false

  if (entry.event.type === 'tool_use') {
    return readQuestions(entry.event.name, entry.event.input) !== null
  }

  return (
    (entry.event.type === 'tool_result' && entry.event.ok) || entry.event.type === 'change_context'
  )
}

/**
 * How many tool calls a run holds — what its summary counts.
 *
 * The silent results are in the run but are not steps; counting them would
 * roughly double every figure shown.
 */
export function toolCount(entries: readonly ChatEntry[]): number {
  return entries.filter((entry) => isToolRow(entry)).length
}

/**
 * Folds runs of tool calls into single blocks.
 *
 * A turn is mostly tool calls — a rename went through fifty-nine greps and
 * edits — and one line each buried the two things worth reading, the prose and
 * what the agent actually changed. Folded, the run is a count that opens.
 *
 * A single call is left alone: "1 step" that has to be opened to say `Read
 * en.ts` is more work than the row it replaced.
 *
 * Anything else breaks a run, which is the point — prose, a failure, a
 * permission card and the turn's own footer all stay where they happened,
 * with the work that led to them either side.
 */
export function groupToolRuns(entries: readonly ChatEntry[]): LogBlock[] {
  const contexts = contextsById(entries)
  const blocks: LogBlock[] = []
  let run: ChatEntry[] = []
  let runAt = 0

  const flush = (): void => {
    // Destructured rather than indexed: with `noUncheckedIndexedAccess` an
    // indexed read is `T | undefined`, and the emptiness check above is not
    // something the compiler can carry down here.
    const [first, ...rest] = run
    if (first === undefined) return

    // Position is the key later on, and the log is append-only, so the first
    // entry's index identifies the block for as long as it exists.
    //
    // A run of one is left as itself: "1 step" that has to be opened to say
    // `Read en.ts` is more work than the row it replaced. Any silent result
    // behind it draws nothing, so dropping `rest` loses nothing on screen.
    blocks.push(
      toolCount(run) > 1
        ? { kind: 'tools', at: runAt, entries: [first, ...rest] }
        : { kind: 'entry', at: runAt, entry: first }
    )

    run = []
  }

  /*
   * Whether nothing has been drawn yet, which is what makes a footer stray.
   *
   * A `result` closes the turn above it, and at the head of the log there is no
   * turn above it to close. `/clear` is what leaves one there: the transcript
   * goes the moment the reset arrives and the command's own result lands a tick
   * later, so an emptied conversation opened on a single row reading
   * `0.1s · 0 tokens` — three facts about a turn nobody can see.
   *
   * `service.ts` no longer writes that entry, so new conversations never carry
   * one. This is what the ones already on disk need, and it costs a flag.
   */
  let nothingDrawnYet = true

  for (const [index, entry] of entries.entries()) {
    if (nothingDrawnYet) {
      if (entry.role === 'agent' && entry.event.type === 'result') continue
      nothingDrawnYet = false
    }

    const change = changeIn(entry)

    if (isToolRow(entry, change) || (run.length > 0 && drawsNothing(entry))) {
      if (run.length === 0) runAt = index
      run.push(entry)
      continue
    }

    flush()

    if (change && entry.role === 'agent' && entry.event.type === 'tool_use') {
      blocks.push({
        kind: 'change',
        at: index,
        name: entry.event.name,
        change,
        context: contexts.get(entry.event.toolUseId) ?? null
      })
      continue
    }

    blocks.push({ kind: 'entry', at: index, entry })
  }

  flush()
  return blocks
}
