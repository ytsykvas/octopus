import { Check, ChevronDown, ChevronUp, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../Button.js'
import type { TipId } from './tips.js'

interface HeadsUpProps {
  readonly tip: TipId
  /** "I knew this": never show it again, in any conversation. */
  readonly onKnown: () => void
  /** Hide it here for now, without saying anything about the person. */
  readonly onClose: () => void
}

/**
 * A caveat above the message field, at the moment it starts to matter.
 *
 * Claude Code's own heads-ups are the model, without their number keys: here
 * the field below is where text is typed, and a digit there is a digit.
 *
 * The explanation opens in place rather than in a browser, because what it
 * says is about this app and fits in a paragraph.
 *
 * Each button carries an icon, as the buttons elsewhere in the window do. The
 * chevron is the one that says something: it turns over with the paragraph it
 * opens, so the state shows without reading `aria-expanded`.
 */
export function HeadsUp({ tip, onKnown, onClose }: HeadsUpProps): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="mx-auto w-full max-w-6xl px-6 pb-2">
      <section
        aria-label={t('tips.headsUp')}
        className="border-line bg-surface text-ink-soft rounded-[var(--radius-control)] border px-3 py-2"
      >
        <p className="leading-relaxed">
          <span aria-hidden className="text-accent mr-1.5">
            ✦
          </span>
          <span className="text-ink font-medium">{t('tips.headsUp')}</span>
          <span aria-hidden className="text-ink-faint mx-1.5">
            ·
          </span>
          {t(`tips.${tip}.title`)}
        </p>

        {open && <p className="text-ink-soft mt-1.5 leading-relaxed">{t(`tips.${tip}.detail`)}</p>}

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            aria-expanded={open}
            onClick={() => {
              setOpen((current) => !current)
            }}
          >
            {open ? <ChevronUp aria-hidden size={13} /> : <ChevronDown aria-hidden size={13} />}
            {open ? t('tips.showLess') : t('tips.learnMore')}
          </Button>
          <Button size="sm" onClick={onKnown}>
            <Check aria-hidden size={13} />
            {t('tips.knewIt')}
          </Button>
          <Button size="sm" onClick={onClose}>
            <X aria-hidden size={13} />
            {t('tips.dismiss')}
          </Button>
        </div>
      </section>
    </div>
  )
}
