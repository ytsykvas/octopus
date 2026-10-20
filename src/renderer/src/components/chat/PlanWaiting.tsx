import { Map } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../Button.js'

interface PlanWaitingProps {
  /** Brings the minimised plan dialog back. */
  readonly onOpen: () => void
}

/**
 * A plan set aside, above the message field.
 *
 * The agent is still blocked on the plan, so minimising its dialog cannot make
 * the question disappear. Dismissing it outright was refused for exactly that
 * reason: the conversation waited on something no longer on screen. The strip
 * keeps it in sight without covering the files and the diff being checked.
 */
export function PlanWaiting({ onOpen }: PlanWaitingProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="mx-auto w-full max-w-6xl px-6 pb-2">
      <section
        aria-label={t('chat.planWaiting')}
        className="border-line bg-surface text-ink-soft flex items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2"
      >
        <Map aria-hidden className="text-accent shrink-0" size={14} />
        <p className="min-w-0 flex-1">{t('chat.planWaiting')}</p>
        <Button size="sm" variant="accent" onClick={onOpen}>
          {t('chat.planReopen')}
        </Button>
      </section>
    </div>
  )
}
