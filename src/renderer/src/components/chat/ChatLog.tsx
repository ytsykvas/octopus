import {
  Check,
  ChevronRight,
  Archive,
  Eraser,
  Map,
  Pencil,
  Play,
  Repeat,
  ShieldAlert,
  TriangleAlert,
  Wrench
} from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { type AgentEvent, type ChangeContext, type TurnOutcome, turnOutcome } from '@core/events.js'
import { type QuestionAnswer, readQuestions } from '@core/questions.js'
import type { PermissionAnswer } from '@core/service.js'
import type { ChatEntry } from '@core/transcript.js'

import { Button } from '../Button.js'
import { named } from '../diff/invisible.js'
import { shown } from '../diff/shown.js'
import type { Streaming } from '../../hooks/useChat.js'
import { formatTokens } from './format.js'
import type { Change, ChangeLine } from './changeSummary.js'
import { Markdown } from './Markdown.js'
import { QuestionCard } from './QuestionCard.js'
import { answersByRequest, groupToolRuns, planCalls, toolCount, toolRunRows } from './toolRuns.js'
import { readFailure } from './toolFailure.js'
import { describeToolInput, readPlan } from './toolSummary.js'
import { UsageCard } from './UsageCard.js'

/**
 * What each ending is called on screen.
 *
 * A map rather than a switch, so adding an outcome to the union is a compile
 * error here rather than a turn that quietly closes with nothing said.
 */
const OUTCOME_LABELS: Record<
  Exclude<TurnOutcome, 'completed'>,
  | 'chat.endedInterrupted'
  | 'chat.endedLimit'
  | 'chat.endedTooLong'
  | 'chat.endedBlocked'
  | 'chat.endedFailed'
> = {
  interrupted: 'chat.endedInterrupted',
  limit: 'chat.endedLimit',
  tooLong: 'chat.endedTooLong',
  blocked: 'chat.endedBlocked',
  failed: 'chat.endedFailed'
}

interface ChatLogProps {
  readonly entries: readonly ChatEntry[]
  readonly streaming: Streaming
  readonly busy: boolean
  readonly pendingRequestId: string | null
  readonly onAnswer: (requestId: string, answer: PermissionAnswer) => void
  /** Answers the agent's own questions, which is not a permission. */
  readonly onAnswerQuestions: (requestId: string, answers: readonly QuestionAnswer[]) => void
  /** Asks for a plan already in the log to be carried out. */
  readonly onExecutePlan: (plan: string) => void
}

/**
 * The conversation itself.
 *
 * One row per event rather than one bubble per turn: a turn is mostly tool
 * calls, and folding them into the prose hides the part that says what the
 * agent actually did to the working tree.
 */
export function ChatLog({
  entries,
  streaming,
  busy,
  pendingRequestId,
  onAnswer,
  onAnswerQuestions,
  onExecutePlan
}: ChatLogProps): React.JSX.Element {
  const { t } = useTranslation()
  const streamingAnything = streaming.text !== '' || streaming.thinking !== ''

  /*
   * Both walks are held against `entries` rather than run on every render.
   *
   * A `text_delta` re-renders this pane, and grouping re-runs the line diff for
   * every edit in the conversation: an `Edit` replacing a 400-line block is a
   * 160,000-cell table, rebuilt on every chunk of the answer being typed out.
   * The streamed text is its own state, so keyed this way the work happens when
   * the log actually grows and not while it is being read.
   */
  // Gathered once for the whole log: an answer is recorded as its own event, so
  // it sits further down than the question whose card draws it.
  const answers = useMemo(() => answersByRequest(entries), [entries])
  const blocks = useMemo(() => groupToolRuns(entries), [entries])
  // Which calls handed over a plan, so that a plan sent back for another round
  // is not drawn as something that broke.
  const plans = useMemo(() => planCalls(entries), [entries])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-5">
      {/* The position is the key because the log is append-only: nothing is
          ever reordered or removed, so where a block starts identifies it for
          its whole life. Two identical rows have nothing else to tell apart. */}
      {blocks.map((block) => {
        if (block.kind === 'tools') return <ToolRun key={block.at} entries={block.entries} />

        if (block.kind === 'change') {
          return (
            <ChangeBlock
              key={block.at}
              name={block.name}
              change={block.change}
              context={block.context}
            />
          )
        }

        return (
          <EntryRow
            key={block.at}
            entry={block.entry}
            plans={plans}
            busy={busy}
            pendingRequestId={pendingRequestId}
            answers={answers}
            onAnswer={onAnswer}
            onAnswerQuestions={onAnswerQuestions}
            onExecutePlan={onExecutePlan}
          />
        )
      })}

      {streaming.thinking !== '' && <Thinking text={streaming.thinking} />}
      {streaming.text !== '' && <Prose text={streaming.text} />}

      {/* Only while nothing else is moving — with text arriving the answer is
          visibly under way and a second indicator is just noise. */}
      {busy && !streamingAnything && (
        <p className="text-ink-faint flex items-center gap-2">
          <span className="bg-ink-faint inline-block size-1.5 animate-pulse rounded-full" />
          {t('chat.working')}
        </p>
      )}
    </div>
  )
}

