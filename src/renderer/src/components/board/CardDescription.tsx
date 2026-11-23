import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { withoutTitle } from '@core/boardText.js'

import { Markdown } from '../chat/Markdown.js'

export function CardDescription({
  description
}: {
  readonly description: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const headingId = useId()
  const shown = withoutTitle(description).trim()

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <h3 id={headingId} className="section-label">
        {t('board.panel.description')}
      </h3>
      {shown === '' ? (
        <p className="text-ink-soft">{t('board.panel.noDescription')}</p>
      ) : (
        <Markdown text={shown} />
      )}
    </section>
  )
}
