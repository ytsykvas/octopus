import { z } from 'zod'

import type { TaskView } from '@core/backgroundTasks.js'
import { countLines, type ToolStats } from '@core/events.js'

import type { LogBlock, ToolCall, ToolResult } from './logBlocks.js'
import { readFailure } from './toolFailure.js'
import { describeToolInput } from './toolSummary.js'

/**
 * How each tool is drawn as a row, in one place.
 *
 * Every per-tool decision lives in this table — what the row names, what the
 * line under it says, what opening it shows — so the row itself holds no
 * branch on a tool's name. Spread over the components, the same `switch`
 * would have been written three times and drifted apart the first time a tool
 * was added to one of them.
 */

export type ToolKind =
  | 'read'
  | 'change'
  | 'notebook'
  | 'bash'
  | 'grep'
  | 'glob'
  | 'fetch'
  | 'search'
  | 'agent'
  | 'todos'
  | 'task'
  | 'mcp'
  | 'other'

/** What a row says about the call before anything came back. */
export interface ToolLabel {
  /** The tool as the CLI names it; never translated. */
  readonly name: string
  /** What it acted on, in a line: a path, a command, a pattern. */
  readonly target: string | null
  /** Where a search looked, drawn as "in …" after the target. */
  readonly scope: string | null
  /** A file the row can open. */
  readonly path: string | null
  /** More about the call, for the tooltip: a command's description, an agent's type. */
  readonly hint: string | null
}

/** The line under a row, saying what came back. */
export type ResultSummary =
  | { readonly kind: 'pending' }
  | { readonly kind: 'failed'; readonly head: readonly string[] }
  | { readonly kind: 'lines'; readonly count: number; readonly atLeast: boolean }
  | { readonly kind: 'files'; readonly count: number }
  | { readonly kind: 'matches'; readonly count: number }
  | { readonly kind: 'output'; readonly head: readonly string[]; readonly more: number }
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'agent'
      readonly toolUses: number | null
      readonly background: boolean
    }
  | { readonly kind: 'line'; readonly text: string }
  /** Said by what the row draws instead: a diff, a checklist. */
  | { readonly kind: 'none' }

export interface ToolView {
  readonly label: (name: string, input: unknown) => ToolLabel
  /** Only ever asked of a call that has a successful result; see `summarise`. */
  readonly summary: (result: ToolResult) => ResultSummary
  /** What opening the row shows of the call's input; null when the row already says it. */
  readonly detail: (input: unknown) => string | null
  /** What opening the row shows of what came back. */
  readonly output: 'raw' | 'report' | 'none'
}

/** How many lines of output the row shows before "… +N lines". */
export const HEAD_LINES = 4

/**
 * An output without what the harness appended for the model.
 *
 * A `Read` comes back with a `<system-reminder>` after the file, and counted as
 * lines of it, it made every file a dozen lines longer than it was.
 */
export function cleanOutput(content: string): string {
  return content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trimEnd()
}

/** The lines an output had in all: the stored count when only its head was kept. */
function totalLines(result: ToolResult, clean: string): number {
  return result.lineCount ?? countLines(clean)
}

/** The first lines of an output and how many more there were. */
function outputHead(result: ToolResult): ResultSummary {
  const clean = cleanOutput(result.content)
  if (clean === '') return { kind: 'empty' }

  const head = clean.split('\n').slice(0, HEAD_LINES)
  return { kind: 'output', head, more: Math.max(0, totalLines(result, clean) - head.length) }
}

/** The first line, short enough to sit under a row. */
function firstLine(result: ToolResult): ResultSummary {
  const [first = ''] = cleanOutput(result.content).split('\n')
  if (first.trim() === '') return { kind: 'empty' }
  return { kind: 'line', text: first.length > 120 ? `${first.slice(0, 120)}…` : first }
}

const stat = (
  result: ToolResult,
  key: keyof Omit<ToolStats, 'background' | 'model'>
): number | null => result.stats?.[key] ?? null

/*
 * The inputs each label reads. Validated rather than read straight off the
 * object: the input is whatever the model produced, which makes it external
 * data even though it never touched the network.
 */