/** What every row needs to answer whatever the agent is waiting on. */
interface AnswerProps {
  busy: boolean
  pendingRequestId: string | null
  /** What was chosen, by request, for questions read back from the transcript. */
  answers: Map<string, readonly QuestionAnswer[]>
  onAnswer: (requestId: string, answer: PermissionAnswer) => void
  onAnswerQuestions: (requestId: string, answers: readonly QuestionAnswer[]) => void
  onExecutePlan: (plan: string) => void
}

/** Everything a row needs on top of the entry itself. */
interface RowProps extends AnswerProps {
  /** The calls that handed over a plan, by id. See `planCalls`. */
  plans: ReadonlySet<string>
}

function EntryRow({
  entry,
  ...answering
}: { entry: ChatEntry } & RowProps): React.JSX.Element | null {
  if (entry.role === 'user') return <UserMessage text={entry.text} />

  return <AgentRow event={entry.event} {...answering} />
}

function AgentRow({
  event,
  plans,
  busy,
  pendingRequestId,
  answers,
  onAnswer,
  onAnswerQuestions,
  onExecutePlan
}: { event: AgentEvent } & RowProps): React.JSX.Element | null {
  switch (event.type) {
    case 'text':
      return <Prose text={event.text} />

    case 'thinking':
      // Not the same guard as the one in the mapping, which stops new ones
      // being written: transcripts recorded before it already hold empty
      // reasoning, and those are read back on every launch.
      return event.text.trim() === '' ? null : <Thinking text={event.text} />

    case 'tool_use': {
      // The plan branch lives here rather than inside the row, because a folded
      // run never holds one — `groupToolRuns` keeps plans out — and threading
      // the buttons through a component that cannot draw them was noise.
      const plan = readPlan(event.name, event.input)
      if (plan !== null) return <Plan text={plan} busy={busy} onExecute={onExecutePlan} />

      // The call that asks a question says nothing the card beside it does not
      // say better. Drawn as a tool row it was the same question twice: once as
      // a name with no readable arguments, and once as the thing to answer.
      if (readQuestions(event.name, event.input) !== null) return null

      // A call that changed a file never arrives here: `groupToolRuns` pulls it
      // out into a block of its own, so that it can carry the context recorded
      // for it — which arrives later in the log than the call does.
      return <ToolCall name={event.name} input={event.input} />
    }

    case 'tool_result':
      if (event.ok) return null

      // A plan handed back is not a failure, however the SDK had to record it.
      return plans.has(event.toolUseId) ? (
        <PlanNote content={event.content} />
      ) : (
        <ToolFailure content={event.content} />
      )

    case 'permission_request': {
      // A plan's request has nothing left to say here. The plan itself is
      // already above, drawn from the `ExitPlanMode` call that carried it, and
      // the question about it is asked in a dialog — a card would be the same
      // text a second time with buttons that duplicate the dialog's.
      if (readPlan(event.toolName, event.input) !== null) return null

      // A question is a permission request in shape only: the user is not being
      // asked whether the agent may act, but what it should do. Its own card,
      // and its own way of answering.
      const asked = readQuestions(event.toolName, event.input)
      if (asked !== null) {
        return (
          <QuestionCard
            questions={asked}
            answerable={event.requestId === pendingRequestId}
            answered={answers.get(event.requestId) ?? null}
            onAnswer={(given) => {
              onAnswerQuestions(event.requestId, given)
            }}
            // Skipping is an ordinary approval: the tool runs with its
            // arguments untouched, and the agent reads that as "nobody
            // answered" — its cue to ask again rather than to guess.
            onSkip={() => {
              onAnswer(event.requestId, 'allow')
            }}
          />
        )
      }

      return (
        <PermissionCard
          toolName={event.toolName}
          input={event.input}
          reason={event.reason ?? null}
          // A request read back from the transcript is history: the session it
          // belonged to answered it long ago, and offering buttons would let
          // the user answer a question nobody is waiting on.
          answerable={event.requestId === pendingRequestId}
          onAnswer={(answer) => {
            onAnswer(event.requestId, answer)
          }}
        />
      )
    }

    case 'result':
      return (
        <TurnFooter
          ok={event.ok}
          durationMs={event.durationMs}
          inputTokens={event.inputTokens}
          outputTokens={event.outputTokens}
          terminalReason={event.terminalReason}
        />
      )

    // The answer to `/usage`, which the service takes off the agent and fills
    // in from the structured reading rather than letting the CLI answer it.
    case 'usage':
      return <UsageCard report={event.report} />

    case 'error':
      return <ErrorRow message={event.message} />

    // Only the reset nobody asked for is drawn. The one the user asked for
    // takes the whole log with it, so there is nothing left for it to sit in.
    case 'conversation_reset':
      return event.cleared ? null : <ResetRow />

    case 'conversation_compacted':
      return <CompactedRow preTokens={event.preTokens} postTokens={event.postTokens} />

    case 'model_refusal_fallback':
      return <RefusalFallbackRow event={event} />

    // Deltas never reach the log — they are drawn from the streaming buffer
    // and replaced by the completed block that follows.
    default:
      return null
  }
}

