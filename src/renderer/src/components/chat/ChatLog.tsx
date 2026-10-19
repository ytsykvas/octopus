import {
  Archive,
  Check,
  CircleSlash,
  Clock3,
  Eraser,
  FileCode2,
  FolderGit2,
  Map,
  Play,
  Repeat,
  ShieldAlert,
  ShieldX,
  TriangleAlert,
  Undo2,
  ZapOff
} from 'lucide-react'
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  type ThreadMessageLike,
  useExternalStoreRuntime
} from '@assistant-ui/react'
import type { TFunction } from 'i18next'
import { createContext, useContext, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { FormValues } from '@core/elicitation.js'
import { type AgentEvent, type TurnOutcome, turnOutcome } from '@core/events.js'
import { type QuestionAnswer, readQuestions } from '@core/questions.js'
import type { PermissionAnswer } from '@core/service.js'
import type { ChatEntry } from '@core/transcript.js'

import { Button } from '../Button.js'
import { DisclosureButton } from '../Disclosure.js'
import { ColouredLines, useColouredText } from '../diff/colouredText.js'
import { shown } from '../diff/shown.js'
import type { Streaming } from '../../hooks/useChat.js'
import { DaySeparator } from './DayChip.js'
import { exitCodeOf, formatClock, formatFullTime, formatTokens } from './format.js'
import { Markdown } from './Markdown.js'
import { BLOCK_PART, DAY_PART, toThreadMessages } from './threadMessages.js'
import { ElicitationCard } from './ElicitationCard.js'
import { QuestionCard } from './QuestionCard.js'
import { type MessageBlock, messageBlocks } from './userMessage.js'
import { type Expansion, ExpandContext, FileLinkContext, useExpanded } from './expansion.js'
import {
  answersByRequest,
  buildBlocks,
  elicitationsByRequest,
  type LogBlock,
  planCalls,
  retractedUuids,
  turnStartedAt
} from './logBlocks.js'
import { ToolRow } from './ToolRow.js'
import { WorkingLine } from './WorkingLine.js'
import { readFailure } from './toolFailure.js'
import { describeToolInput, readPlan, readWorktreeMove, type WorktreeMove } from './toolSummary.js'
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
  /** The one MCP question a server is still holding open, if any. */
  readonly pendingElicitationId: string | null
  readonly onAnswer: (requestId: string, answer: PermissionAnswer) => void
  /** Answers an MCP server's question, which is neither a permission nor a tool. */
  readonly onAnswerElicitation: (
    requestId: string,
    answer: 'accept' | 'decline',
    values?: FormValues
  ) => void
  /** Answers the agent's own questions, which is not a permission. */
  readonly onAnswerQuestions: (requestId: string, answers: readonly QuestionAnswer[]) => void
  /** Asks for a plan already in the log to be carried out. */
  readonly onExecutePlan: (plan: string) => void
  /**
   * Asks for the files to be put back to how they were when a message was sent.
   *
   * The log only offers it; the pane asks the question and does the work, since
   * there is a dialog in between and a bridge call either side of it.
   */
  readonly onRewind: (messageId: string) => void
  /** The messages the agent has not taken yet, by id — see `useChat`. */
  readonly waiting: ReadonlySet<string>
  /** Whether every row is open, and how many times that was asked — see `Expansion`. */
  readonly expansion: Expansion
  /** The checkout the agent works in, so a path it names can be opened. */
  readonly workspacePath: string
  /** Opens a workspace-relative path in the centre: kept open, or as a preview. */
  readonly onOpenFile: (path: string, pinned: boolean) => void
}

/**
 * The conversation itself.
 *
 * Shaped like Claude Code's own transcript: what the agent said as prose, and
 * every tool call as one row with what came back under it — a turn is mostly
 * tool calls, and folding them away hid the part that says what the agent
 * actually did.
 */
