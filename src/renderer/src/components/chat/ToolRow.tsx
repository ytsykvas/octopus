import { Circle, LoaderCircle } from 'lucide-react'
import { memo, useContext } from 'react'
import { useTranslation } from 'react-i18next'

import { readTodos } from '@core/todos.js'

import { DisclosureButton } from '../Disclosure.js'
import { named } from '../diff/invisible.js'
import { shown } from '../diff/shown.js'
import type { Change } from './changeSummary.js'
import { DiffPreview } from './DiffPreview.js'
import { FileLinkContext, useExpanded } from './expansion.js'
import type { LogBlock, ToolCall } from './logBlocks.js'
import { Markdown } from './Markdown.js'
import { OutputPreview } from './OutputPreview.js'
import { TodoChecklist } from './TodoChecklist.js'
import { agentReport, type ResultSummary, summarise, viewOf } from './toolViews.js'
import { workspaceRelative } from './workspacePath.js'

/** How many lines of a change show under a closed row, as Claude Code shows them. */
export const DIFF_PREVIEW_LINES = 10

type CallState = 'running' | 'done' | 'failed' | 'stopped'

const STATE_LABELS = {
  running: 'chat.toolRunning',
  done: 'chat.toolDone',
  failed: 'chat.toolFailed',
  stopped: 'chat.toolStopped'
} as const

/**
 * Where a call is: still going, answered, failed, or left without an answer.
 *
 * "Running" needs the turn to be live as well as the answer to be missing: a
 * call cut off by an interrupt has no answer either, and spinning for ever it
 * would claim work that is not happening.
 */
function stateOf(call: ToolCall, busy: boolean): CallState {
  if (call.result !== null) return call.result.ok ? 'done' : 'failed'
  return busy && !call.settled ? 'running' : 'stopped'
}

/**
 * One tool call, as Claude Code draws it: a mark, the tool, what it acted on,
 * and under it a line saying what came back.
 *
 * Every decision about a particular tool is in `toolViews.ts`; this draws what
 * the view says and knows no tool by name. Clicking the row opens what the line
 * only summarises — the input, the whole output, a subagent's steps and report
 * — and ⌘O opens every row at once.
 *
 * Memoised on the call and the turn's state, because the log re-renders on
 * every streamed token and nothing here changes while text arrives.
 */
