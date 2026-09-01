import { describe, expect, it } from 'vitest'

import { MODEL_SCOPED, toUsageReport, windowsFrom } from './usage.js'

/**
 * The response as CLI 2.1.247 actually sent it, trimmed.
 *
 * Taken from a live session rather than written from the type, and it is a
 * different object from the one the type describes. What the type does not say:
 *
 * - **eight windows it does not declare**, `nimbus_quill` among them — and that
 *   one arrives with a real share rather than a null, so nothing but the
 *   allowlist keeps it off the card;
 * - **dollar fields on every window**, all null on a subscription;
 * - a second `limits` array saying the same thing in another vocabulary, a
 *   `spend` block, `member_dashboard_available`, and seven more fields on
 *   `extra_usage` than the type admits to;
 * - **skill names carry no leading slash** — `core-module`, not `/core-module`.
 *
 * Trimmed only by shortening the lists; no field has been removed, because the
 * fields nobody asked for are the point of the fixture.
 */
const LIVE = {
  session: {
    total_cost_usd: 0,
    total_api_duration_ms: 0,
    total_duration_ms: 695,
    total_lines_added: 0,
    total_lines_removed: 0,
    model_usage: {}
  },
  subscription_type: 'max',
  rate_limits_available: true,
  rate_limits: {
    five_hour: {
      utilization: 50,
      resets_at: '2026-08-27T19:09:59.812143+00:00',
      limit_dollars: null,
      used_dollars: null,
      remaining_dollars: null
    },
    seven_day: {
      utilization: 4,
      resets_at: '2026-09-02T21:59:59.812171+00:00',
      limit_dollars: null,
      used_dollars: null,
      remaining_dollars: null
    },
    seven_day_oauth_apps: null,
    seven_day_opus: null,
    seven_day_sonnet: null,
    seven_day_cowork: null,
    tangelo: null,
    iguana_necktie: null,
    nimbus_quill: {
      utilization: 0,
      resets_at: null,
      limit_dollars: null,
      used_dollars: null,
      remaining_dollars: null
    },
    amber_ladder: null,
    extra_usage: {
      is_enabled: false,
      monthly_limit: null,
      used_credits: null,
      utilization: null,
      currency: null,
      decimal_places: null,
      disabled_reason: null,
      user_disabled: true,
      spend_limit_reached: false,
      credits_ever_enabled: true,
      daily: null,
      weekly: null
    },
    limits: [
      {
        kind: 'session',
        group: 'session',
        percent: 50,
        severity: 'normal',
        resets_at: '2026-08-27T19:09:59.812143+00:00',
        scope: null,
        is_active: true
      },
      {
        kind: 'weekly_scoped',
        group: 'weekly',
        percent: 5,
        severity: 'normal',
        resets_at: '2026-09-02T21:59:59.812528+00:00',
        scope: { model: { id: null, display_name: 'Fable' }, surface: null },
        is_active: false
      }
    ],
    spend: {
      used: { amount_minor: 0, currency: 'USD', exponent: 2 },
      limit: null,
      percent: 0,
      severity: 'normal',
      enabled: false,
      can_purchase_credits: false,
      can_toggle: false
    },
    member_dashboard_available: false,
    model_scoped: [
      { display_name: 'Fable', utilization: 5, resets_at: '2026-09-02T21:59:59.812528+00:00' }
    ]
  },
  behaviors: {
    day: {
      request_count: 206,
      session_count: 1,
      behaviors: [
        { key: 'subagent_heavy', pct: 100, count: 1 },
        { key: 'long_context', pct: 73, count: 122 }
      ],
      agents: [{ name: 'Explore', pct: 15 }],
      skills: [{ name: 'core-module', pct: 68 }],
      plugins: [],
      mcp_servers: []
    },
    week: {
      request_count: 393,
      session_count: 6,
      behaviors: [{ key: 'long_context', pct: 92, count: 283 }],
      agents: [{ name: 'Explore', pct: 3 }],
      skills: [{ name: 'core-module', pct: 13 }],
      plugins: [],
      mcp_servers: []
    }
  }
}

/** The live response with one part of it replaced. */
function withLimits(limits: unknown): unknown {
  return { ...LIVE, rate_limits: limits }
}

