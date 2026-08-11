import { useTranslation } from 'react-i18next'

import type { RateLimit as RateLimitInfo } from '@core/service.js'

import { formatCountdown } from './format.js'

/** Status colours, through tokens — a raw hex here breaks the dark theme. */
const DOTS: Record<RateLimitInfo['status'], string> = {
  allowed: 'bg-success',
  allowed_warning: 'bg-warning',
  rejected: 'bg-danger'
}

/**
 * How much of the subscription's window is gone.
 *
 * This is what `total_cost_usd` was mistaken for, and the difference is the
 * point: a subscription is never charged a sum, but it does run out. The
 * question the header has to answer is "can I start another turn right now",
 * and it is the only number here that answers it.
 *
 * Which window this counts — five hours or seven days — is not labelled: the
 * countdown says it already, and a name for it would be a second answer to a
 * question the reader has stopped asking.
 */
export function RateLimit({ limit }: { limit: RateLimitInfo | null }): React.JSX.Element | null {
  const { t } = useTranslation()

  // Absent until a turn has run, which is most of the time in a fresh window.
  // Nothing is shown rather than a placeholder holding space for a number that
  // may never come — an API key session never reports one at all.
  if (!limit) return null

  const countdown =
    limit.resetsAt === null
      ? null
      : formatCountdown(limit.resetsAt, {
          hours: t('chat.hours'),
          minutes: t('chat.minutes'),
          now: t('chat.soon')
        })

  // A status worth naming outranks the numbers: at that point the reading is
  // no longer information, it is an obstacle about to appear.
  const warning =
    limit.status === 'rejected'
      ? t('chat.usageReached')
      : limit.status === 'allowed_warning'
        ? t('chat.usageWarning')
        : null

  // Nothing wrong and no share to report — which is what a real event carries
  // most of the time, since `utilization` is optional and frequently absent.
  // A bare countdown beside a green dot answers a question nobody asked, and
  // the header is read past a hundred times a day.
  if (warning === null && limit.utilization === null) return null

  const parts: string[] = []
  if (limit.utilization !== null) parts.push(`${String(Math.round(limit.utilization))}%`)
  if (countdown !== null) parts.push(countdown)

  const label = warning ?? parts.join(' · ')

  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 ${
        limit.status === 'allowed' ? 'text-ink-faint' : 'text-ink-soft'
      }`}
      title={
        countdown === null
          ? t('chat.usage')
          : `${t('chat.usage')} — ${t('chat.usageResets', { time: countdown })}`
      }
    >
      <span aria-hidden className={`size-1.5 rounded-full ${DOTS[limit.status]}`} />
      {label}
    </span>
  )
}
