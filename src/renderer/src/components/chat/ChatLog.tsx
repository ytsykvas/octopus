import {
  Check,
  ChevronRight,
  Map,
  Pencil,
  Play,
  ShieldAlert,
  TriangleAlert,
  Wrench
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { type AgentEvent, type ChangeContext, type TurnOutcome, turnOutcome } from '@core/events.js'
import type { PermissionAnswer } from '@core/service.js'
import type { ChatEntry } from '@core/transcript.js'

import { Button } from '../Button.js'
import type { Streaming } from '../../hooks/useChat.js'
import { formatTokens } from './format.js'
import type { Change, ChangeLine } from './changeSummary.js'
import { Markdown } from './Markdown.js'
import { groupToolRuns, toolCount } from './toolRuns.js'
import { describeToolInput, readPlan } from './toolSummary.js'

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
  onExecutePlan
}: ChatLogProps): React.JSX.Element {
  const { t } = useTranslation()
  const streamingAnything = streaming.text !== '' || streaming.thinking !== ''

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-5">
      {/* The position is the key because the log is append-only: nothing is
          ever reordered or removed, so where a block starts identifies it for
          its whole life. Two identical rows have nothing else to tell apart. */}
      {groupToolRuns(entries).map((block) => {
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
            busy={busy}
            pendingRequestId={pendingRequestId}
            onAnswer={onAnswer}
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

function EntryRow({
  entry,
  busy,
  pendingRequestId,
  onAnswer,
  onExecutePlan
}: {
  entry: ChatEntry
  busy: boolean
  pendingRequestId: string | null
  onAnswer: (requestId: string, answer: PermissionAnswer) => void
  onExecutePlan: (plan: string) => void
}): React.JSX.Element | null {
  if (entry.role === 'user') return <UserMessage text={entry.text} />

  return (
    <AgentRow
      event={entry.event}
      busy={busy}
      pendingRequestId={pendingRequestId}
      onAnswer={onAnswer}
      onExecutePlan={onExecutePlan}
    />
  )
}

function AgentRow({
  event,
  busy,
  pendingRequestId,
  onAnswer,
  onExecutePlan
}: {
  event: AgentEvent
  busy: boolean
  pendingRequestId: string | null
  onAnswer: (requestId: string, answer: PermissionAnswer) => void
  onExecutePlan: (plan: string) => void
}): React.JSX.Element | null {
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

      // A call that changed a file never arrives here: `groupToolRuns` pulls it
      // out into a block of its own, so that it can carry the context recorded
      // for it — which arrives later in the log than the call does.
      return <ToolCall name={event.name} input={event.input} />
    }

    case 'tool_result':
      return event.ok ? null : <ToolFailure content={event.content} />

    case 'permission_request':
      // A plan's request has nothing left to say here. The plan itself is
      // already above, drawn from the `ExitPlanMode` call that carried it, and
      // the question about it is asked in a dialog — a card would be the same
      // text a second time with buttons that duplicate the dialog's.
      if (readPlan(event.toolName, event.input) !== null) return null

      return (
        <PermissionCard
          toolName={event.toolName}
          input={event.input}
          // A request read back from the transcript is history: the session it
          // belonged to answered it long ago, and offering buttons would let
          // the user answer a question nobody is waiting on.
          answerable={event.requestId === pendingRequestId}
          onAnswer={(answer) => {
            onAnswer(event.requestId, answer)
          }}
        />
      )

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

    case 'error':
      return <ErrorRow message={event.message} />

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
    <div className="bubble-sent self-end rounded-[var(--radius-panel)] border px-3 py-2 whitespace-pre-wrap">
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

      <div className="border-line mt-1 flex flex-col gap-1 border-l pl-3">
        {entries.map((entry, index) =>
          entry.role === 'agent' && entry.event.type === 'tool_use' ? (
            <ToolCall key={index} name={entry.event.name} input={entry.event.input} />
          ) : null
        )}
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
 * What a tool call did to a file.
 *
 * The arguments carry it already — an `Edit` is handed the text it replaces and
 * the text it writes — so this needs nothing from disk and draws the same on a
 * conversation read back after a restart.
 *
 * No line numbers: `old_string` is a fragment, and real ones would need the file
 * as it stood at the time, which is not something we have. A number that is
 * nearly right is worse than none in a place the eye trusts.
 */
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

function ChangeBlock({
  name,
  change,
  context
}: {
  name: string
  change: Change
  context: ChangeContext | null
}): React.JSX.Element {
  return (
    <div className="border-line min-w-0 rounded-[var(--radius-control)] border">
      <div className="border-line text-ink-soft flex min-w-0 items-baseline gap-2 border-b px-2.5 py-1.5">
        <Pencil aria-hidden className="shrink-0 self-center" size={12} />
        <span className="font-medium">{name}</span>
        <span className="text-ink-faint truncate font-mono text-[11px]" title={change.path}>
          {change.path}
        </span>

        <span className="ml-auto shrink-0 font-mono text-[11px]">
          {change.added > 0 && <span className="text-success">+{change.added}</span>}
          {change.added > 0 && change.removed > 0 && ' '}
          {change.removed > 0 && <span className="text-danger">−{change.removed}</span>}
        </span>
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
              {line.text}
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
      {target !== null && (
        <span className="text-ink-faint truncate font-mono text-[11px]" title={target}>
          {target}
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
    <p className="text-danger border-danger/25 border-l pl-3 font-mono text-[11px] break-all">
      {content.slice(0, 400)}
    </p>
  )
}

function PermissionCard({
  toolName,
  input,
  answerable,
  onAnswer
}: {
  toolName: string
  input: unknown
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

      {target !== null && (
        <p className="text-ink-soft mt-1 font-mono text-[11px] break-all">{target}</p>
      )}

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

function ErrorRow({ message }: { message: string }): React.JSX.Element {
  return (
    <p className="bg-danger-bg text-danger border-danger/25 rounded-[var(--radius-control)] border px-3 py-2">
      {message}
    </p>
  )
}
