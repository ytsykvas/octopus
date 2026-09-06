import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { MODEL_SCOPED } from '@core/usage.js'

import type { SubscriptionController, SubscriptionOutcome } from '../hooks/useSubscriptionUsage.js'
import { formatCountdown, formatResetAt, usageTone } from './chat/format.js'
import { SHORT_WINDOW_NAMES } from './usageWindows.js'
import { UsageBar } from './UsageBar.js'

interface SubscriptionLimitsProps {
  readonly subscription: SubscriptionController
}

/**
 * What the block says while it has no figures.
 *
 * Exhaustive by its type, so an outcome the service starts answering with has
 * to be given words here rather than falling through to the wrong sentence.
 * `read` is in the table for completeness: an account can have a plan and
 * report no windows, and that is a fifth thing again.
 */
const EMPTY_REASONS: Record<
  SubscriptionOutcome,
  'limits.empty' | 'limits.unavailable' | 'limits.noPlan' | 'limits.failed' | 'limits.none'
> = {
  unread: 'limits.empty',
  nowhereToAsk: 'limits.unavailable',
  noPlan: 'limits.noPlan',
  failed: 'limits.failed',
  read: 'limits.none'
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
  const { usage, busy, outcome, refresh } = subscription

  /*
   * Every window the account reported, not two of them. They arrive in one
   * answer, and keeping four numbers out of it left an account with a weekly
   * window per model seeing it named by the `/usage` card and missing here.
   * `toLimits` in `core/usage.ts` already drops a window with no share, so most
   * accounts still draw the two rows this always had.
   */
  const windows = usage?.limits ?? []

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
        /* Four things to say, not one. An empty heading over two empty bars
           would be the sidebar claiming to know something it does not, and a
           single sentence for every way of having nothing said the wrong one
           three times out of four: a failed read looked like a fresh reading,
           and an account with no plan was told to open a workspace. */
        <p className="text-ink-faint leading-relaxed">{t(EMPTY_REASONS[outcome])}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {windows.map((window) => {
            // The server labels a per-model window itself; the rest have a name
            // of ours, short enough for the rail.
            const label =
              window.key === MODEL_SCOPED && window.label !== null
                ? t('limits.windowModel', { name: window.label })
                : t(SHORT_WINDOW_NAMES[window.key])

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
              <div
                key={`${window.key}:${window.label ?? ''}`}
                className={stale ? 'opacity-40' : undefined}
                title={title}
              >
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
                  {/* Two hundred pixels for the whole row, so the mark is on
                      the name rather than a word of its own. */}
                  <span className="text-ink-faint truncate">
                    {window.binding ? t('limits.binding', { name: label }) : label}
                  </span>
                  <span className={`shrink-0 ${usageTone(share, window.severity)}`}>
                    {share}%{at !== null && <span className="text-ink-faint">{` · ${at}`}</span>}
                  </span>
                </div>

                <UsageBar
                  kind="limit"
                  label={t('limits.reading', { name: label, percentage: share })}
                  percentage={window.utilization}
                  severity={window.severity}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