describe('reading the /usage response', () => {
  it('refuses a response that is not one', () => {
    expect(toUsageReport({ session: 'none of it' })).toBeNull()
    expect(toUsageReport(null)).toBeNull()
    expect(toUsageReport('a paragraph of prose')).toBeNull()
  })

  // The live session had run nothing, which is the case the SDK reports as an
  // empty map rather than as zeros — and it is what a `/usage` typed as the
  // first message of a conversation will always hit.
  it('reads a session that has run no model as zero rather than as missing', () => {
    expect(toUsageReport(LIVE)?.session).toEqual({
      costUsd: 0,
      apiDurationMs: 0,
      wallDurationMs: 695,
      linesAdded: 0,
      linesRemoved: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0
    })
  })

  it('sums the tokens across every model the session used', () => {
    // Not on `session` itself — the SDK keeps them per model, and a session
    // that switched models mid-way would otherwise report only half of itself.
    const worked = {
      ...LIVE,
      session: {
        ...LIVE.session,
        total_cost_usd: 1.8432,
        total_api_duration_ms: 252_000,
        total_lines_added: 180,
        total_lines_removed: 21,
        model_usage: {
          'claude-opus-5': {
            inputTokens: 1_200,
            outputTokens: 34_000,
            cacheReadInputTokens: 8_400_000,
            cacheCreationInputTokens: 96_000,
            costUSD: 1.8,
            contextWindow: 1_000_000
          },
          'claude-haiku-4-5': {
            inputTokens: 800,
            outputTokens: 1_000,
            cacheReadInputTokens: 12_000,
            cacheCreationInputTokens: 4_000,
            costUSD: 0.04,
            contextWindow: 200_000
          }
        }
      }
    }

    expect(toUsageReport(worked)?.session).toMatchObject({
      costUsd: 1.8432,
      apiDurationMs: 252_000,
      linesAdded: 180,
      linesRemoved: 21,
      inputTokens: 2_000,
      outputTokens: 35_000,
      cacheReadTokens: 8_412_000,
      cacheWriteTokens: 100_000
    })
  })

  it('draws the windows it can name and drops the ones it cannot', () => {
    // `nimbus_quill` came back with a share of its own, not a null, so the
    // allowlist is the only thing keeping that codename off the card.
    expect(toUsageReport(LIVE)?.limits).toEqual([
      {
        key: 'five_hour',
        label: null,
        utilization: 50,
        resetsAt: '2026-08-27T19:09:59.812143+00:00'
      },
      {
        key: 'seven_day',
        label: null,
        utilization: 4,
        resetsAt: '2026-09-02T21:59:59.812171+00:00'
      },
      {
        key: MODEL_SCOPED,
        label: 'Fable',
        utilization: 5,
        resetsAt: '2026-09-02T21:59:59.812528+00:00'
      }
    ])
  })

  /*
   * Synthetic, and it has to be: a Max account reports `seven_day_opus`,
   * `seven_day_sonnet` and `seven_day_oauth_apps` as null, so no live response
   * this project can obtain carries all five at once. Without this, a window
   * mapped to the wrong key would sit there passing every other test.
   */
  it('gives every named window its own key, in the order it draws them', () => {
    const all = withLimits({
      five_hour: { utilization: 1, resets_at: null },
      seven_day: { utilization: 2, resets_at: null },
      seven_day_opus: { utilization: 3, resets_at: null },
      seven_day_sonnet: { utilization: 4, resets_at: null },
      seven_day_oauth_apps: { utilization: 5, resets_at: null }
    })

    expect(toUsageReport(all)?.limits).toEqual([
      { key: 'five_hour', label: null, utilization: 1, resetsAt: null },
      { key: 'seven_day', label: null, utilization: 2, resetsAt: null },
      { key: 'seven_day_opus', label: null, utilization: 3, resetsAt: null },
      { key: 'seven_day_sonnet', label: null, utilization: 4, resetsAt: null },
      { key: 'seven_day_oauth_apps', label: null, utilization: 5, resetsAt: null }
    ])
  })

  it('drops a per-model window the account does not hold', () => {
    const unheld = withLimits({
      model_scoped: [
        { display_name: 'Fable', utilization: 5, resets_at: null },
        { display_name: 'Unheld', utilization: null, resets_at: null }
      ]
    })

    expect(toUsageReport(unheld)?.limits).toEqual([
      { key: MODEL_SCOPED, label: 'Fable', utilization: 5, resetsAt: null }
    ])
  })

  it('says plan limits do not apply rather than showing none', () => {
    const apiKey = { ...LIVE, rate_limits_available: false, rate_limits: null }

    // The two are different answers: an API-key session has no plan to be near
    // the end of, while a subscription reporting nothing is a failed reading.
    expect(toUsageReport(apiKey)?.limitsApply).toBe(false)
    expect(toUsageReport(apiKey)?.limits).toEqual([])
  })

  it('treats a subscription with windows it cannot read as still having a plan', () => {
    expect(toUsageReport(withLimits({}))?.limitsApply).toBe(true)
    expect(toUsageReport(withLimits({}))?.limits).toEqual([])
  })

  it('carries extra usage only when it is switched on', () => {
    // Off on the live account, and every one of its figures reads null — drawn,
    // that would be a row of blanks under a heading about credits.
    expect(toUsageReport(LIVE)?.extraUsage).toBeNull()
    expect(toUsageReport(withLimits({}))?.extraUsage).toBeNull()

    const on = withLimits({
      extra_usage: { is_enabled: true, monthly_limit: 50, used_credits: 12.5, utilization: 25 }
    })
    expect(toUsageReport(on)?.extraUsage).toEqual({
      monthlyLimit: 50,
      usedCredits: 12.5,
      utilization: 25
    })
  })

  it('renames the local scan into our own vocabulary', () => {
    const report = toUsageReport(LIVE)

    expect(report?.contributing?.day).toEqual({
      requests: 206,
      sessions: 1,
      behaviors: [
        { key: 'subagent_heavy', pct: 100, count: 1 },
        { key: 'long_context', pct: 73, count: 122 }
      ],
      skills: [{ name: 'core-module', pct: 68 }],
      agents: [{ name: 'Explore', pct: 15 }],
      plugins: [],
      mcpServers: []
    })

    expect(report?.contributing?.week).toMatchObject({ requests: 393, sessions: 6 })
  })

  it('holds nothing about what contributed when the scan did not run', () => {
    // Null for a session that is not a claude.ai subscriber's, and for a scan
    // that failed. Neither is a reason to lose the windows.
    const report = toUsageReport({ ...LIVE, behaviors: null })

    expect(report?.contributing).toBeNull()
    expect(report?.limits).toHaveLength(3)
  })

  it('survives a field going missing upstream, at the cost of that field only', () => {
    const thinned = {
      session: { model_usage: { 'claude-opus-5': {} } },
      rate_limits_available: true,
      rate_limits: { five_hour: {} }
    }

    // Every count defaulted, the window dropped for having no share, and the
    // card still drawn. An API marked "may change without notice" gets read
    // the way it is documented rather than the way it happens to arrive today.
    expect(toUsageReport(thinned)).toEqual({
      session: {
        costUsd: 0,
        apiDurationMs: 0,
        wallDurationMs: 0,
        linesAdded: 0,
        linesRemoved: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0
      },
      subscriptionType: null,
      limitsApply: true,
      limits: [],
      extraUsage: null,
      contributing: null
    })
  })

  it('lets everything it did not ask for through untouched', () => {
    // The live response carries a second `limits` array, a `spend` block and
    // dollar fields on every window. None of it reaches the report, and none of
    // it fails the parse.
    const report = toUsageReport(LIVE)

    expect(report?.subscriptionType).toBe('max')
    expect(report).not.toHaveProperty('spend')
    expect(report?.limits.every((limit) => !('limit_dollars' in limit))).toBe(true)
  })
})