const PathInput = z.object({ file_path: z.string().min(1) })
const NotebookInput = z.object({ notebook_path: z.string().min(1) })
const CommandInput = z.object({ command: z.string(), description: z.string().optional() })
const SearchInput = z.object({ pattern: z.string(), path: z.string().optional() })
const UrlInput = z.object({ url: z.string() })
const QueryInput = z.object({ query: z.string() })
const AgentInput = z.object({
  description: z.string().optional(),
  subagent_type: z.string().optional()
})
const TaskCreateInput = z.object({ subject: z.string() })
const TaskUpdateInput = z.object({ taskId: z.string(), status: z.string().optional() })

/** The input as it was sent, for tools whose row cannot say all of it. */
const asJson = (input: unknown): string | null =>
  input === undefined ? null : JSON.stringify(input, null, 2)

/** Nothing more than the row already says. */
const nothing = (): null => null

/** The whole command, which the row cuts to its first line. */
const fullCommand = (input: unknown): string | null => {
  const parsed = CommandInput.safeParse(input)
  return parsed.success ? parsed.data.command : asJson(input)
}

/** A label with only a name and a target; the rest of the fields left empty. */
function plain(name: string, target: string | null, more: Partial<ToolLabel> = {}): ToolLabel {
  return { name, target, scope: null, path: null, hint: null, ...more }
}

/** Anything without a view of its own: the first field that reads as a target. */
const generic = (name: string, input: unknown): ToolLabel => plain(name, describeToolInput(input))

const fileLabel =
  (schema: typeof PathInput | typeof NotebookInput) =>
  (name: string, input: unknown): ToolLabel => {
    const parsed = schema.safeParse(input)
    if (!parsed.success) return generic(name, input)
    const path = 'file_path' in parsed.data ? parsed.data.file_path : parsed.data.notebook_path
    return plain(name, path, { path })
  }

const searchLabel =
  (quoted: boolean) =>
  (name: string, input: unknown): ToolLabel => {
    const parsed = SearchInput.safeParse(input)
    if (!parsed.success) return generic(name, input)
    const { pattern, path } = parsed.data
    return plain(name, quoted ? `"${pattern}"` : pattern, { scope: path ?? null })
  }

/** Lines when the tool counted them, and otherwise the ones it printed. */
const readSummary = (result: ToolResult): ResultSummary => {
  const counted = stat(result, 'lines')
  if (counted !== null) return { kind: 'lines', count: counted, atLeast: false }

  const clean = cleanOutput(result.content)
  return {
    kind: 'lines',
    count: totalLines(result, clean),
    // Cut on disk before the count was kept: all that is known is a floor.
    atLeast: result.truncated === true && result.lineCount === undefined
  }
}

export const TOOL_VIEWS: Record<ToolKind, ToolView> = {
  read: { label: fileLabel(PathInput), summary: readSummary, detail: nothing, output: 'raw' },

  // Said by the diff the row draws under itself.
  change: {
    label: fileLabel(PathInput),
    summary: () => ({ kind: 'none' }),
    detail: nothing,
    output: 'none'
  },

  notebook: { label: fileLabel(NotebookInput), summary: firstLine, detail: asJson, output: 'raw' },

  bash: {
    label: (name, input) => {
      const parsed = CommandInput.safeParse(input)
      if (!parsed.success) return generic(name, input)
      const [first = ''] = parsed.data.command.trim().split('\n')
      return plain(name, first, { hint: parsed.data.description ?? null })
    },
    summary: outputHead,
    detail: fullCommand,
    output: 'raw'
  },

  grep: {
    label: searchLabel(true),
    summary: (result) => {
      const matches = stat(result, 'matches')
      if (matches !== null) return { kind: 'matches', count: matches }
      const lines = stat(result, 'lines')
      if (lines !== null) return { kind: 'lines', count: lines, atLeast: false }
      const files = stat(result, 'files')
      return files === null ? outputHead(result) : { kind: 'files', count: files }
    },
    detail: asJson,
    output: 'raw'
  },

  glob: {
    label: searchLabel(false),
    summary: (result) => {
      const files = stat(result, 'files')
      return files === null ? outputHead(result) : { kind: 'files', count: files }
    },
    detail: nothing,
    output: 'raw'
  },

  fetch: {
    label: (name, input) => {
      const parsed = UrlInput.safeParse(input)
      if (!parsed.success) return generic(name, input)
      return plain(name, hostOf(parsed.data.url), { hint: parsed.data.url })
    },
    summary: firstLine,
    detail: asJson,
    output: 'raw'
  },

  search: {
    label: (name, input) => {
      const parsed = QueryInput.safeParse(input)
      return parsed.success ? plain(name, `"${parsed.data.query}"`) : generic(name, input)
    },
    summary: firstLine,
    detail: asJson,
    output: 'raw'
  },

  agent: {
    label: (name, input) => {
      const parsed = AgentInput.safeParse(input)
      if (!parsed.success) return generic(name, input)
      return plain(name, parsed.data.description ?? null, {
        hint: parsed.data.subagent_type ?? null
      })
    },
    summary: (result) => ({
      kind: 'agent',
      toolUses: stat(result, 'toolUses'),
      background: result.stats?.background === true
    }),
    detail: asJson,
    output: 'report'
  },

  // The checklist under the row is the whole of what it says.
  todos: {
    label: (name) => plain(name, null),
    summary: () => ({ kind: 'none' }),
    detail: nothing,
    output: 'none'
  },

  task: {
    label: (name, input) => {
      const created = TaskCreateInput.safeParse(input)
      if (created.success) return plain(name, created.data.subject)
      const updated = TaskUpdateInput.safeParse(input)
      if (!updated.success) return generic(name, input)
      const { taskId, status } = updated.data
      return plain(name, status === undefined ? `#${taskId}` : `#${taskId} → ${status}`)
    },
    summary: firstLine,
    detail: asJson,
    output: 'raw'
  },

  mcp: {
    // `mcp__server__tool` reads as the server and the tool, the way the CLI
    // prints it, rather than as an identifier with its separators showing.
    label: (name, input) => {
      const [, server = '', ...tool] = name.split('__')
      return plain(`${server} · ${tool.join('__')}`, describeToolInput(input))
    },
    summary: outputHead,
    detail: asJson,
    output: 'raw'
  },

  other: { label: generic, summary: outputHead, detail: asJson, output: 'raw' }
}

