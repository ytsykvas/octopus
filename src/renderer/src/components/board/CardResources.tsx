import { Link, Paperclip, Plus, X } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CARD_LINKS_MAX, isCardUrl } from '@core/boardSchema.js'

import { useAskText } from '../../hooks/useAskText.js'
import { useConfirm } from '../../hooks/useConfirm.js'
import { DropdownMenu, type MenuAction } from '../DropdownMenu.js'
import { IconButton } from '../paneControls.js'

export interface CardResourcesProps {
  readonly links: readonly string[]
  readonly onLinks: (links: string[]) => Promise<boolean>
  readonly attachments: readonly string[]
  readonly onAttach: () => void
  readonly onReveal: (name: string) => void
  readonly onRemoveFile: (name: string) => Promise<unknown>
}

export function CardResources({
  links,
  onLinks,
  attachments,
  onAttach,
  onReveal,
  onRemoveFile
}: CardResourcesProps): React.JSX.Element {
  const { t } = useTranslation()
  const headingId = useId()
  const { ask, dialog } = useAskText()
  const [writing, setWriting] = useState(false)
  const { confirm, dialog: question } = useConfirm()
  const [removing, setRemoving] = useState(false)

  // Each change is built from the list on screen, which a write updates only after the board is read again.
  const write = async (next: string[]): Promise<void> => {
    setWriting(true)
    await onLinks(next)
    setWriting(false)
  }

  const addLink = async (): Promise<void> => {
    const url = await ask({
      title: t('board.resources.addLink'),
      label: t('board.resources.linkPrompt'),
      confirmLabel: t('board.resources.add'),
      cancelLabel: t('board.panel.cancel'),
      valid: isCardUrl,
      invalid: t('board.resources.linkInvalid')
    })
    if (url !== null && !links.includes(url)) await write([...links, url])
  }

  // The list on screen changes only once the board is read again, so a second click would ask twice.
  const removeFile = async (name: string): Promise<void> => {
    const { confirmed } = await confirm({
      title: t('board.resources.removeFileTitle', { name }),
      message: t('board.remove.body'),
      confirmLabel: t('board.panel.remove'),
      cancelLabel: t('board.panel.cancel'),
      destructive: true
    })
    if (!confirmed) return
    setRemoving(true)
    await onRemoveFile(name)
    setRemoving(false)
  }

  const actions: readonly MenuAction[] = [
    {
      id: 'addLink',
      label: t('board.resources.addLink'),
      icon: <Link aria-hidden size={13} />,
      // CardPatchSchema refuses a longer list.
      disabled: writing || links.length >= CARD_LINKS_MAX,
      onSelect: () => void addLink()
    },
    {
      id: 'addFiles',
      label: t('board.resources.addFiles'),
      icon: <Paperclip aria-hidden size={13} />,
      onSelect: onAttach
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
      {links.length === 0 && attachments.length === 0 && (
        <p className="text-ink-soft text-[12px]">{t('board.resources.empty')}</p>
      )}
      {links.length > 0 && (
        <ul className="flex flex-col gap-1">
          {links.map((url) => (
            <li key={url} className="flex items-center gap-1.5 text-[12px]">
              <Link aria-hidden size={12} className="text-ink-faint shrink-0" />
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="focus-ring text-accent min-w-0 truncate rounded hover:underline"
              >
                {url}
              </a>
              <IconButton
                label={t('board.resources.removeLink', { url })}
                disabled={writing}
                onClick={() => void write(links.filter((other) => other !== url))}
              >
                <X aria-hidden size={12} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {attachments.length > 0 && (
        <ul className="flex flex-col gap-1">
          {attachments.map((name) => (
            <li key={name} className="flex items-center gap-1.5 text-[12px]">
              <button
                type="button"
                title={t('board.panel.reveal')}
                onClick={() => {
                  onReveal(name)
                }}
                className="focus-ring text-ink hover:text-accent flex min-w-0 items-center gap-1.5 rounded-[var(--radius-control)]"
              >
                <Paperclip aria-hidden size={12} className="text-ink-faint shrink-0" />
                <span className="truncate">{name}</span>
              </button>
              <IconButton
                label={t('board.resources.removeFile', { name })}
                disabled={removing}
                onClick={() => void removeFile(name)}
              >
                <X aria-hidden size={12} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {dialog}
      {question}
    </section>
  )
}
