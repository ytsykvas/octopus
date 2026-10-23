import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Markdown } from '../chat/Markdown.js'

/**
 * What the author wrote, without the notes a template leaves for them.
 *
 * Templates are full of `<!-- … -->` guidance, and with raw HTML off the
 * markdown would draw every one of them as text — the instructions to the
 * author shown as though they were the description.
 */
function descriptionText(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, '').trim()
}

/**
 * The request's description, under whichever view is chosen.
 *
 * It belongs to the request rather than to a view, and it sits in the room the
 * views leave above the footer — scrolling with them, so a long one never
 * pushes the footer away. Nothing is drawn where nothing was written: an empty
 * card would be chrome claiming there is a description.
 */
export function RequestDescription({ body }: { readonly body: string }): React.JSX.Element | null {
  const { t } = useTranslation()
  const text = descriptionText(body)
  if (text === '') return null

  return (
    <section aria-label={t('pullRequest.description')} className="panel mt-3 px-3 py-2.5">
      <h3 className="section-label mb-1.5 flex items-center gap-1.5">
        <FileText aria-hidden size={11} />
        {t('pullRequest.description')}
      </h3>
      <div className="text-ink-soft">
        <Markdown text={text} />
      </div>
    </section>
  )
}