/**
 * What the user said, left exactly as they typed it.
 *
 * The one place markup stays text. These characters came from the composer, and
 * drawing their asterisks as bold would make the log disagree with what the
 * person wrote — the agent's prose is the model's output to render, this is the
 * user's own words to quote.
 */
function UserMessage({ text }: { text: string }): React.JSX.Element {
  return (
    /*
     * `max-w-full` and `wrap-anywhere` are what keeps a long message inside the
     * column, and both are needed.
     *
     * `self-end` takes the bubble out of the column's stretch and sizes it to
     * its content, so a message with no break opportunity in it — a pasted URL,
     * a line of minified JSON — is laid out at its full single-line width. The
     * overflow goes to the left, because the bubble is aligned to the right
     * edge: the text runs off under the sidebar and the start of every line is
     * what the reader loses.
     *
     * `wrap-anywhere` rather than `break-words`: only `anywhere` counts towards
     * the intrinsic size, so the bubble is allowed to be narrow instead of
     * merely spilling its text once the width is capped.
     */
    <div className="bubble-sent max-w-full self-end rounded-[var(--radius-panel)] border px-3 py-2 whitespace-pre-wrap wrap-anywhere">
      {text}
    </div>
  )
}

/**
 * What the agent said, drawn the way it wrote it.
 *
 * The model writes markdown, and shown as characters that is punctuation in the
 * way of the words: `**7/10**` read as asterisks, a command came with its
 * backticks, a list was a column of hyphens.
 *
 * The user's own message deliberately does not go through this — see
 * `UserMessage`.
 */
function Prose({ text }: { text: string }): React.JSX.Element {
  return <Markdown text={text} />
}

function Thinking({ text }: { text: string }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <details className="text-ink-faint">
      <summary className="focus-ring cursor-pointer list-none select-none">
        <ChevronRight aria-hidden className="mr-1 inline align-[-2px]" size={12} />
        {t('chat.thinking')}
      </summary>
      {/* The same prose with the same markup, so drawn the same way. Being
          folded away is not a reason for it to be wrong. */}
      <div className="border-line mt-1 border-l pl-3">
        <Markdown text={text} />
      </div>
    </details>
  )
}

/**
 * A stretch of tool calls, folded into the count of them.
 *
 * A turn is mostly tool calls — a rename went through fifty-nine — and one line
 * each buried the two things worth reading: what the agent said, and what it
 * changed. Closed by default, because the answer to "what did it do" is the
 * work itself and this is the working out.
 *
 * The same disclosure as reasoning above, for the same reason: available to
 * anyone who wants it, in the way of nobody who does not.
 */
