import { useTranslation } from 'react-i18next'

import type { UsageWindow } from '@core/agent.js'
import type { RateLimit, SessionUsage } from '@core/service.js'

import { formatCountdown, formatTokens, usageTone } from './format.js'

interface ComposerAtticProps {
  readonly usage: SessionUsage
  /**
   * The account's own word on its windows, pushed by the agent.
   *
   * Kept beside the pulled percentages because it carries something no
   * percentage can: a status the server asserts. A share of 84 is a fact about
   * the past; `rejected` is a fact about the next turn.
   */
  readonly limit: RateLimit | null
}

/**
 * What the next message is up against, above the field it is typed in.
 *
 * Two readings, both quiet: how full this conversation's context window is, and
 * how much of the subscription's five-hour and weekly windows is gone. One step
 * fainter than the pickers below — those are clicked, these are read.
 *
 * The strip disappears entirely when there is nothing to say, which is the
 * ordinary state of a workspace nobody has spoken to, of an API-key session
 * with no plan windows, and of a CLI too old to answer. An empty rule above the
 * field would be chrome asserting that a measurement exists.
 */
export function ComposerAttic({ usage, limit }: ComposerAtticProps): React.JSX.Element | null {
  const { t } = useTranslation()

  const countdownFor = (window: UsageWindow): string | null =>
    window.resetsAt === null
      ? null
      : formatCountdown(window.resetsAt, {
          hours: t('chat.hours'),
          minutes: t('chat.minutes'),
          now: t('chat.soon')
        })

  const share = (label: string, window: UsageWindow, title: string): React.JSX.Element => {
    const countdown = countdownFor(window)

    return (
      <span
        className={usageTone(window.utilization)}
        title={
          countdown === null ? title : `${title} — ${t('chat.usageResets', { time: countdown })}`
        }
      >
        {label} {Math.round(window.utilization)}%
      </span>
    )
  }

  // Only a refusal is worth a word, and it sits *beside* the figures rather
  // than in place of them.
  //
  // The old header chip replaced its number with this, which was fair when
  // there was one number and a countdown. Here the words would cover the two
  // shares this strip exists to show, and say less than they do: "close to the
  // limit" is vaguer than "Week 84%", and the colour already carries it. Only
  // "limit reached" adds something a percentage cannot — that the next turn
  // will not run.
  const refused = limit?.status === 'rejected' ? t('chat.usageReached') : null

  const { context, subscription } = usage
  const windows: React.JSX.Element[] = []

  if (subscription?.fiveHour) {
    windows.push(
      <span key="five">
        {share(t('chat.windowFiveHour'), subscription.fiveHour, t('chat.windowFiveHourTitle'))}
      </span>
    )
  }
  if (subscription?.sevenDay) {
    windows.push(
      <span key="week">
        {share(t('chat.windowWeek'), subscription.sevenDay, t('chat.windowWeekTitle'))}
      </span>
    )
  }

  if (context === null && refused === null && windows.length === 0) return null

  return (
    // Wraps for the same reason the footer does: the two halves are held apart
    // by `ml-auto`, and at the narrowest width the layout permits there is
    // nothing to stop them meeting. A percentage that has been truncated is
    // worse than one on a second line.
    <div className="border-line text-ink-faint flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-[11px]">
      {context !== null && (
        <span
          className={usageTone(context.percentage)}
          title={t('chat.contextTitle', {
            used: formatTokens(context.usedTokens),
            total: formatTokens(context.maxTokens)
          })}
        >
          {t('chat.context')} {context.percentage}%
        </span>
      )}

      <span className="ml-auto flex items-center gap-2">
        {refused !== null && <span className="text-danger">{refused}</span>}
        {windows}
      </span>
    </div>
  )
}
