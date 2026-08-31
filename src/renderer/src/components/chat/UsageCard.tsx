/**
 * What `/usage` answers, drawn rather than printed.
 *
 * The command reaches the CLI in no other client of ours: `service.sendToChat`
 * takes it off the agent and answers it from the structured reading instead,
 * because the CLI's own answer is a paragraph of prose about percentages. This
 * is the other half of that — the same figures with a bar beside each one.
 */

import { Gauge } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { UsageContributing, UsageLimit, UsageReport } from '@core/usage.js'

import { formatDuration, formatResetAt, formatTokens, usageTone } from './format.js'
import { UsageBar } from '../UsageBar.js'

/**
 * What each window is called on screen.
 *
 * A table rather than a switch, and exhaustive by its type: a window added to
 * the allowlist in `core/usage.ts` without a name for it here fails to compile,
 * rather than drawing its own key at someone.
 */
const WINDOW_NAMES: Record<
  UsageLimit['key'],
  | 'usage.windowFiveHour'
  | 'usage.windowSevenDay'
  | 'usage.windowSevenDayOpus'
  | 'usage.windowSevenDaySonnet'
  | 'usage.windowSevenDayOauthApps'
  | 'usage.windowModelScoped'
> = {
  five_hour: 'usage.windowFiveHour',
  seven_day: 'usage.windowSevenDay',
  seven_day_opus: 'usage.windowSevenDayOpus',
  seven_day_sonnet: 'usage.windowSevenDaySonnet',
  seven_day_oauth_apps: 'usage.windowSevenDayOauthApps',
  model_scoped: 'usage.windowModelScoped'
}

/**
 * What each characteristic of a session is called.
 *
 * Not exhaustive, unlike the windows above, and that is the point: these come
 * from a scan whose vocabulary belongs to the CLI, and one added upstream
 * should appear under its own key rather than disappear.
 */
const BEHAVIOURS: Record<
  string,
  | 'usage.behaviourCacheMiss'
  | 'usage.behaviourLongContext'
  | 'usage.behaviourSubagentHeavy'
  | 'usage.behaviourHighParallel'
  | 'usage.behaviourCron'
> = {
  cache_miss: 'usage.behaviourCacheMiss',
  long_context: 'usage.behaviourLongContext',
  subagent_heavy: 'usage.behaviourSubagentHeavy',
  high_parallel: 'usage.behaviourHighParallel',
  cron: 'usage.behaviourCron'
}

const SPANS = ['day', 'week'] as const
type Span = (typeof SPANS)[number]

const SPAN_LABELS: Record<Span, 'usage.day' | 'usage.week'> = {
  day: 'usage.day',
  week: 'usage.week'
}

/** One label and its figure, in the session's list. */
function Field({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-ink-soft">{label}</span>
      <span className="text-ink text-right">{value}</span>
    </div>
  )
}

/** A heading with a rule under it, repeated down the card. */
function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="border-line flex flex-col gap-2 border-t px-3 py-2.5">
      <h3 className="section-label">{title}</h3>
      {children}
    </section>
  )
}

/** One plan window: what it is, how much is gone, and when it comes back. */
function Limit({ limit }: { limit: UsageLimit }): React.JSX.Element {
  const { t } = useTranslation()

  const name =
    limit.label === null
      ? t(WINDOW_NAMES[limit.key])
      : t('usage.windowModel', { name: limit.label })
  const percentage = Math.round(limit.utilization)

  // Null for a window that has already reset — the reading is a snapshot, and
  // an hour in the past under the word "resets" is a promise already broken.
  const at = limit.resetsAt === null ? null : formatResetAt(limit.resetsAt)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ink">{name}</span>
        <span className={usageTone(percentage)}>{percentage}%</span>
      </div>

      <UsageBar
        kind="limit"
        label={t('usage.reading', { name, percentage })}
        percentage={limit.utilization}
      />

      {at !== null && (
        <span className="text-ink-faint text-[11px]">{t('usage.resets', { at })}</span>
      )}
    </div>
  )
}

/** One named share of the local scan, with a bar for comparing it to the rest. */
function Share({ name, pct }: { name: string; pct: number }): React.JSX.Element {
  const { t } = useTranslation()
  const percentage = Math.round(pct)

  return (
    <div className="grid grid-cols-[1fr_5rem_2.5rem] items-center gap-2">
      <span className="text-ink-soft truncate">{name}</span>
      <UsageBar kind="share" label={t('usage.share', { name, percentage })} percentage={pct} />
      <span className="text-ink-faint text-right">{percentage}%</span>
    </div>
  )
}