function ToolRun({ entries }: { entries: readonly ChatEntry[] }): React.JSX.Element {
  const { t } = useTranslation()
  const steps = toolCount(entries)

  return (
    <details className="text-ink-faint">
      <summary className="focus-ring cursor-pointer list-none select-none">
        <ChevronRight aria-hidden className="mr-1 inline align-[-2px]" size={12} />
        {t('chat.toolSteps', { count: steps })}
      </summary>

      {/* The same list the summary counted, not a second reading of the block:
          asked twice, the two answers drifted and the fold promised two steps
          and opened on three. */}
      <div className="border-line mt-1 flex flex-col gap-1 border-l pl-3">
        {toolRunRows(entries).map((row, index) => (
          <ToolCall key={index} name={row.name} input={row.input} />
        ))}
      </div>
    </details>
  )
}

/** How each kind of line is tinted. Tokens only, so both themes hold. */
const CHANGE_TONES: Record<ChangeLine['sign'], string> = {
  '+': 'bg-success-bg text-success',
  '-': 'bg-danger-bg text-danger',
  ' ': 'text-ink-soft'
}

/**
 * The lines of a change, numbered where a number can be justified.
 *
 * A removed line belongs to the file as it was, and that is not something we
 * kept — so its gutter stays empty. Numbering it from the new file would be out
 * by every line the change added, and a line number is read as fact.
 *
 * Without context the numbers are left off entirely rather than started from
 * one: an edit does not begin at the top of its file, and saying so would be
 * the same lie more confidently told.
 */
function numbered(change: Change, context: ChangeContext | null): readonly NumberedLine[] {
  if (!context) return change.lines.map((line) => ({ ...line, number: null }))

  const lines: NumberedLine[] = context.before.map((text, offset) => ({
    sign: ' ' as const,
    text,
    number: context.startLine - context.before.length + offset
  }))

  // The unchanged and added lines are the file as it now stands, in order, so
  // they take the numbers in turn. A removed line takes none and holds none up.
  let number = context.startLine
  for (const line of change.lines) {
    lines.push({ ...line, number: line.sign === '-' ? null : number })
    if (line.sign !== '-') number++
  }

  for (const [offset, text] of context.after.entries()) {
    lines.push({ sign: ' ', text, number: number + offset })
  }

  return lines
}

interface NumberedLine extends ChangeLine {
  readonly number: number | null
}

/**
 * What a tool call did to a file.
 *
 * The arguments carry it already — an `Edit` is handed the text it replaces and
 * the text it writes — so this needs nothing from disk and draws the same on a
 * conversation read back after a restart. The lines it landed among are the one
 * thing the arguments cannot carry, which is why `context` arrives separately.
 */
