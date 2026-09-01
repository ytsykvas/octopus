/**
 * The `/usage` answer, in a shape of our own.
 *
 * The SDK has the whole thing structured — `usage_EXPERIMENTAL_…` is documented
 * as "the structured data behind the `/usage` command" — so nothing here parses
 * prose. What this module does is narrow it: the response is wider than the
 * card needs, wider than its own type, and explicitly unstable.
 *
 * Our own shape rather than the SDK's, and for a stronger reason than the usual
 * isolation. The report is written to the transcript, and the SDK says of this
 * API that it "may change or be removed in any release without notice". Storing
 * the response as it arrives would put a moving target in a file we read back
 * months later; storing this means an SDK change breaks the reader alone.
 *
 * zod pulls in nothing from Node, so the renderer may import values from here.
 */

import { z } from 'zod'

/**
 * Tolerant on purpose, in both directions.
 *
 * `looseObject` so a field added upstream travels through untouched instead of
 * failing the parse, and a default on every number so a field *removed* upstream
 * costs one row of the card rather than the whole card. The strict reading is
 * the wrong trade here: this draws an answer to a question the user asked, and
 * a card that vanishes because one count went missing tells them nothing at all.
 */
const ModelUsageSchema = z.looseObject({
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  cacheReadInputTokens: z.number().default(0),
  cacheCreationInputTokens: z.number().default(0)
})

const SessionSchema = z.looseObject({
  total_cost_usd: z.number().default(0),
  total_api_duration_ms: z.number().default(0),
  total_duration_ms: z.number().default(0),
  total_lines_added: z.number().default(0),
  total_lines_removed: z.number().default(0),
  /**
   * Where the token counts come from — there are none on `session` itself.
   *
   * The SDK calls this "the correct field for token/cost accounting" because it
   * includes what `usage` leaves out: subagents, sidechains and compaction.
   */
  model_usage: z.record(z.string(), ModelUsageSchema).default({})
})

const WindowSchema = z.looseObject({
  utilization: z.number().nullable().default(null),
  resets_at: z.string().nullable().default(null)
})

/** A weekly window the server named itself, e.g. `Fable`. */
const ModelScopedSchema = z.looseObject({
  display_name: z.string(),
  utilization: z.number().nullable().default(null),
  resets_at: z.string().nullable().default(null)
})

const RateLimitsSchema = z.looseObject({
  five_hour: WindowSchema.nullish(),
  seven_day: WindowSchema.nullish(),
  seven_day_opus: WindowSchema.nullish(),
  seven_day_sonnet: WindowSchema.nullish(),
  seven_day_oauth_apps: WindowSchema.nullish(),
  model_scoped: z.array(ModelScopedSchema).nullish(),
  extra_usage: z
    .looseObject({
      is_enabled: z.boolean().default(false),
      monthly_limit: z.number().nullable().default(null),
      used_credits: z.number().nullable().default(null),
      utilization: z.number().nullable().default(null),
      currency: z.string().nullable().default(null)
    })
    .nullish()
})

const ShareSchema = z.looseObject({ name: z.string(), pct: z.number() })

const BehaviorSchema = z.looseObject({
  key: z.string(),
  pct: z.number(),
  count: z.number().default(0)
})

const ContributingWindowSchema = z.looseObject({
  request_count: z.number().default(0),
  session_count: z.number().default(0),
  behaviors: z.array(BehaviorSchema).default([]),
  agents: z.array(ShareSchema).default([]),
  skills: z.array(ShareSchema).default([]),
  plugins: z.array(ShareSchema).default([]),
  mcp_servers: z.array(ShareSchema).default([])
})

const UsageResponseSchema = z.looseObject({
  session: SessionSchema,
  subscription_type: z.string().nullable().default(null),
  rate_limits_available: z.boolean().default(false),
  rate_limits: RateLimitsSchema.nullish(),
  behaviors: z
    .looseObject({ day: ContributingWindowSchema, week: ContributingWindowSchema })
    .nullish()
})

