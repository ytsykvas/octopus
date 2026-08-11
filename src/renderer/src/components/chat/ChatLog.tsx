import { Check, ChevronRight, ShieldAlert, TriangleAlert, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { type AgentEvent, type TurnOutcome, turnOutcome } from '@core/events.js'
import type { PermissionAnswer } from '@core/service.js'
import type { ChatEntry } from '@core/transcript.js'

import { Button } from '../Button.js'
import type { Streaming } from '../../hooks/useChat.js'
import { formatTokens } from './format.js'
import { describeToolInput } from './toolSummary.js'

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
  onAnswer
}: ChatLogProps): React.JSX.Element {
  const { t } = useTranslation()
  const streamingAnything = streaming.text !== '' || streaming.thinking !== ''

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-5">
      {entries.map((entry, index) => (
        // The index is the key because the log is append-only: nothing is ever
        // reordered or removed, so a position identifies a row for its whole
        // life. Two identical events in a row have nothing else to tell apart.
        <EntryRow
          key={index}
          entry={entry}
          pendingRequestId={pendingRequestId}
          onAnswer={onAnswer}
        />
      ))}

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
  pendingRequestId,
  onAnswer
}: {
  entry: ChatEntry
  pendingRequestId: string | null
  onAnswer: (requestId: string, answer: PermissionAnswer) => void
}): React.JSX.Element | null {
  if (entry.role === 'user') return <UserMessage text={entry.text} />
  return <AgentRow event={entry.event} pendingRequestId={pendingRequestId} onAnswer={onAnswer} />
}

function AgentRow({
  event,
  pendingRequestId,
  onAnswer
}: {
  event: AgentEvent
  pendingRequestId: string | null
  onAnswer: (requestId: string, answer: PermissionAnswer) => void
}): React.JSX.Element | null {
  switch (event.type) {
    case 'text':
      return <Prose text={event.text} />

    case 'thinking':
      // Not the same guard as the one in the mapping, which stops new ones
      // being written: transcripts recorded before it already hold empty
      // reasoning, and those are read back on every launch.
      return event.text.trim() === '' ? null : <Thinking text={event.text} />

    case 'tool_use':
      return <ToolCall name={event.name} input={event.input} />

    case 'tool_result':
      return event.ok ? null : <ToolFailure content={event.content} />

    case 'permission_request':
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

function UserMessage({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="bubble-sent self-end rounded-[var(--radius-panel)] border px-3 py-2 whitespace-pre-wrap">
      {text}
    </div>
  )
}

function Prose({ text }: { text: string }): React.JSX.Element {
  return <div className="leading-relaxed whitespace-pre-wrap">{text}</div>
}

function Thinking({ text }: { text: string }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <details className="text-ink-faint">
      <summary className="focus-ring cursor-pointer list-none select-none">
        <ChevronRight aria-hidden className="mr-1 inline align-[-2px]" size={12} />
        {t('chat.thinking')}
      </summary>
      <div className="border-line mt-1 border-l pl-3 leading-relaxed whitespace-pre-wrap">
        {text}
      </div>
    </details>
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