export function ChatLog({
  entries,
  streaming,
  busy,
  pendingRequestId,
  pendingElicitationId,
  onAnswer,
  onAnswerElicitation,
  onAnswerQuestions,
  onExecutePlan,
  onRewind,
  waiting,
  expansion,
  workspacePath,
  onOpenFile
}: ChatLogProps): React.JSX.Element {
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
  const elicitationAnswers = useMemo(() => elicitationsByRequest(entries), [entries])
  const blocks = useMemo(() => buildBlocks(entries), [entries])
  // What the working line counts from.
  const turnStart = useMemo(() => turnStartedAt(entries), [entries])
  // Held still, so the rows reading it are not re-rendered by every token the
  // answer streams in: the pane hands over a callback that keeps its identity.
  const links = useMemo(() => ({ workspacePath, onOpenFile }), [workspacePath, onOpenFile])
  // Which calls handed over a plan, so that a plan sent back for another round
  // is not drawn as something that broke.
  const plans = useMemo(() => planCalls(entries), [entries])
  // What the agent took back, so the rows it names can say so rather than
  // standing above their own replacement as though they still held.
  const retracted = useMemo(() => retractedUuids(entries), [entries])

  // The turns as the library's runtime holds them. Held against the blocks:
  // it caches each message by the object it was handed, and a list rebuilt on
  // every render would make it walk the whole thread for every streamed token.
  const messages = useMemo(() => toThreadMessages(blocks, entries), [blocks, entries])
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    isRunning: false,
    convertMessage: asIs,
    onNew: neverSentHere
  })

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-5">
      {/* The rows are drawn through the library's thread and message
          primitives, one message per turn, and every block rides in as a part
          the row renderer below turns back into what it always was. The
          wrappers are `contents` so the column's gap still sits between rows
          and not between a row and its wrapper. */}
      <AssistantRuntimeProvider runtime={runtime}>
        <ExpandContext.Provider value={expansion}>
          <FileLinkContext.Provider value={links}>
            <RowsContext.Provider
              value={{
                plans,
                retracted,
                waiting,
                busy,
                pendingRequestId,
                pendingElicitationId,
                elicitationAnswers,
                onAnswerElicitation,
                answers,
                onAnswer,
                onAnswerQuestions,
                onExecutePlan,
                onRewind
              }}
            >
              <ThreadPrimitive.Root className="contents">
                <ThreadPrimitive.Messages>{renderTurn}</ThreadPrimitive.Messages>
              </ThreadPrimitive.Root>
            </RowsContext.Provider>
          </FileLinkContext.Provider>
        </ExpandContext.Provider>
      </AssistantRuntimeProvider>

      <ExpandContext.Provider value={expansion}>
        {streaming.thinking !== '' && <Thinking text={streaming.thinking} />}
      </ExpandContext.Provider>
      {streaming.text !== '' && <Prose text={streaming.text} />}

      {busy && <WorkingLine since={turnStart} />}
    </div>
  )
}

/*
 * What the library is handed, and what of it is rebuilt per render.
 *
 * It caches a message by the object it was given and the part renderers by the
 * object they came in, so an inline arrow or a fresh components map makes every
 * row re-render by itself: 592 ms for one update at a thousand turns with them
 * inline, 18 ms with them hoisted. The converter, the part map and the message
 * renderer below are module constants for that reason.
 *
 * The rows' own props are not: they travel in a context whose value is built
 * per render, so every row re-renders when the log does — as they did before
 * the library, and no worse. Holding that value still would need the callbacks
 * stabilised first, which the pane does not do.
 */
const asIs = (message: ThreadMessageLike): ThreadMessageLike => message

/**
 * Messages are never sent through the runtime: the composer is the way in.
 *
 * Required by the library all the same, and nothing here can reach it — the log
 * draws no input of its own — so there is nothing to call it with.
 */
/* v8 ignore next */
const neverSentHere = (): Promise<void> => Promise.resolve()