/*
 * What the sidebar draws, out of the answer `/usage` already gets.
 *
 * Every window, not two. There is no second request to save by dropping the
 * rest, and dropping them is what left an account's per-model weekly window
 * named by the card and missing from the block, out of one and the same
 * reading.
 */
describe('the windows a report carries', () => {
  /** A report of exactly these windows, through the real narrowing. */
  function reportOf(limits: unknown): ReturnType<typeof toUsageReport> {
    return toUsageReport(withLimits(limits))
  }

  const READ_AT = '2026-08-11T18:00:00.000Z'

  it('carries every window the account reported, in the order they are drawn', () => {
    const report = reportOf({
      five_hour: { utilization: 31, resets_at: '2026-08-11T19:50:00Z' },
      seven_day: { utilization: 84, resets_at: '2026-08-14T04:00:00Z' },
      seven_day_opus: { utilization: 12, resets_at: null },
      model_scoped: [{ display_name: 'Fable', utilization: 15, resets_at: null }]
    })

    expect(report && windowsFrom(report, READ_AT).limits.map((window) => window.key)).toEqual([
      'five_hour',
      'seven_day',
      'seven_day_opus',
      'model_scoped'
    ])
  })

  /*
   * Dated at the moment it was read. `resetsAt` can only say that a window has
   * since emptied; it cannot say how old the share beside it is, and staleness
   * is the whole complaint this shape was made to answer.
   */
  it('says when it was read', () => {
    const report = reportOf({ five_hour: { utilization: 31, resets_at: null } })

    expect(report && windowsFrom(report, READ_AT).readAt).toBe(READ_AT)
  })

  /*
   * An API-key, Bedrock or Vertex session has no plan to be near the end of.
   * An empty list would say "read, and empty" about an account that has no
   * windows to read, and the block draws a different sentence for each.
   */
  it('carries whether the account has a plan at all', () => {
    expect(reportOf(null) && windowsFrom(reportOf(null)!, READ_AT).limitsApply).toBe(false)

    const withPlan = reportOf({ five_hour: { utilization: 31, resets_at: null } })
    expect(withPlan && windowsFrom(withPlan, READ_AT).limitsApply).toBe(true)
  })
})
