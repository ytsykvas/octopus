import { Link, Plus, X } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { CARD_LINKS_MAX } from '@core/boardSchema.js'
import { isExternalUrl } from '@core/externalUrls.js'

import { useAskText } from '../../hooks/useAskText.js'
import { DropdownMenu, type MenuAction } from '../DropdownMenu.js'
import { IconButton } from '../paneControls.js'

export interface CardResourcesProps {
  readonly links: readonly string[]
  readonly onLinks: (links: string[]) => Promise<boolean>
}

export function CardResources({ links, onLinks }: CardResourcesProps): React.JSX.Element {
  const { t } = useTranslation()
  const headingId = useId()
  const { ask, dialog } = useAskText()

  const addLink = async (): Promise<void> => {
    const url = await ask({
      title: t('board.resources.addLink'),
      label: t('board.resources.linkPrompt'),
      confirmLabel: t('board.resources.add'),
      cancelLabel: t('board.panel.cancel'),
      valid: isExternalUrl,
      invalid: t('board.resources.linkInvalid')
    })
    if (url !== null && !links.includes(url)) await onLinks([...links, url])
  }

  const actions: readonly MenuAction[] = [
    {
      id: 'addLink',
      label: t('board.resources.addLink'),
      icon: <Link aria-hidden size={13} />,
      // CardPatchSchema refuses a longer list.
      disabled: links.length >= CARD_LINKS_MAX,
      onSelect: () => void addLink()
    }
  ]

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <div className="flex items-center">
        <h3 id={headingId} className="section-label">
          {t('board.resources.title')}
        </h3>
        <span className="ml-auto">
          <DropdownMenu
            actions={actions}
            trigger={({ onClick, open }) => (
              <button
                type="button"
                onClick={onClick}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={t('board.resources.add')}
                title={t('board.resources.add')}
                className="focus-ring text-ink-faint hover:text-ink hover:bg-muted rounded-[var(--radius-control)] p-1"
              >
                <Plus aria-hidden size={13} />
              </button>
            )}
          />
        </span>
      </div>
      {links.length === 0 ? (
        <p className="text-ink-soft text-[12px]">{t('board.resources.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {links.map((url) => (
            <li key={url} className="flex items-center gap-1.5 text-[12px]">
              <Link aria-hidden size={12} className="text-ink-faint shrink-0" />
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-accent min-w-0 truncate"
              >
                {url}
              </a>
              <IconButton
                label={t('board.resources.removeLink')}
                onClick={() => void onLinks(links.filter((other) => other !== url))}
              >
                <X aria-hidden size={12} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </section>
  )
}