/** What every row needs, from the log that holds them. */
const RowsContext = createContext<RowProps | null>(null)

/** One log block, drawn the way the log has always drawn it. */
function BlockRow({ block }: { block: LogBlock }): React.JSX.Element | null {
  const rows = useContext(RowsContext)
  // Rendered only inside the provider above, which always supplies it. The
  // guard is for the type, which cannot know that.
  /* v8 ignore next */
  if (rows === null) return null

  if (block.kind === 'tool') {
    const { uuid } = block.call
    const row = <ToolRow call={block.call} busy={rows.busy} />
    return uuid !== undefined && rows.retracted.has(uuid) ? <Retracted>{row}</Retracted> : row
  }

  return <EntryRow entry={block.entry} {...rows} />
}

/** The part that carries a block: typed by what `toThreadMessages` puts in it. */
const BlockPart = ({ data }: { data: LogBlock }): React.JSX.Element => <BlockRow block={data} />

/** The part that opens a day: typed by what `toThreadMessages` puts in it. */
const DayPart = ({ data }: { data: string }): React.JSX.Element => <DaySeparator day={data} />

const BLOCK_PARTS = {
  data: { by_name: { [BLOCK_PART]: BlockPart, [DAY_PART]: DayPart } }
} satisfies NonNullable<React.ComponentProps<typeof MessagePrimitive.Parts>['components']>

/** A turn: its blocks are its parts, in the order they happened. */
const renderTurn = (): React.JSX.Element => (
  <MessagePrimitive.Root className="contents">
    <MessagePrimitive.Parts components={BLOCK_PARTS} />
  </MessagePrimitive.Root>
)

/** What every row needs to answer whatever the agent is waiting on. */
interface AnswerProps {
  busy: boolean
  pendingRequestId: string | null
  pendingElicitationId: string | null
  elicitationAnswers: Map<string, 'accept' | 'decline' | 'cancel'>
  onAnswerElicitation: (
    requestId: string,
    answer: 'accept' | 'decline',
    values?: FormValues
  ) => void
  /** What was chosen, by request, for questions read back from the transcript. */
  answers: Map<string, readonly QuestionAnswer[]>
  onAnswer: (requestId: string, answer: PermissionAnswer) => void
  onAnswerQuestions: (requestId: string, answers: readonly QuestionAnswer[]) => void
  onExecutePlan: (plan: string) => void
  onRewind: (messageId: string) => void
}

/** Everything a row needs on top of the entry itself. */
interface RowProps extends AnswerProps {
  /** The calls that handed over a plan, by id. See `planCalls`. */
  plans: ReadonlySet<string>
  /** Wire ids the agent has taken back. See `retractedUuids`. */
  retracted: ReadonlySet<string>
  /** The user's messages the agent has not taken yet, by id. */
  waiting: ReadonlySet<string>
}

function EntryRow({
  entry,
  ...answering
}: { entry: ChatEntry } & RowProps): React.JSX.Element | null {
  if (entry.role === 'user') {
    const messageId = entry.uuid

    return (
      <UserMessage
        text={entry.text}
        at={entry.at}
        waiting={messageId !== undefined && answering.waiting.has(messageId)}
        // Offered only for a message that has an id to rewind to — those sent
        // before ids were kept have none — and not while the agent is working,
        // which the core would refuse anyway: a button that can only fail is a
        // promise the interface does not keep.
        onRewind={
          messageId === undefined || answering.busy
            ? null
            : () => {
                answering.onRewind(messageId)
              }
        }
      />
    )
  }

  const row = <AgentRow event={entry.event} {...answering} />

  const uuid = 'uuid' in entry.event ? entry.event.uuid : undefined
  if (uuid === undefined || !answering.retracted.has(uuid)) return row

  return <Retracted>{row}</Retracted>
}

