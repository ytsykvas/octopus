/**
 * A conversation written out for another one to read.
 *
 * The agent's own memory of a chat cannot be handed over (a fork is the only
 * way to carry it, and it carries the same agent), so what moves between two
 * sessions is text: what was asked, what was answered and which files and
 * commands the answer went through. This is that text, built from the
 * transcript the window already holds.
 *
 * No summarising model is involved. The digest is free, instant and the same
 * every time, at the price of not knowing which part matters; the reader is
 * another agent, which can tell.
 *
 * Pure and imports only types, so the renderer may call it — `transcript.ts`
 * itself reaches `node:fs` and must not be imported for a value.
 */

import { z } from 'zod'

import type { ChatEntry } from './transcript.js'

/**
 * Roughly 15k tokens. A long session is hours of work and the reader's context
 * is not free; the newest part and the opening request are the two that earn
 * their place, so those are what a longer chat is cut down to.
 */
export const HANDOFF_LIMIT = 60_000

/** Past this a command or a failure is a log, not a line in a digest. */
const LINE_LIMIT = 160

export interface HandoffMeta {
  /** What the conversation is called, so the reader can place it. */
  readonly title: string
}

/**
 * The one argument of a tool call that says what it was about, in the order of
 * how well each does. Every tool has its own shape, so this reads loosely and
 * a call with none of them is named without a target.
 */
const ToolTargetSchema = z.object({
  file_path: z.string().optional(),
  path: z.string().optional(),
  command: z.string().optional(),
  pattern: z.string().optional(),
  url: z.string().optional(),
  description: z.string().optional()
})

interface Block {
  readonly role: 'user' | 'agent'
  readonly lines: string[]
}

/** The first line, cut to a length a digest can afford. */
function brief(text: string): string {
  const [first = ''] = text.trim().split('\n')

  return first.length > LINE_LIMIT ? `${first.slice(0, LINE_LIMIT)}…` : first
}

function toolLine(name: string, input: unknown): string {
  const parsed = ToolTargetSchema.safeParse(input)
  const target = parsed.success
    ? (parsed.data.file_path ??
      parsed.data.path ??
      parsed.data.command ??
      parsed.data.pattern ??
      parsed.data.url ??
      parsed.data.description)
    : undefined

  return target === undefined ? `- ${name}` : `- ${name}: \`${brief(target)}\``
}

/**
 * The conversation as blocks of one speaker each.
 *
 * Left out on purpose: the model's thinking, tool output (what it did is in
 * the call, and what it found is in what it said next), a subagent's own
 * steps, and everything that was only the interface talking to itself. A tool
 * that failed stays, because a dead end is something the next reader should
 * not walk into again.
 */
function blocksOf(entries: readonly ChatEntry[]): Block[] {
  const blocks: Block[] = []
  // A result names its call by id only, and a failure is no use unnamed.
  const names = new Map<string, string>()

  const add = (role: Block['role'], line: string): void => {
    const last = blocks.at(-1)

    if (last?.role === role && role === 'agent') last.lines.push(line)
    else blocks.push({ role, lines: [line] })
  }

  for (const entry of entries) {
    if (entry.role === 'user') {
      add('user', entry.text.trim())
      continue
    }

    const { event } = entry
    if (event.type === 'text' && event.parentToolUseId === undefined) {
      add('agent', event.text.trim())
    } else if (event.type === 'tool_use' && event.parentToolUseId === undefined) {
      names.set(event.toolUseId, event.name)
      add('agent', toolLine(event.name, event.input))
    } else if (event.type === 'tool_result' && !event.ok && event.parentToolUseId === undefined) {
      const name = names.get(event.toolUseId) ?? 'tool'
      add('agent', `- ${name} failed: ${brief(event.content)}`)
    }
  }

  return blocks
}

function render(block: Block): string {
  return `## ${block.role === 'user' ? 'User' : 'Assistant'}\n\n${block.lines.join('\n\n')}`
}

/**
 * Keeps the opening request and as much of the end as fits.
 *
 * The newest block is always kept, over the limit if it has to be: a digest
 * that ends before the last thing said is worse than a long one.
 */
function fit(rendered: readonly string[], limit: number): string[] {
  const [first, ...rest] = rendered
  if (first === undefined) return []

  const kept: string[] = []
  let used = first.length

  for (const block of rest.toReversed()) {
    if (kept.length > 0 && used + block.length > limit) break
    kept.unshift(block)
    used += block.length
  }

  const omitted = rest.length - kept.length
  if (omitted === 0) return [first, ...kept]

  const note = `_${String(omitted)} messages in between are left out to keep this short._`

  return [first, note, ...kept]
}

/**
 * The transcript as one markdown document, ready to paste into another
 * conversation as its starting context.
 */
export function formatHandoff(
  entries: readonly ChatEntry[],
  meta: HandoffMeta,
  limit: number = HANDOFF_LIMIT
): string {
  const header = [
    `# Earlier conversation: ${meta.title}`,
    'This is the record of a previous session on the same project, pasted so you can pick up where it stopped. ' +
      'Tool output and reasoning are left out; lines starting with "-" are the tools the assistant used. ' +
      'Treat it as background, and check the files before relying on anything it says about them.'
  ].join('\n\n')

  const body = fit(blocksOf(entries).map(render), limit)

  return [header, ...body].join('\n\n')
}
