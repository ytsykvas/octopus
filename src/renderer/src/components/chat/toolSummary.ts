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