/** Everything the scan found for one span of time. */
function Contributing({ window }: { window: UsageContributing }): React.JSX.Element {
  const { t } = useTranslation()

  const groups = [
    { title: t('usage.skills'), items: window.skills },
    { title: t('usage.agents'), items: window.agents },
    { title: t('usage.plugins'), items: window.plugins },
    { title: t('usage.mcpServers'), items: window.mcpServers }
  ].filter((group) => group.items.length > 0)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink-faint">
        {[
          t('usage.requests', { count: window.requests }),
          t('usage.sessions', { count: window.sessions })
        ].join(' · ')}
      </p>

      {window.behaviors.map((behaviour) => {
        const key = BEHAVIOURS[behaviour.key]
        return (
          <Share
            key={behaviour.key}
            name={key === undefined ? behaviour.key : t(key)}
            pct={behaviour.pct}
          />
        )
      })}

      {groups.map((group) => (
        <div className="flex flex-col gap-1" key={group.title}>
          <h4 className="text-ink-faint">{group.title}</h4>
          {group.items.map((item) => (
            <Share key={item.name} name={item.name} pct={item.pct} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** The card itself, once there is something to draw. */
function Report({ report }: { report: UsageReport }): React.JSX.Element {
  const { t } = useTranslation()
  const [span, setSpan] = useState<Span>('day')

  const { session } = report
  const clock = { minutes: t('usage.minutes'), seconds: t('usage.seconds') }

  const fields = [
    { label: t('usage.cost'), value: t('usage.costValue', { amount: session.costUsd.toFixed(2) }) },
    {
      label: t('usage.tokens'),
      value: t('usage.tokensValue', {
        input: formatTokens(session.inputTokens),
        output: formatTokens(session.outputTokens)
      })
    },
    {
      label: t('usage.cache'),
      value: t('usage.cacheValue', {
        read: formatTokens(session.cacheReadTokens),
        write: formatTokens(session.cacheWriteTokens)
      })
    },
    { label: t('usage.apiTime'), value: formatDuration(session.apiDurationMs, clock) },
    { label: t('usage.wallTime'), value: formatDuration(session.wallDurationMs, clock) },
    {
      label: t('usage.changes'),
      value: t('usage.changesValue', {
        added: session.linesAdded,
        removed: session.linesRemoved
      })
    }
  ]

  const contributing = report.contributing

  return (
    <div className="border-line rounded-[var(--radius-panel)] border">
      {/* A header with a rule under it rather than a filled bar, as the plan
          card does — the sections below carry their own separators, and a fill
          here would make the first of them look like part of the title. */}
      <div className="border-line flex items-center gap-2 border-b px-3 py-1.5 font-medium">
        <Gauge aria-hidden className="text-accent shrink-0" size={14} />
        {t('usage.title')}

        {report.subscriptionType !== null && (
          <span className="text-ink-faint ml-auto capitalize">{report.subscriptionType}</span>
        )}
      </div>

      <Section title={t('usage.session')}>
        <div className="flex flex-col gap-1">
          {fields.map((field) => (
            <Field key={field.label} label={field.label} value={field.value} />
          ))}
        </div>
      </Section>

      {/* An account with no plan says so; one whose windows could not be read
          says nothing, because a heading over an empty space is a claim that
          something is missing rather than that nothing applies. */}
      {!report.limitsApply && (
        <Section title={t('usage.limits')}>
          <p className="text-ink-soft">{t('usage.noPlan')}</p>
        </Section>
      )}

      {report.limits.length > 0 && (
        <Section title={t('usage.limits')}>
          <div className="flex flex-col gap-3">
            {report.limits.map((limit) => (
              <Limit key={`${limit.key}:${limit.label ?? ''}`} limit={limit} />
            ))}
          </div>
        </Section>
      )}

      {report.extraUsage !== null && (
        <Section title={t('usage.extra')}>
          {report.extraUsage.utilization !== null && (
            <UsageBar
              kind="limit"
              label={t('usage.reading', {
                name: t('usage.extra'),
                percentage: Math.round(report.extraUsage.utilization)
              })}
              percentage={report.extraUsage.utilization}
            />
          )}
          {report.extraUsage.usedCredits !== null && report.extraUsage.monthlyLimit !== null && (
            <p className="text-ink-soft">
              {t('usage.extraSpent', {
                used: report.extraUsage.usedCredits,
                limit: report.extraUsage.monthlyLimit
              })}
            </p>
          )}
        </Section>
      )}

      {contributing !== null && (
        <Section title={t('usage.contributing')}>
          <div className="flex items-center gap-1">
            {SPANS.map((option) => (
              <button
                aria-pressed={span === option}
                className={`focus-ring rounded-[var(--radius-control)] px-2 py-0.5 ${
                  span === option ? 'bg-muted text-ink' : 'text-ink-faint'
                }`}
                key={option}
                onClick={() => {
                  setSpan(option)
                }}
                type="button"
              >
                {t(SPAN_LABELS[option])}
              </button>
            ))}
          </div>

          <Contributing window={contributing[span]} />

          <p className="text-ink-faint text-[11px]">{t('usage.approximate')}</p>
        </Section>
      )}
    </div>
  )
}

export function UsageCard({ report }: { report: UsageReport | null }): React.JSX.Element {
  const { t } = useTranslation()

  // Silence under a `/usage` bubble reads as a hang, so a reading that failed
  // says so rather than drawing nothing.
  if (report === null) {
    return (
      <p className="border-line text-ink-soft rounded-[var(--radius-panel)] border px-3 py-2">
        {t('usage.unavailable')}
      </p>
    )
  }

  return <Report report={report} />
}
