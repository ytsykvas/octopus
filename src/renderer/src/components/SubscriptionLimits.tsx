import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { UsageWindow } from '@core/agent.js'

import type { SubscriptionController } from '../hooks/useSubscriptionUsage.js'
import { formatCountdown, formatResetAt, usageTone } from './chat/format.js'
import { UsageBar } from './UsageBar.js'

interface SubscriptionLimitsProps {
  readonly subscription: SubscriptionController
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
 * than after the first turn.
 *
 * **Nothing fills it on its own.** Answering costs a session, and `service.ts`
 * says plainly that spawning an agent for a gauge nobody requested is not done.
 * So the block asks to be pressed while it is empty, and pressing it is the
 * request that makes reading allowed — a control request at that, so it costs
 * no turn and no tokens.
 */
export function SubscriptionLimits({ subscription }: SubscriptionLimitsProps): React.JSX.Element {
  const { t } = useTranslation()
  const { usage, busy, unavailable, refresh } = subscription

  const windows = [
    { key: 'five' as const, label: t('limits.fiveHour'), window: usage?.fiveHour ?? null },
    { key: 'week' as const, label: t('limits.week'), window: usage?.sevenDay ?? null }
  ].filter((entry): entry is { key: 'five' | 'week'; label: string; window: UsageWindow } =>
    Boolean(entry.window)
  )

  return (
    <div className="border-line shrink-0 border-t px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="section-label">{t('limits.title')}</p>

        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          title={t('limits.refresh')}
          aria-label={t('limits.refresh')}
          className="focus-ring text-ink-faint hover:text-ink rounded-[var(--radius-control)] transition-colors disabled:opacity-50"
        >
          <RefreshCw aria-hidden size={11} className={busy ? 'animate-spin' : undefined} />
        </button>
      </div>

      {windows.length === 0 ? (
        /* Nothing has ever been read, so there is nothing to draw — and saying
           so beats an empty heading over two empty bars, which would be the
           sidebar claiming to know something it does not. `unavailable` is the
           narrower case: a press that found no conversation to ask through,
           which no amount of waiting fixes. */
        <p className="text-ink-faint leading-relaxed">
          {unavailable ? t('limits.unavailable') : t('limits.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {windows.map(({ key, label, window }) => {
            const share = Math.round(window.utilization)
            const at = window.resetsAt === null ? null : formatResetAt(window.resetsAt)

            /*
             * `formatResetAt` answers null for a moment that has already gone,
             * which is the whole of how staleness is told here — no second
             * clock. A reading taken before its window emptied is no longer a
             * fact, and a stale 95% drawn in red would be the sidebar raising
             * an alarm about something that is over.
             */
            const stale = window.resetsAt !== null && at === null

            /*
             * The glance says when, the hover says how long — the arrangement
             * the composer strip had before this moved, and worth keeping: a
             * moment written on screen stays true however long it is looked
             * at, while a countdown would be an hour wrong an hour later.
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
      )}
    </div>
  )
}