const KINDS: Readonly<Record<string, ToolKind>> = {
  Read: 'read',
  Edit: 'change',
  Write: 'change',
  MultiEdit: 'change',
  NotebookEdit: 'notebook',
  Bash: 'bash',
  Grep: 'grep',
  Glob: 'glob',
  WebFetch: 'fetch',
  WebSearch: 'search',
  Task: 'agent',
  Agent: 'agent',
  TodoWrite: 'todos',
  TaskCreate: 'task',
  TaskUpdate: 'task'
}

export function kindOf(name: string): ToolKind {
  return KINDS[name] ?? (name.startsWith('mcp__') ? 'mcp' : 'other')
}

export function viewOf(name: string): ToolView {
  return TOOL_VIEWS[kindOf(name)]
}

/** A call in one line, the way a `⎿` line or a list of steps names it. */
export function stepText(name: string, input: unknown): string {
  const label = viewOf(name).label(name, input)
  return label.target === null ? label.name : `${label.name} ${label.target}`
}

/** A subagent's latest call in one line, or null before it has made one. */
export function latestStep(steps: readonly LogBlock[] | null): string | null {
  const latest = steps?.findLast((block) => block.kind === 'tool')
  return latest?.kind === 'tool' ? stepText(latest.call.name, latest.call.input) : null
}

/** A URL's host, or the URL itself when it does not parse as one. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/**
 * The line under a row.
 *
 * A failure reads the same for every tool — the head of what went wrong — so
 * it is decided here rather than in each view.
 */
export function summarise(call: ToolCall): ResultSummary {
  const { result } = call
  if (result === null) return { kind: 'pending' }

  if (!result.ok) {
    return { kind: 'failed', head: readFailure(result.content).split('\n').slice(0, 3) }
  }

  return viewOf(call.name).summary(result)
}

/**
 * A subagent's report: its own words, or — for a conversation recorded before
 * they were kept apart — the result's text with the CLI's trailer taken off.
 *
 * A call sent to the background is answered at once with the CLI's launch
 * notice, which is metadata for the model and asks never to be quoted. Its
 * report comes with the task's end instead, so it is read from the task —
 * once it is over, since while it runs the task's summary is the model's
 * sentence about progress. Null until there is a report to show.
 */
export function agentReport(result: ToolResult, task: TaskView | null): string | null {
  if (result.stats?.background === true) {
    return task === null || task.status === 'running' ? null : task.summary
  }

  if (result.report !== undefined) return result.report

  return result.content
    .replace(/<usage>[\s\S]*?<\/usage>/g, '')
    .replace(/^agentId: .*$/gm, '')
    .trim()
}