export const ToolRow = memo(function ToolRow({
  call,
  busy
}: {
  readonly call: ToolCall
  readonly busy: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useExpanded()
  const links = useContext(FileLinkContext)

  const view = viewOf(call.name)
  const label = view.label(call.name, call.input)
  const state = stateOf(call, busy)
  const summary = summarise(call)
  const todos = readTodos(call.name, call.input)
  const detail = open ? view.detail(call.input) : null
  // A path the workspace's tabs can open, or null for one outside it.
  const openable =
    links === null || label.path === null
      ? null
      : workspaceRelative(links.workspacePath, label.path)
  const target = openable ?? label.target
  const scopeText = label.scope === null ? null : t('chat.toolScope', { scope: label.scope })

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {/* Siblings rather than one button: the path opens the file and the rest
          opens the row, and a button inside a button is invalid markup that
          screen readers and clicks both get wrong. */}
      <div className="flex min-w-0 items-baseline gap-2">
        <DisclosureButton
          open={open}
          onOpenChange={setOpen}
          className="focus-ring flex min-w-0 shrink-0 items-baseline gap-1.5 rounded text-left"
          chevron={{ size: 11, className: 'text-ink-faint self-center' }}
        >
          <StateMark state={state} />
          <span className="text-ink font-medium">{label.name}</span>
          <span className="sr-only">{t(STATE_LABELS[state])}</span>
        </DisclosureButton>

        {openable !== null && links !== null ? (
          <button
            type="button"
            onClick={() => {
              links.onOpenFile(openable, false)
            }}
            onDoubleClick={() => {
              links.onOpenFile(openable, true)
            }}
            title={t('chat.openFile', { path: named(openable) })}
            className="text-ink-soft hover:text-accent focus-ring min-w-0 truncate rounded font-mono text-[11px] hover:underline"
          >
            {shown(openable)}
          </button>
        ) : (
          target !== null && (
            // The tooltip through the plain-text sibling of `shown`: it is laid
            // out by the same bidirectional algorithm as the row, so the raw
            // string there would be the same misreading with a delay.
            <span
              className="text-ink-soft min-w-0 truncate font-mono text-[11px]"
              title={named(label.hint ?? target)}
            >
              {shown(target)}
            </span>
          )
        )}

        {scopeText !== null && (
          // Truncates like the target beside it: a scope is often an absolute path.
          <span
            className="text-ink-faint min-w-0 truncate font-mono text-[11px]"
            title={named(scopeText)}
          >
            {shown(scopeText)}
          </span>
        )}

        {call.change !== null && <ChangeCounts change={call.change} />}
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 pl-5">
        <SummaryLine summary={summary} steps={state === 'running' ? call.steps : null} />

        {todos !== null && <TodoChecklist todos={todos} />}

        {/* The change itself, under the row as the CLI draws it — but not for an
            edit that failed, which changed nothing and says why above. */}
        {call.change !== null && state !== 'failed' && (
          <DiffPreview
            change={call.change}
            context={call.context}
            limit={open ? null : DIFF_PREVIEW_LINES}
          />
        )}

        {open && (
          <>
            {detail !== null && (
              <Section title={t('chat.toolInput')}>
                <pre className="bg-surface border-line text-ink-soft max-h-80 overflow-auto rounded-[var(--radius-control)] border px-2.5 py-1.5 font-mono text-[11px] whitespace-pre-wrap wrap-anywhere">
                  {shown(detail)}
                </pre>
              </Section>
            )}

            {call.steps !== null && <NestedBlocks blocks={call.steps} busy={busy} />}

            {call.result !== null &&
              (call.result.ok && view.output === 'report' ? (
                <Section title={t('chat.agentReport')}>
                  <Markdown text={agentReport(call.result)} />
                </Section>
              ) : (
                (!call.result.ok || view.output === 'raw') && (
                  <Section title={t('chat.toolOutput')}>
                    <OutputPreview result={call.result} />
                  </Section>
                )
              ))}
          </>
        )}
      </div>
    </div>
  )
})

/** The mark at the head of a row: a spinner while it runs, a dot after. */
function StateMark({ state }: { readonly state: CallState }): React.JSX.Element {
  if (state === 'running') {
    return (
      <LoaderCircle
        aria-hidden
        size={11}
        className="text-accent shrink-0 self-center animate-spin motion-reduce:animate-none"
      />
    )
  }

  const tone = { done: 'text-success', failed: 'text-danger', stopped: 'text-ink-faint' }[state]

  return (
    <Circle
      aria-hidden
      size={8}
      fill={state === 'stopped' ? 'none' : 'currentColor'}
      className={`${tone} shrink-0 self-center`}
    />
  )
}

/**
 * How much a change added and removed.
 *
 * The counts describe one occurrence, which is all an `Edit` carries. With
 * `replace_all` that is not a total, and drawing it as one said `+1 −1` over a
 * rename through twelve places — so the number gives way to the fact it cannot
 * state.
 */
function ChangeCounts({ change }: { readonly change: Change }): React.JSX.Element {
  const { t } = useTranslation()

  if (change.everywhere) {
    return (
      <span className="text-ink-faint ml-auto shrink-0 text-[11px]">
        {t('chat.changeEverywhere')}
      </span>
    )
  }

  return (
    <span className="ml-auto shrink-0 font-mono text-[11px]">
      {change.added > 0 && <span className="text-success">+{change.added}</span>}
      {change.added > 0 && change.removed > 0 && ' '}
      {change.removed > 0 && <span className="text-danger">−{change.removed}</span>}
    </span>
  )
}

