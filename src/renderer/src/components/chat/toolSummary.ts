import { z } from 'zod'

/**
 * The fields worth showing from a tool call, in the order they are looked for.
 *
 * A tool call is only legible if the row says *what* it acts on, and every
 * tool names that differently. Validated rather than read straight off the
 * object: the input is whatever the model produced, which makes it external
 * data even though it never touched the network (§11.3).
 */
const SummarySchema = z.object({
  file_path: z.string().optional(),
  command: z.string().optional(),
  pattern: z.string().optional(),
  path: z.string().optional(),
  url: z.string().optional(),
  description: z.string().optional()
})

const ORDER = ['file_path', 'command', 'pattern', 'path', 'url', 'description'] as const

/** The tool the agent hands a finished plan to, and the field it puts it in. */
const PLAN_SCHEMA = z.object({ plan: z.string().min(1) })

/**
 * The plan itself, when a tool call is the agent presenting one.
 *
 * `ExitPlanMode` is the only way a plan reaches us: in plan mode the agent
 * writes no prose and calls this instead, with the whole plan as an argument.
 * Summarised like any other tool call it disappeared entirely — the summary
 * looks for `file_path`, `command` and their like, and a plan has none of them,
 * so the row showed a tool name and nothing else while the plan sat inside it.
 */
export function readPlan(toolName: string, input: unknown): string | null {
  if (toolName !== 'ExitPlanMode') return null

  const parsed = PLAN_SCHEMA.safeParse(input)
  return parsed.success ? parsed.data.plan : null
}

/**
 * What a plan calls itself — its first heading, or its first line failing that.
 *
 * Used to name the plan when asking for it to be carried out, so the request
 * says which one it means. A conversation can hold several plans by the time
 * anyone goes back to one, and "the plan above" would be whichever the agent
 * decided that meant.
 *
 * Trimmed to a length that still fits a sentence: this is a label, and a plan
 * whose first line is a paragraph would otherwise become the whole message.
 */
export function planTitle(plan: string): string {
  const first = plan
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find((line) => line !== '')

  if (first === undefined) return ''
  return first.length > 80 ? `${first.slice(0, 80).trimEnd()}…` : first
}

/** What a tool was asked to act on, or null when nothing in it reads as an answer. */
export function describeToolInput(input: unknown): string | null {
  const parsed = SummarySchema.safeParse(input)
  if (!parsed.success) return null

  for (const key of ORDER) {
    const value = parsed.data[key]?.trim()
    if (value !== undefined && value !== '') return value
  }

  return null
}
