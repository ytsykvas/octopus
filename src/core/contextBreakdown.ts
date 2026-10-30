/**
 * What fills the context window, narrowed from the reply that measures it.
 *
 * `getContextUsage` is documented as the structured twin of `/context`, and
 * `readContextUsage` already holds it for the percentage — so this reads the
 * same reply rather than asking again, which would cost another 650ms. It keeps
 * what a panel can draw and leaves the rest, as `usage.ts` does for `/usage`:
 * the CLI is versioned apart from this package, so every part is read on its
 * own and a part that does not parse costs its section, never the reading.
 *
 * zod pulls in nothing from Node, so the renderer may import values from here;
 * the panel takes the category ids to label them.
 */

import { z } from 'zod'

/**
 * The kinds of row that occupy the window, by the id the CLI gives them.
 *
 * The buffer, free space and the deferred tool schemas are not here on purpose:
 * none of them is in the window, and a panel about what fills it would only
 * show them as noise. An id this list does not know is dropped, since the SDK
 * says a later CLI may add values and to treat an unknown one as absent.
 */
export const CONTEXT_CATEGORY_IDS = [
  'system_prompt',
  'system_tools',
  'mcp_tools',
  'mcp_instructions',
  'custom_agents',
  'memory_files',
  'skills',
  'messages'
] as const
export type ContextCategoryId = (typeof CONTEXT_CATEGORY_IDS)[number]

/** How many tools the panel names: a long tail of small ones says nothing. */
export const TOP_TOOLS = 5

export interface ContextRow {
  readonly name: string
  readonly tokens: number
}

export interface ContextBreakdown {
  readonly categories: readonly { readonly id: ContextCategoryId; readonly tokens: number }[]
  readonly memoryFiles: readonly { readonly path: string; readonly tokens: number }[]
  readonly mcpServers: readonly ContextRow[]
  readonly tools: readonly ContextRow[]
}

const CategorySchema = z.looseObject({
  id: z.enum(CONTEXT_CATEGORY_IDS),
  tokens: z.number(),
  kind: z.literal('used')
})

const MemoryFileSchema = z.looseObject({ path: z.string(), tokens: z.number() })

const McpToolSchema = z.looseObject({
  serverName: z.string(),
  tokens: z.number(),
  isLoaded: z.boolean().optional()
})

const McpInstructionSchema = z.looseObject({ serverName: z.string(), tokens: z.number() })

const ToolCallSchema = z.looseObject({
  name: z.string(),
  callTokens: z.number(),
  resultTokens: z.number()
})

const ReplySchema = z.looseObject({
  categories: z.array(z.unknown()),
  memoryFiles: z.unknown().optional(),
  mcpTools: z.unknown().optional(),
  mcpInstructions: z.unknown().optional(),
  messageBreakdown: z.unknown().optional()
})

/**
 * The entries of a list that parse, in order — a bad one is dropped, its
 * neighbours kept. A list that is not a list at all is empty.
 */
function entriesOf<T extends z.ZodType>(schema: T, list: unknown): z.infer<T>[] {
  if (!Array.isArray(list)) return []

  return list.flatMap((entry: unknown) => {
    const parsed = schema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

/** Heaviest first; `sort` is stable, so equal weights keep the order they came in. */
function heaviestFirst<T extends { readonly tokens: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.tokens - a.tokens)
}

/** Tokens added up under a name, in the order the names first appear. */
function summedByName(rows: readonly { name: string; tokens: number }[]): ContextRow[] {
  const sums = new Map<string, number>()
  for (const row of rows) sums.set(row.name, (sums.get(row.name) ?? 0) + row.tokens)

  return [...sums].map(([name, tokens]) => ({ name, tokens }))
}

/**
 * The breakdown a `getContextUsage` reply holds, or null when it holds none.
 *
 * Null when the reply is not an object with a list of categories, and when
 * nothing is left of that list once the rows outside the window are filtered —
 * a panel with no categories has nothing to open on.
 */
export function breakdownFrom(reply: unknown): ContextBreakdown | null {
  const parsed = ReplySchema.safeParse(reply)
  if (!parsed.success) return null

  const categories = heaviestFirst(
    entriesOf(CategorySchema, parsed.data.categories)
      .filter((category) => category.tokens > 0)
      .map(({ id, tokens }) => ({ id, tokens }))
  )
  if (categories.length === 0) return null

  const memoryFiles = heaviestFirst(
    entriesOf(MemoryFileSchema, parsed.data.memoryFiles)
      .filter((file) => file.tokens > 0)
      .map(({ path, tokens }) => ({ path, tokens }))
  )

  const servers = [
    ...entriesOf(McpToolSchema, parsed.data.mcpTools).filter((tool) => tool.isLoaded !== false),
    ...entriesOf(McpInstructionSchema, parsed.data.mcpInstructions)
  ].map(({ serverName, tokens }) => ({ name: serverName, tokens }))

  const breakdown = z
    .looseObject({ toolCallsByType: z.unknown().optional() })
    .safeParse(parsed.data.messageBreakdown)
  const tools = breakdown.success
    ? entriesOf(ToolCallSchema, breakdown.data.toolCallsByType).map((tool) => ({
        name: tool.name,
        tokens: tool.callTokens + tool.resultTokens
      }))
    : []

  return {
    categories,
    memoryFiles,
    mcpServers: heaviestFirst(summedByName(servers)),
    tools: heaviestFirst(tools).slice(0, TOP_TOOLS)
  }
}