/**
 * The `⎿` line: what came back, in a few words or a few lines.
 *
 * While a subagent works, its latest step stands here instead — the one sign,
 * with the row closed, that something is happening inside it.
 */
function SummaryLine({
  summary,
  steps
}: {
  readonly summary: ResultSummary
  readonly steps: readonly LogBlock[] | null
}): React.JSX.Element | null {
  const { t } = useTranslation()

  const latest = steps?.findLast((block) => block.kind === 'tool')
  if (latest?.kind === 'tool') {
    const step = viewOf(latest.call.name).label(latest.call.name, latest.call.input)
    const text = step.target === null ? step.name : `${step.name} ${step.target}`
    return (
      <Under>
        <span className="truncate" title={named(text)}>
          {shown(text)}
        </span>
      </Under>
    )
  }

  switch (summary.kind) {
    case 'pending':
    case 'none':
      return null

    case 'failed':
      return (
        <Under tone="text-danger">
          <span className="font-mono whitespace-pre-wrap wrap-anywhere">
            {shown(summary.head.join('\n'))}
          </span>
        </Under>
      )

    case 'output':
      return (
        <Under>
          <span className="flex min-w-0 flex-col">
            <span className="font-mono whitespace-pre-wrap wrap-anywhere">
              {shown(summary.head.join('\n'))}
            </span>
            {summary.more > 0 && <span>{t('chat.resultMoreLines', { count: summary.more })}</span>}
          </span>
        </Under>
      )

    case 'lines':
      return (
        <Under>
          {t(summary.atLeast ? 'chat.resultLinesAtLeast' : 'chat.resultLines', {
            count: summary.count
          })}
        </Under>
      )

    case 'files':
      return <Under>{t('chat.resultFiles', { count: summary.count })}</Under>

    case 'matches':
      return <Under>{t('chat.resultMatches', { count: summary.count })}</Under>

    case 'empty':
      return <Under>{t('chat.resultEmpty')}</Under>

    case 'line':
      return (
        <Under>
          <span className="truncate">{shown(summary.text)}</span>
        </Under>
      )

    case 'agent':
      return summary.background ? (
        <Under>{t('chat.agentBackground')}</Under>
      ) : summary.toolUses === null ? null : (
        <Under>{t('chat.agentToolUses', { count: summary.toolUses })}</Under>
      )
  }
}

/** The `⎿` and what follows it, in the faint register the CLI uses. */
function Under({
  tone = 'text-ink-faint',
  children
}: {
  readonly tone?: string
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <p className={`${tone} -ml-5 flex min-w-0 gap-1.5 text-[11px]`}>
      <span aria-hidden className="text-ink-faint w-3.5 shrink-0 text-right select-none">
        ⎿
      </span>
      {children}
    </p>
  )
}

/** A labelled part of an opened row: its input, its output, a report. */
function Section({
  title,
  children
}: {
  readonly title: string
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex min-w-0 flex-col gap-1" aria-label={title}>
      <h4 className="text-ink-faint text-[11px] font-medium">{title}</h4>
      {children}
    </section>
  )
}

/**
 * What a subagent did, inside the call that started it.
 *
 * The same rows a level down. What it said along the way is one line each —
 * its answer is the report below — and its reasoning stays its own.
 */
function NestedBlocks({
  blocks,
  busy
}: {
  readonly blocks: readonly LogBlock[]
  readonly busy: boolean
}): React.JSX.Element {
  return (
    <div className="border-line flex min-w-0 flex-col gap-1.5 border-l pl-3">
      {blocks.map((block) => {
        if (block.kind === 'tool') return <ToolRow key={block.at} call={block.call} busy={busy} />

        const { entry } = block
        if (entry.role !== 'agent' || entry.event.type !== 'text') return null

        const [first = ''] = entry.event.text.trim().split('\n')
        return (
          <p key={block.at} className="text-ink-faint truncate text-[11px]" title={named(first)}>
            {shown(first)}
          </p>
        )
      })}
    </div>
  )
}