/** What one session has spent, as the card lists it. */
const UsageSessionSchema = z.object({
  /**
   * What these tokens would have cost through the API.
   *
   * Not money, and the SDK says so — "an estimate, not a billing statement",
   * and a subscription never pays it. Shown all the same, because `/usage` is
   * the one surface where the question being asked is exactly this one. It
   * stays out of the workspace list and the turn footer, where it would be a
   * number in a currency beside things that are not.
   */
  costUsd: z.number(),
  apiDurationMs: z.number(),
  wallDurationMs: z.number(),
  linesAdded: z.number(),
  linesRemoved: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number()
})

/**
 * The windows the card is willing to name, in the order it draws them.
 *
 * An allowlist rather than everything the response holds, and measured rather
 * than cautious: a live response carried nine windows the SDK's own type does
 * not declare — `seven_day_cowork`, `tangelo`, `iguana_necktie` among them.
 * Drawn as they come, those internal codenames would be labels in front of the
 * user, in an interface claiming to say how much of the plan is left.
 */
const NAMED_WINDOWS = [
  'five_hour',
  'seven_day',
  'seven_day_opus',
  'seven_day_sonnet',
  'seven_day_oauth_apps'
] as const

/** The key every server-labelled weekly window shares. */
export const MODEL_SCOPED = 'model_scoped'

/** One plan window, as a bar draws it. */
export const UsageLimitSchema = z.object({
  /**
   * Which window, for the localised name. `model_scoped` uses `label` instead.
   *
   * An enum rather than a string so the renderer's table of names is exhaustive
   * — a window added here without a name for it fails to compile rather than
   * drawing its own key at someone.
   */
  key: z.enum([...NAMED_WINDOWS, MODEL_SCOPED]),
  /** The server's own name for the window, when it sent one. */
  label: z.string().nullable(),
  /** Share of the window used, 0–100. */
  utilization: z.number(),
  resetsAt: z.string().nullable()
})

const UsageShareSchema = z.object({ name: z.string(), pct: z.number() })

const UsageBehaviorSchema = z.object({ key: z.string(), pct: z.number(), count: z.number() })

/** What has been eating the limit over one span of time. */
const ContributingSchema = z.object({
  requests: z.number(),
  sessions: z.number(),
  behaviors: z.array(UsageBehaviorSchema),
  skills: z.array(UsageShareSchema),
  agents: z.array(UsageShareSchema),
  plugins: z.array(UsageShareSchema),
  mcpServers: z.array(UsageShareSchema)
})

export const UsageReportSchema = z.object({
  session: UsageSessionSchema,
  /** `pro`, `max`, `team`, `enterprise` — or null on an API-key session. */
  subscriptionType: z.string().nullable(),
  /**
   * Whether plan windows apply at all.
   *
   * Kept beside the list rather than inferred from it being empty, because the
   * two mean different things: an API-key, Bedrock or Vertex session has no
   * plan to be near the end of, while a subscription that reported no windows
   * is a reading that failed. One draws a sentence, the other draws nothing.
   */
  limitsApply: z.boolean(),
  limits: z.array(UsageLimitSchema),
  extraUsage: z
    .object({
      monthlyLimit: z.number().nullable(),
      usedCredits: z.number().nullable(),
      utilization: z.number().nullable()
    })
    .nullable(),
  contributing: z.object({ day: ContributingSchema, week: ContributingSchema }).nullable()
})

export type UsageReport = z.infer<typeof UsageReportSchema>
export type UsageLimit = z.infer<typeof UsageLimitSchema>

/**
 * What the sidebar draws, taken out of a full report.
 *
 * Every window, not two. They arrive in one answer and the block used to keep
 * four numbers out of it — so an account with a weekly window per model saw the
 * `/usage` card name it and the sidebar not. There is no second request to
 * save by dropping the rest.
 *
 * Dated at the moment it was read. The figures are a snapshot of something that
 * moves, and `resetsAt` alone can only say that a window has since emptied —
 * not how old the share beside it is.
 */
export const UsageWindowsSchema = z.object({
  limits: z.array(UsageLimitSchema),
  /**
   * Whether plan windows apply at all.
   *
   * Carried through from the report for the reason it is carried there: an
   * API-key, Bedrock or Vertex session has no plan to be near the end of, and
   * an empty list is a different statement from a session that has no plan.
   */
  limitsApply: z.boolean(),
  readAt: z.iso.datetime()
})