function ChangeBlock({
  name,
  change,
  context
}: {
  name: string
  change: Change
  context: ChangeContext | null
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="border-line min-w-0 rounded-[var(--radius-control)] border">
      <div className="border-line text-ink-soft flex min-w-0 items-baseline gap-2 border-b px-2.5 py-1.5">
        <Pencil aria-hidden className="shrink-0 self-center" size={12} />
        <span className="font-medium">{name}</span>
        {/* The path and the lines go through `shown` for the reason the diff
            pane's do: a bidi override reorders what is read without changing
            what runs, and this block is where a small change is usually read
            instead of in the diff at all. */}
        <span className="text-ink-faint truncate font-mono text-[11px]" title={change.path}>
          {shown(change.path)}
        </span>

        {/* The counts describe one occurrence, which is all an `Edit` carries.
            With `replace_all` that is not a total, and drawing it as one said
            `+1 −1` over a rename through twelve places — so the number gives
            way to the fact it cannot state. */}
        {change.everywhere ? (
          <span className="text-ink-faint ml-auto shrink-0 text-[11px]">
            {t('chat.changeEverywhere')}
          </span>
        ) : (
          <span className="ml-auto shrink-0 font-mono text-[11px]">
            {change.added > 0 && <span className="text-success">+{change.added}</span>}
            {change.added > 0 && change.removed > 0 && ' '}
            {change.removed > 0 && <span className="text-danger">−{change.removed}</span>}
          </span>
        )}
      </div>

      {/* Capped rather than folded: the median change is two lines, so a click
          to see it would cost more than it saves — but a file written whole
          runs to hundreds, and that must not push the conversation away. */}
      <div className="max-h-64 overflow-auto py-1 font-mono text-[11px] leading-relaxed">
        {numbered(change, context).map((line, index) => (
          <div key={index} className={`flex gap-2 px-2.5 ${CHANGE_TONES[line.sign]}`}>
            <span className="text-ink-faint w-8 shrink-0 text-right tabular-nums select-none">
              {line.number}
            </span>
            <span className="min-w-0 whitespace-pre-wrap">
              {line.sign === ' ' ? ' ' : line.sign}
              {shown(line.text)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ToolCall({ name, input }: { name: string; input: unknown }): React.JSX.Element {
  const target = describeToolInput(input)

  return (
    <div className="text-ink-soft flex min-w-0 items-baseline gap-2">
      <Wrench aria-hidden className="shrink-0 self-center" size={12} />
      <span className="font-medium">{name}</span>
      {/* Through `shown`, as the change block below does, and the title through
          its plain-text sibling: a tooltip is laid out by the same
          bidirectional algorithm as the row it hangs off, so leaving the raw
          string there would be the same misreading with a delay. */}
      {target !== null && (
        <span className="text-ink-faint truncate font-mono text-[11px]" title={named(target)}>
          {shown(target)}
        </span>
      )}
    </div>
  )
}

/**
 * The plan the agent worked out, shown as what it is.
 *
 * It arrives as an argument to `ExitPlanMode` rather than as prose, which is
 * why it used to vanish: drawn as an ordinary tool call it was a row saying
 * "ExitPlanMode" and nothing else, while the answer to the whole turn sat
 * inside it unread.
 *
 * Given its own frame rather than the tool row's single line, because it is
 * the substance of the turn — usually several paragraphs — and the one thing
 * the reader has to weigh before approving anything.
 */
function Plan({
  text,
  busy,
  onExecute
}: {
  text: string
  busy: boolean
  onExecute: (plan: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="border-line rounded-[var(--radius-panel)] border">
      {/* A header of its own rather than a first line inside the padding: the
          plan runs to several screens, and a title that shares a box with the
          prose under it stops looking like a title by the second paragraph.
          A separator and no fill, as the composer's own strips do. */}
      <div className="border-line flex items-center gap-2 border-b px-3 py-1.5 font-medium">
        <Map aria-hidden className="text-accent shrink-0" size={14} />
        {t('chat.plan')}

        {/* The way back to a plan that was set aside. The dialog asks once, and
            once it is closed the block in the log is all that is left — so
            changing your mind about a plan you can still read meant retyping
            the request. Absent while the agent is working: it would be queued
            behind the turn, and the plan may be the very thing being redone. */}
        <Button
          className="ml-auto"
          size="sm"
          disabled={busy}
          onClick={() => {
            onExecute(text)
          }}
        >
          <Play aria-hidden size={11} />
          {t('chat.executePlan')}
        </Button>
      </div>

      <div className="px-3 py-2.5">
        <Markdown text={text} />
      </div>
    </div>
  )
}

/**
 * Only failures are shown.
 *
 * A tool that worked has already said so by the agent carrying on, and the
 * output of a successful `Read` is the file — pasting it into the chat would
 * bury the conversation in the codebase.
 */
function ToolFailure({ content }: { content: string }): React.JSX.Element {
  return (
    /*
     * `whitespace-pre-wrap` because every failure worth reading arrives with
     * newlines in it — a stack trace, a compiler's three lines of context, a
     * validation error listing what it refused — and `readFailure` keeps them.
     * They were dying here: nothing in `styles.css` sets `white-space` and
     * Tailwind's preflight sets none on a `p`, so the whole thing collapsed
     * into one paragraph. `PlanNote` below, drawing the same string, had it.
     *
     * `wrap-anywhere` rather than the `break-all` it replaces, which chops
     * ordinary words mid-character; and pre-*wrap* rather than `pre`, because
     * the log scrolls and an unbroken line would take it sideways.
     */
    <p className="text-danger border-danger/25 border-l pl-3 font-mono text-[11px] whitespace-pre-wrap wrap-anywhere">
      {shown(readFailure(content))}
    </p>
  )
}

/**
 * What was said back to a plan.
 *
 * The dialog's field sends the note as the refusal's reason, so it reaches the
 * log as a failed `ExitPlanMode` — accurate about the call, and wrong about the
 * moment: nothing broke, someone read a plan and asked for a different one.
 * In `danger` and monospaced at 11px it was the reader's own sentence drawn as
 * a stack trace.
 *
 * The warning colour instead, and the interface's own text: a note against the
 * plan above, which is what it is. The rule stays, since what ties it to that
 * plan is standing beside it.
 */
function PlanNote({ content }: { content: string }): React.JSX.Element {
  return (
    <p className="text-warning border-warning/25 border-l pl-3 whitespace-pre-wrap">
      {shown(readFailure(content))}
    </p>
  )
}

function PermissionCard({
  toolName,
  input,
  reason,
  answerable,
  onAnswer
}: {
  toolName: string
  input: unknown
  /** The bridge's explanation, where it sent one. Null is the ordinary case. */
  reason: string | null
  answerable: boolean
  onAnswer: (answer: PermissionAnswer) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const target = describeToolInput(input)

  return (
    <div className="border-warning/30 bg-warning-bg rounded-[var(--radius-panel)] border px-3 py-2.5">
      <p className="flex items-center gap-2 font-medium">
        <ShieldAlert aria-hidden className="text-warning shrink-0" size={14} />
        {t('chat.permissionTitle', { tool: toolName })}
      </p>

      {/* The one place somebody authorises a command to run against their
          working tree, and it has to show the command that will run. An
          override reorders the text while the string handed to the agent is
          untouched — and "Always allow" writes the tool *name*, so answering
          it on a misread line approves every future call of that tool
          everywhere. `whitespace-pre-wrap` because a command may have newlines
          in it, and `wrap-anywhere` rather than `break-all`, which chops
          ordinary words mid-character. */}
      {target !== null && (
        <p className="text-ink-soft mt-1 font-mono text-[11px] whitespace-pre-wrap wrap-anywhere">
          {shown(target)}
        </p>
      )}

      {/* The one sentence that explains an otherwise identical-looking request:
          under `acceptEdits` a file inside `.claude/` is asked about while
          fifty ordinary edits are not, because the CLI guards the agent's own
          instructions separately — and until this was drawn the mode simply
          looked broken.

          Left in the bridge's own words rather than translated or replaced by
          our own sentence: it names a specific path and a specific rule, and
          the alternative is silence. The heading above stays ours, though the
          SDK offers a `title` of its own — that one says what the tool name and
          the path already say, in English, in a window that is not. */}
      {reason !== null && <p className="text-ink-soft mt-1.5 leading-relaxed">{reason}</p>}

      {answerable ? (
        <div className="mt-2.5 flex gap-2">
          <Button
            variant="accent"
            size="sm"
            onClick={() => {
              onAnswer('allow')
            }}
          >
            {t('chat.allow')}
          </Button>

          <Button
            size="sm"
            onClick={() => {
              onAnswer('always')
            }}
          >
            {t('chat.always')}
          </Button>

          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              onAnswer('deny')
            }}
          >
            {t('chat.deny')}
          </Button>
        </div>
      ) : (
        <p className="text-ink-faint mt-1.5">{t('chat.permissionAnswered')}</p>
      )}
    </div>
  )
}

/**
 * The quiet line closing a turn: whether it worked, and how long it took.
 *
 * Deliberately not the cost. The SDK's `total_cost_usd` is what the same tokens
 * would have cost through the API — its own documentation calls it "an
 * estimate, not a billing statement" — and on a subscription no such sum is
 * ever charged. It is also cumulative across the session, so putting it on a
 * row would read as the price of that one turn while meaning the running total.
 * A made-up number in a currency, in a place the eye trusts.
 */
function TurnFooter({
  ok,
  durationMs,
  inputTokens,
  outputTokens,
  terminalReason
}: {
  ok: boolean
  durationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  terminalReason: string | null
}): React.JSX.Element {
  const { t } = useTranslation()

  const parts: string[] = []
  if (durationMs !== null)
    parts.push(t('chat.duration', { seconds: (durationMs / 1000).toFixed(1) }))
  // Both halves or neither: `213 tokens` on a turn whose prompt went
  // unreported would read as the whole of what the exchange took, and be out
  // by two orders of magnitude.
  if (inputTokens !== null && outputTokens !== null) {
    const total = inputTokens + outputTokens
    // `count` is the number, for choosing the plural form; `tokens` is the
    // shortened string that gets shown. i18next reserves `count` for the
    // former, and a pre-formatted string there picks a form silently wrong.
    parts.push(t('chat.tokens', { count: total, tokens: formatTokens(total) }))
  }

  // Only when the turn did not simply finish. A row saying "completed" beside
  // a tick is the same thing said twice.
  const outcome = turnOutcome(terminalReason)
  if (outcome !== 'completed') parts.push(t(OUTCOME_LABELS[outcome]))

  return (
    <p className="text-ink-faint border-line flex items-center gap-2 border-t pt-2 text-[11px]">
      {ok ? (
        <Check aria-hidden className="text-success" size={12} />
      ) : (
        <TriangleAlert aria-hidden className="text-danger" size={12} />
      )}
      {parts.join(' · ')}
    </p>
  )
}

/**
 * The line where the agent's memory of this conversation starts again.
 *
 * Everything above it is still the record of what happened — and still worth
 * reading — but the agent no longer has any of it. Without the line, a
 * conversation that continues past this point looks like one the agent should
 * be able to refer back to, and it cannot.
 *
 * Drawn in the `TurnFooter` register rather than as a warning: nothing went
 * wrong here, and a coloured banner would claim otherwise.
 */
function ResetRow(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <p className="text-ink-faint border-line flex items-center gap-2 border-t pt-2 text-[11px]">
      <Eraser aria-hidden size={12} />
      {t('chat.memoryReset')}
    </p>
  )
}

/**
 * The line where the agent's memory of this conversation thins out.
 *
 * `ResetRow`'s twin, and the same event with the memory partly kept rather than
 * wholly discarded: everything above still happened and is still worth reading,
 * but the agent holds a summary of it. Without the line a compacted
 * conversation reads as an intact one, and "do what we agreed earlier" fails in
 * a way that looks like the agent ignoring an instruction.
 *
 * Drawn for the compaction the user asked for as well as the automatic one. The
 * CLI narrates only what it was asked, and the attic now offers `/compact` as a
 * click rather than a command somebody has to know.
 *
 * The figures are drawn when they are there and the row stands without them:
 * the reader's question is whether this was compacted, not by how much.
 */
function CompactedRow({
  preTokens,
  postTokens
}: {
  preTokens: number | null
  postTokens: number | null
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <p className="text-ink-faint border-line flex items-center gap-2 border-t pt-2 text-[11px]">
      <Archive aria-hidden size={12} />
      {preTokens === null || postTokens === null
        ? t('chat.compacted')
        : t('chat.compactedBy', {
            before: formatTokens(preTokens),
            after: formatTokens(postTokens)
          })}
    </p>
  )
}

/**
 * The line where a model refused and another one took the turn.
 *
 * In the same quiet register as the compaction and reset lines, and for the
 * same reason: something happened to the conversation that nobody in it asked
 * for, and the turn above reads as an ordinary one without it.
 *
 * Two sentences rather than one. A `session` swap outlives the turn and the
 * model chip has already moved to the new name, so the line is what explains a
 * chip that changed on its own; a `local` one was a subagent or a side question
 * and the chip has not moved, where saying "the model changed" would send the
 * reader looking for a change that is not there.
 *
 * The explanation is the model's own prose and is drawn as given — the SDK
 * calls it "unstable human prose — display only, never parse", so it is shown
 * and nothing is read out of it.
 */
function RefusalFallbackRow({
  event
}: {
  event: Extract<AgentEvent, { type: 'model_refusal_fallback' }>
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="text-ink-faint border-line border-t pt-2 text-[11px]">
      <p className="flex items-center gap-2">
        <Repeat aria-hidden size={12} />
        {t(event.scope === 'session' ? 'chat.refusalSwapped' : 'chat.refusalSwappedLocally', {
          from: event.originalModel,
          to: event.fallbackModel
        })}
      </p>

      {event.explanation !== null && event.explanation.trim() !== '' && (
        <p className="mt-1 pl-5 leading-relaxed">{event.explanation}</p>
      )}
    </div>
  )
}

function ErrorRow({ message }: { message: string }): React.JSX.Element {
  return (
    <p className="bg-danger-bg text-danger border-danger/25 rounded-[var(--radius-control)] border px-3 py-2">
      {shown(message)}
    </p>
  )
}