/**
 * A row the agent took back.
 *
 * Struck through rather than dropped. The work was really done and then
 * abandoned, and a log that quietly loses it reads as though the agent never
 * started — while the same conversation on disk would still hold it. The
 * spelling is the one the sidebar already uses for a workspace whose directory
 * is gone.
 */
function Retracted({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="text-ink-faint line-through opacity-60" title={t('chat.retracted')}>
      {children}
    </div>
  )
}

function AgentRow({
  event,
  plans,
  busy,
  pendingRequestId,
  pendingElicitationId,
  elicitationAnswers,
  onAnswerElicitation,
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

    // Only the calls with a row of their own reach here: every other one is a
    // tool row, built by `buildBlocks` with its answer folded in.
    case 'tool_use': {
      const plan = readPlan(event.name, event.input)
      if (plan !== null) return <Plan text={plan} busy={busy} onExecute={onExecutePlan} />

      const move = readWorktreeMove(event.name, event.input)
      if (move !== null) return <WorktreeMoveRow move={move} />

      // The call that asks a question says nothing the card beside it does not
      // say better. Drawn as a tool row it was the same question twice: once as
      // a name with no readable arguments, and once as the thing to answer.
      return null
    }

    // The answer to a call with a row of its own, or to one no longer in the
    // log. Only a failure has anything to say.
    case 'tool_result':
      if (event.ok) return null

      // A plan handed back is not a failure, however the SDK had to record it.
      return plans.has(event.toolUseId) ? (
        <PlanNote content={event.content} />
      ) : (
        <ToolFailure content={event.content} />
      )

    case 'elicitation_request':
      return (
        <ElicitationCard
          serverName={event.serverName}
          message={event.message}
          title={event.title}
          fields={event.fields}
          // Answerable only while the server is still waiting. One read back
          // from the transcript is history, and buttons on it would let the
          // user answer a question nobody is holding open.
          answerable={pendingElicitationId === event.requestId}
          answered={elicitationAnswers.get(event.requestId) ?? null}
          onAnswer={(values) => {
            onAnswerElicitation(event.requestId, 'accept', values)
          }}
          onDecline={() => {
            onAnswerElicitation(event.requestId, 'decline')
          }}
        />
      )

    // The record of what became of one. Nothing of its own in the log: the card
    // above reads it and says so on itself, which keeps the question and its
    // outcome in one place rather than two entries apart.
    case 'elicitation_answered':
      return null

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
          suppressAlways={event.suppressAlways === true}
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

    // What the agent was actually told to do. Drawn as the plan it is, with the
    // way back to carrying it out, and named so it is not mistaken for the one
    // the agent wrote above it.
    case 'plan_edited':
      return <Plan text={event.plan} busy={busy} edited onExecute={onExecutePlan} />

    case 'files_rewound':
      return (
        <FilesRewoundRow
          files={event.files}
          insertions={event.insertions}
          deletions={event.deletions}
          skipped={event.skippedLinks}
        />
      )

    case 'model_refusal_fallback':
      return <RefusalFallbackRow event={event} />

    case 'model_refusal_no_fallback':
      return <RefusalNoFallbackRow event={event} />

    case 'permission_denied':
      return <DeniedRow event={event} />

    case 'auto_mode_unavailable':
      return <AutoFellBackRow event={event} />

    // A record, not a row. What it names is struck through above it, and a line
    // of its own would say the same thing twice.
    case 'retracted':
      return null

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
function UserMessage({
  text,
  at,
  waiting,
  onRewind
}: {
  text: string
  at: string
  /** Sent while the agent worked and not taken yet — see `useChat`. */
  waiting: boolean
  onRewind: (() => void) | null
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    /* The hour sits under the bubble, always shown: a footnote faint enough to
       read past, and the one thing a long day's log is scanned by. The day is
       the separator's, so the full date waits in the tooltip. */
    <div className="flex max-w-full flex-col items-end gap-0.5 self-end">
      <div className="group flex max-w-full items-center gap-1">
        {onRewind !== null && (
          // Held in the layout and revealed on hover, so the bubble does not jump
          // under the pointer as it crosses a message — the same arrangement as
          // the tab's menu.
          <button
            type="button"
            onClick={onRewind}
            title={t('chat.rewind')}
            aria-label={t('chat.rewind')}
            className="text-ink-faint hover:text-ink focus-ring flex size-6 shrink-0 items-center justify-center rounded transition-opacity focus:opacity-100 opacity-0 group-hover:opacity-100"
          >
            <Undo2 aria-hidden size={13} />
          </button>
        )}
        <UserBubble text={text} />
      </div>
      <div className="text-ink-faint flex items-center gap-2 px-1 text-[11px]">
        {/* Beside the hour rather than on the bubble: it is a fact about the
            message's delivery, as the hour is, and it goes once the agent
            takes it. The tooltip says what Stop will not do, which is the
            surprise — the message runs as a turn of its own afterwards. */}
        {waiting && (
          <span title={t('chat.waitingHint')} className="flex items-center gap-1">
            <Clock3 aria-hidden size={11} />
            {t('chat.waiting')}
          </span>
        )}
        <time
          dateTime={at}
          title={formatFullTime(at, t('chat.dateLocale'))}
          className="tabular-nums"
        >
          {formatClock(at)}
        </time>
      </div>
    </div>
  )
}

function UserBubble({ text }: { text: string }): React.JSX.Element {
  const blocks = messageBlocks(text)
  // Nothing recognised: the characters exactly as they were typed.
  const plain = blocks.every(
    (block) => block.kind === 'text' && block.parts.every((part) => typeof part === 'string')
  )

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
    <div className="bubble-sent flex max-w-full min-w-0 flex-col gap-2 self-end rounded-[var(--radius-panel)] border px-3 py-2 whitespace-pre-wrap wrap-anywhere">
      {plain
        ? text
        : blocks.map((block, index) =>
            block.kind === 'text' ? (
              <p key={index}>
                {block.parts.map((part, at) =>
                  typeof part === 'string' ? (
                    part
                  ) : (
                    <code
                      key={at}
                      className="bg-canvas border-line rounded-[var(--radius-control)] border px-1 font-mono text-[11px]"
                    >
                      {part.path}:{part.range}
                    </code>
                  )
                )}
              </p>
            ) : (
              <NoteCard key={index} note={block} />
            )
          )}
    </div>
  )
}

/**
 * A note on code inside a sent message: where, the lines as they read, and
 * what was said about them — the shape the composer's chip promised.
 */
function NoteCard({
  note
}: {
  readonly note: Extract<MessageBlock, { kind: 'note' }>
}): React.JSX.Element {
  // In its file's colours, as the viewer and the diff draw the same lines: a
  // few lines out of context are where colour helps most.
  const { lines, tokens } = useColouredText(note.path, note.quote)

  return (
    <div className="border-line bg-canvas text-ink min-w-0 overflow-hidden rounded-[var(--radius-control)] border">
      <p className="text-ink-soft border-line flex min-w-0 items-center gap-1.5 border-b px-2 py-1 font-mono text-[11px]">
        <FileCode2 aria-hidden size={12} className="text-ink-faint shrink-0" />
        <span className="truncate" title={note.path}>
          {note.path}:{note.range}
        </span>
        {note.suffix !== null && <span className="text-ink-faint shrink-0">{note.suffix}</span>}
      </p>
      {/* Not wrapped: code read with its lines broken is code misread. */}
      <pre className="diff-code text-ink overflow-x-auto px-2 py-1 font-mono text-[11px] leading-[16px] whitespace-pre">
        <ColouredLines lines={lines} tokens={tokens} />
      </pre>
      {note.text !== '' && <p className="border-line border-t px-2 py-1">{note.text}</p>}
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

/**
 * The agent's reasoning, folded to one line as Claude Code folds it.
 *
 * Opened by a click, or with every other row by ⌘O.
 */
function Thinking({ text }: { text: string }): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useExpanded()

  return (
    <div className="text-ink-faint">
      <DisclosureButton
        open={open}
        onOpenChange={setOpen}
        className="focus-ring flex items-center gap-1 rounded select-none"
      >
        {t('chat.thinking')}
      </DisclosureButton>
      {/* The same prose with the same markup, so drawn the same way. Being
          folded away is not a reason for it to be wrong. */}
      {open && (
        <div className="border-line mt-1 border-l pl-3">
          <Markdown text={text} />
        </div>
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
  edited = false,
  onExecute
}: {
  text: string
  busy: boolean
  /** The plan as the user rewrote it, rather than as the agent wrote it. */
  edited?: boolean
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
        {edited ? t('chat.planEdited') : t('chat.plan')}

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
 * A failure that has no tool row to sit under: the answer to a call that is no
 * longer in the log, or to one drawn as something else.
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
  suppressAlways,
  answerable,
  onAnswer
}: {
  toolName: string
  input: unknown
  /** The bridge's explanation, where it sent one. Null is the ordinary case. */
  reason: string | null
  /**
   * The bridge forbade a standing answer: the rule "Always" would write is
   * wider than this question, so the button is not offered at all.
   */
  suppressAlways: boolean
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

          {!suppressAlways && (
            <Button
              size="sm"
              onClick={() => {
                onAnswer('always')
              }}
            >
              {t('chat.always')}
            </Button>
          )}

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
 * The line where the files were put back to an earlier message.
 *
 * In the quiet register of the compaction and reset lines: the working tree
 * changed without the agent doing anything, and the edits drawn above would
 * otherwise read as though they still stood.
 */
function FilesRewoundRow({
  files,
  insertions,
  deletions,
  skipped
}: {
  files: number
  insertions: number
  deletions: number
  /** Files left alone because a link sat at their path. */
  skipped: number
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <p className="text-ink-faint border-line flex items-center gap-2 border-t pt-2 text-[11px]">
      <Undo2 aria-hidden size={12} />
      {t('chat.filesRewound', { files, insertions, deletions })}
      {/* Said when it is so: "5 changed" alone reads as though everything the
          checkpoint tracked had come back. */}
      {skipped > 0 && ` ${t('chat.filesRewoundSkipped', { count: skipped })}`}
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
 * The line where the agent moved into another worktree, or came back.
 *
 * In the warning colour rather than the compaction line's faint one: from here
 * on the rest of the window may be showing a directory the agent has left,
 * which is worth noticing before trusting the diff beside it. Worded as what
 * the agent is doing rather than what happened, because the line is drawn from
 * the call: the CLI may ask permission first, and refuses a removal with
 * uncommitted work on purpose — its answer is the red line below.
 */
function worktreeMoveText(move: WorktreeMove, t: TFunction): string {
  if (move.kind === 'exit') return t(move.removed ? 'chat.worktreeRemoved' : 'chat.worktreeLeft')
  return move.target === null
    ? t('chat.worktreeEnteredNew')
    : t('chat.worktreeEntered', { target: move.target })
}

function WorktreeMoveRow({ move }: { move: WorktreeMove }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <p className="text-warning border-line flex items-center gap-2 border-t pt-2 text-[11px] wrap-anywhere">
      <FolderGit2 aria-hidden size={12} className="shrink-0" />
      {worktreeMoveText(move, t)}
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
    <RefusalRow
      icon={<Repeat aria-hidden size={12} />}
      said={t(event.scope === 'session' ? 'chat.refusalSwapped' : 'chat.refusalSwappedLocally', {
        from: event.originalModel,
        to: event.fallbackModel
      })}
      explanation={event.explanation}
    />
  )
}

/**
 * The line where a model refused and nothing took the turn instead.
 *
 * The worse of the two wearing the quieter symptom, which is why it is drawn at
 * all: after a fallback the reader has an answer and a line naming who gave it,
 * and here the turn simply ends. Without this the log shows nothing, and the
 * silence has to be interpreted — still thinking, dropped by the app, or worth
 * asking again.
 *
 * No second model to name and no scope to describe: with no retry there is no
 * swap. What is left is who declined and, when it said so, why.
 */
function RefusalNoFallbackRow({
  event
}: {
  event: Extract<AgentEvent, { type: 'model_refusal_no_fallback' }>
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <RefusalRow
      icon={<CircleSlash aria-hidden size={12} />}
      said={t('chat.refusalDeclined', { from: event.originalModel })}
      explanation={event.explanation}
    />
  )
}

/**
 * The line where a tool call was refused without anyone being asked.
 *
 * Auto mode's classifier, mostly, and the reason this is drawn: the call it
 * blocked otherwise shows only as a tool that failed, and a mode that decides
 * on the user's behalf has to leave those decisions where they can be read.
 * The reason is the deciding component's own prose, shown as given.
 */
function DeniedRow({
  event
}: {
  event: Extract<AgentEvent, { type: 'permission_denied' }>
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <RefusalRow
      icon={<ShieldX aria-hidden size={12} />}
      said={t(event.byClassifier ? 'chat.deniedByAuto' : 'chat.deniedByRule', {
        tool: event.toolName
      })}
      explanation={event.reason}
    />
  )
}

/**
 * The line where auto mode was given up, which is why the chip moved.
 *
 * The chip changed by itself, and this is the only account of it: the mode it
 * went to, and the SDK's reason when there was one — which plan, model or
 * setting stood in the way.
 */
function AutoFellBackRow({
  event
}: {
  event: Extract<AgentEvent, { type: 'auto_mode_unavailable' }>
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <RefusalRow
      icon={<ZapOff aria-hidden size={12} />}
      said={t('chat.autoFellBack', {
        mode: t(event.fallback === 'acceptEdits' ? 'chat.modeAcceptEdits' : 'chat.modeDefault')
      })}
      explanation={event.reason}
    />
  )
}

/**
 * What the refusal and denial lines are made of.
 *
 * Shared because the lines differ in one sentence and one glyph, and the markup
 * under them is load-bearing — the explanation is a second paragraph, so this
 * is the one row in the quiet register that is a `div` rather than a `p`.
 * Two copies of that would drift the first time either is touched.
 */
function RefusalRow({
  icon,
  said,
  explanation
}: {
  readonly icon: React.ReactNode
  readonly said: string
  /** The model's own prose, drawn as given: display only, never parsed. */
  readonly explanation: string | null
}): React.JSX.Element {
  return (
    <div className="text-ink-faint border-line border-t pt-2 text-[11px]">
      <p className="flex items-center gap-2">
        {icon}
        {said}
      </p>

      {explanation !== null && explanation.trim() !== '' && (
        <p className="mt-1 pl-5 leading-relaxed">{explanation}</p>
      )}
    </div>
  )
}

/*
 * A process that died is said in words, with the SDK's own line kept under
 * them: "exited with code 143" is exact and means nothing to the person reading
 * it, and the words alone would leave nothing to search for.
 */
function ErrorRow({ message }: { message: string }): React.JSX.Element {
  const { t } = useTranslation()
  const code = exitCodeOf(message)

  return (
    <div className="bg-danger-bg text-danger border-danger/25 rounded-[var(--radius-control)] border px-3 py-2">
      {code === null ? (
        <p>{shown(message)}</p>
      ) : (
        <>
          <p>{code > 128 ? t('chat.processStopped') : t('chat.processFailed', { code })}</p>
          <p className="text-ink-faint mt-1 font-mono text-[11px]">{shown(message)}</p>
        </>
      )}
    </div>
  )
}
