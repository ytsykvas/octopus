import { useTranslation } from 'react-i18next'

import { formatDayLabel } from './format.js'

/**
 * A day, as a small pill: "Today", "Yesterday", `14 October`.
 *
 * The label is worked out when the chip is drawn, never stored: the same chip
 * says "Today" this evening and "Yesterday" tomorrow, and only the key it
 * carries is a fact about the conversation.
 *
 * The floating one is the same pill lifted off the log — it sits over moving
 * text, so it takes the shadow every floating element has and the inline one
 * does not.
 */
export function DayChip({
  day,
  floating = false
}: {
  day: string
  floating?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const label = formatDayLabel(day, {
    today: t('chat.today'),
    yesterday: t('chat.yesterday'),
    locale: t('chat.dateLocale')
  })

  return (
    <span
      className={`bg-surface border-line text-ink-soft rounded-full border px-2.5 py-0.5 text-[11px] tabular-nums ${floating ? 'shadow-[var(--shadow-pop)]' : ''}`}
    >
      {label}
    </span>
  )
}

/**
 * Where a day begins in the log.
 *
 * `data-day` is what the floating chip reads to know which day is on screen —
 * see `useDayAtTop`. Stretched across the column so the pill centres on the
 * log rather than on whichever side the next message sits.
 */
export function DaySeparator({ day }: { day: string }): React.JSX.Element {
  return (
    <div data-day={day} className="flex justify-center self-stretch py-1">
      <DayChip day={day} />
    </div>
  )
}