export type UsageWindows = z.infer<typeof UsageWindowsSchema>

export function windowsFrom(report: UsageReport, readAt: string): UsageWindows {
  return { limits: report.limits, limitsApply: report.limitsApply, readAt }
}

export type UsageContributing = z.infer<typeof ContributingSchema>

type Response = z.infer<typeof UsageResponseSchema>

/** Every window the card will draw, named ones first, in a fixed order. */
function toLimits(limits: NonNullable<Response['rate_limits']>): UsageLimit[] {
  const named = [
    limits.five_hour,
    limits.seven_day,
    limits.seven_day_opus,
    limits.seven_day_sonnet,
    limits.seven_day_oauth_apps
  ]

  const drawn: UsageLimit[] = []

  for (const [index, key] of NAMED_WINDOWS.entries()) {
    const window = named[index]
    // A window with no share is one the account does not have. The SDK sends
    // the key with a null utilization rather than leaving it out.
    if (window?.utilization == null) continue
    drawn.push({ key, label: null, utilization: window.utilization, resetsAt: window.resets_at })
  }

  for (const window of limits.model_scoped ?? []) {
    if (window.utilization == null) continue
    drawn.push({
      key: MODEL_SCOPED,
      label: window.display_name,
      utilization: window.utilization,
      resetsAt: window.resets_at
    })
  }

  return drawn
}

/** One span of the local scan, renamed into our own vocabulary. */
function toContributing(window: z.infer<typeof ContributingWindowSchema>): UsageContributing {
  const share = (
    items: readonly { name: string; pct: number }[]
  ): { name: string; pct: number }[] => items.map((item) => ({ name: item.name, pct: item.pct }))

  return {
    requests: window.request_count,
    sessions: window.session_count,
    behaviors: window.behaviors.map((item) => ({
      key: item.key,
      pct: item.pct,
      count: item.count
    })),
    skills: share(window.skills),
    agents: share(window.agents),
    plugins: share(window.plugins),
    mcpServers: share(window.mcp_servers)
  }
}

/**
 * The report a card can draw, or null when the response was not one.
 *
 * Null rather than a throw, on the same grounds as `readQuestions`: this runs to
 * answer a command someone typed, and a response that arrived in an unexpected
 * shape has to leave the conversation standing.
 *
 * Pure, so it is tested against literals rather than against a live session —
 * which matters more here than usual, since the awkward cases are accounts
 * nobody testing this is likely to hold.
 */
export function toUsageReport(response: unknown): UsageReport | null {
  const parsed = UsageResponseSchema.safeParse(response)
  if (!parsed.success) return null

  const { session, rate_limits: limits, behaviors } = parsed.data

  const models = Object.values(session.model_usage)
  const sum = (read: (usage: z.infer<typeof ModelUsageSchema>) => number): number =>
    models.reduce((total, usage) => total + read(usage), 0)

  const extra = limits?.extra_usage

  return {
    session: {
      costUsd: session.total_cost_usd,
      apiDurationMs: session.total_api_duration_ms,
      wallDurationMs: session.total_duration_ms,
      linesAdded: session.total_lines_added,
      linesRemoved: session.total_lines_removed,
      inputTokens: sum((usage) => usage.inputTokens),
      outputTokens: sum((usage) => usage.outputTokens),
      cacheReadTokens: sum((usage) => usage.cacheReadInputTokens),
      cacheWriteTokens: sum((usage) => usage.cacheCreationInputTokens)
    },
    subscriptionType: parsed.data.subscription_type,
    limitsApply: parsed.data.rate_limits_available && limits != null,
    limits: limits ? toLimits(limits) : [],
    // Only when it is switched on: the fields are sent either way, and an
    // off account reads them all as null, which would draw an empty row.
    extraUsage:
      extra?.is_enabled === true
        ? {
            monthlyLimit: extra.monthly_limit,
            usedCredits: extra.used_credits,
            utilization: extra.utilization
          }
        : null,
    contributing: behaviors
      ? { day: toContributing(behaviors.day), week: toContributing(behaviors.week) }
      : null
  }
}
