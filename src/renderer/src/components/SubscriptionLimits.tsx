import { useTranslation } from 'react-i18next'

import type { SubscriptionUsage, UsageWindow } from '@core/agent.js'

import { formatCountdown, formatResetAt, usageTone } from './chat/format.js'
import { UsageBar } from './UsageBar.js'

interface SubscriptionLimitsProps {
  readonly usage: SubscriptionUsage | null
}

/**
 * What is left of the account's windows, at the foot of the sidebar.
 *
 * Here rather than above the composer, where these used to be, because they say
 * nothing about the conversation they were sitting in: the same pair applies to
 * every workspace, and reading them should not require opening a chat and
 * sending something first.
 *
 * The figures come from the last reading the service kept, which it writes to
 * the state file — so this is drawn from the moment the window opens rather
 * than after the first turn. Nothing is polled and no session is started for
 * it: a block in the sidebar is a gauge nobody asked for, and `service.ts` says
 * plainly that spawning an agent to fill one is not done.
 */
export function SubscriptionLimits({ usage }: SubscriptionLimitsProps): React.JSX.Element | null {
  const { t } = useTranslation()

  const windows = [
    { key: 'five' as const, label: t('limits.fiveHour'), window: usage?.fiveHour ?? null },
    { key: 'week' as const, label: t('limits.week'), window: usage?.sevenDay ?? null }
  ].filter((entry): entry is { key: 'five' | 'week'; label: string; window: UsageWindow } =>
    Boolean(entry.window)
  )

  // Nothing has ever been read, or the account reported neither window. An
  // empty heading over two empty bars would be the sidebar claiming to know
  // something it does not.
  if (windows.length === 0) return null

  return (
    <div className="border-line shrink-0 border-t px-3 py-2.5">
      <p className="section-label mb-1.5">{t('limits.title')}</p>

      <div className="flex flex-col gap-2">
        {windows.map(({ key, label, window }) => {
          const share = Math.round(window.utilization)
          const at = window.resetsAt === null ? null : formatResetAt(window.resetsAt)

          /*
           * `formatResetAt` answers null for a moment that has already gone,
           * which is the whole of how staleness is told here — no second clock.
           * A reading taken before its window emptied is no longer a fact, and
           * a stale 95% drawn in red would be the sidebar raising an alarm
           * about something that is over.
           */
          const stale = window.resetsAt !== null && at === null

          /*
           * The glance says when, the hover says how long — the arrangement
           * the composer strip had before this moved, and worth keeping: a
           * moment written on screen stays true however long it is looked at,
           * while a countdown would be an hour wrong an hour later.
           */
          const countdown =
            window.resetsAt === null
              ? null
              : formatCountdown(window.resetsAt, {
                  hours: t('limits.hours'),
                  minutes: t('limits.minutes'),
                  now: t('limits.soon')
                })

          const title = stale
            ? t('limits.stale')
            : countdown === null
              ? undefined
              : t('limits.resets', { time: countdown })

          return (
            <div key={key} className={stale ? 'opacity-40' : undefined} title={title}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
                <span className="text-ink-faint">{label}</span>
                <span className={usageTone(share)}>
                  {share}%{at !== null && <span className="text-ink-faint">{` · ${at}`}</span>}
                </span>
              </div>

              <UsageBar
                kind="limit"
                label={t('limits.reading', { name: label, percentage: share })}
                percentage={window.utilization}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
