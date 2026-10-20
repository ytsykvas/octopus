import { z } from 'zod'

import type { ToolStats } from './events.js'

/**
 * Reading a tool's structured output (`tool_use_result`).
 *
 * The SDK hands it over beside the text the model saw, and it is the only place
 * some facts live: how many lines a `Read` returned, how many files a `Glob`
 * found, a subagent's report without the trailer the CLI appends for the model.
 *
 * Matched by shape rather than by tool, because the message carrying it names
 * only the call it answers — the tool's name is on another message entirely.
 * Every shape is optional, and anything unrecognised reads as nothing: a field
 * the SDK renames costs a summary, never a parse failure.
 */

const Count = z.number().int().nonnegative()

/** `Read` of a text file. Images and notebooks have other shapes, and no lines. */
const ReadSchema = z.object({ type: z.literal('text'), file: z.object({ numLines: Count }) })

/** `Glob` and every mode of `Grep`, which share the file count. */
const SearchSchema = z.object({
  numFiles: Count,
  numLines: Count.optional(),
  numMatches: Count.optional()
})

const AgentDoneSchema = z.object({
  status: z.literal('completed'),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  totalToolUseCount: Count,
  totalTokens: Count,
  totalDurationMs: z.number().nonnegative(),
  resolvedModel: z.string().optional()
})

/** Sent off to run on its own; the report does not come back with this call. */
const AgentAwaySchema = z.object({
  status: z.enum(['async_launched', 'remote_launched']),
  resolvedModel: z.string().optional()
})

/** `TaskCreate`'s structured output — `TaskGet`'s has the same shape. */
const CreatedTaskSchema = z.object({ task: z.object({ id: z.string() }) })

export interface ToolOutput {
  readonly stats?: ToolStats
  readonly report?: string
  readonly taskId?: string
}

export function readToolOutput(output: unknown): ToolOutput {
  const read = ReadSchema.safeParse(output)
  if (read.success) return { stats: { lines: read.data.file.numLines } }

  const search = SearchSchema.safeParse(output)
  if (search.success) {
    const { numFiles, numLines, numMatches } = search.data
    return {
      stats: {
        files: numFiles,
        ...(numLines !== undefined && { lines: numLines }),
        ...(numMatches !== undefined && { matches: numMatches })
      }
    }
  }

  const done = AgentDoneSchema.safeParse(output)
  if (done.success) {
    const report = done.data.content
      .flatMap((block) => (block.type === 'text' && block.text !== undefined ? [block.text] : []))
      .join('\n\n')
    return {
      stats: {
        toolUses: done.data.totalToolUseCount,
        tokens: done.data.totalTokens,
        durationMs: done.data.totalDurationMs,
        ...(done.data.resolvedModel !== undefined && { model: done.data.resolvedModel })
      },
      ...(report !== '' && { report })
    }
  }

  const away = AgentAwaySchema.safeParse(output)
  if (away.success) {
    const { resolvedModel } = away.data
    return {
      stats: { background: true, ...(resolvedModel !== undefined && { model: resolvedModel }) }
    }
  }

  /*
   * The id a later `TaskUpdate` refers to the task by. Another result that
   * happens to name a task the same way (`TaskGet`) gets one too, and that is
   * harmless: the list only reads it off a `TaskCreate`.
   */
  const created = CreatedTaskSchema.safeParse(output)
  if (created.success) return { taskId: created.data.task.id }

  return {}
}
