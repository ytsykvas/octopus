import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { FileTabsController } from '../../hooks/useFileTabs.js'
import { FileIcon } from './FileIcon.js'

interface FileTabsProps {
  readonly files: FileTabsController
}

/**
 * The files open in the centre, after the conversations in the same strip.
 *
 * Underlined like the conversation tabs, because they are the same kind of
 * thing — what the centre is showing — and a second style beside the first
 * would read as a second control. Set apart by a rule, and by an icon where
 * a conversation has its dot.
 *
 * The one loose tab is set in italics, the editor convention for "the next
 * file you open replaces this one".
 */
export function FileTabs({ files }: FileTabsProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const strip = useRef<HTMLElement>(null)

  // The strip scrolls sideways once there are more files than room; the one in
  // front is brought into view when it changes, as an editor's tab bar does.
  useEffect(() => {
    if (files.active === null) return
    strip.current
      ?.querySelector(`[data-path="${CSS.escape(files.active)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [files.active])

  if (files.tabs.length === 0) return null

  return (
    <nav
      ref={strip}
      aria-label={t('files.tabs')}
      className="border-line ml-2 flex min-w-0 flex-1 items-center overflow-x-auto border-l pl-2 [scrollbar-width:none]"
    >
      {files.tabs.map((tab) => {
        const name = tab.path.slice(tab.path.lastIndexOf('/') + 1)
        const active = tab.path === files.active

        return (
          <span
            key={tab.path}
            data-path={tab.path}
            className="group relative flex shrink-0 items-center"
          >
            <button
              type="button"
              onClick={() => {
                files.select(tab.path)
              }}
              onDoubleClick={() => {
                files.pin(tab.path)
              }}
              // A middle click closes, as it does on every tab strip people
              // already use.
              onAuxClick={(event) => {
                if (event.button === 1) files.close(tab.path)
              }}
              aria-current={active ? 'page' : undefined}
              title={tab.pinned ? tab.path : t('files.preview', { name: tab.path })}
              className={`focus-ring flex h-9 items-center gap-1.5 pr-1 pl-2.5 text-[12px] transition-colors ${
                tab.pinned ? '' : 'italic'
              } ${
                active
                  ? 'text-ink after:absolute after:inset-x-1.5 after:bottom-0 after:h-px after:bg-[var(--project-color)] after:content-[""]'
                  : 'text-ink-faint hover:text-ink-soft'
              }`}
            >
              <FileIcon name={name} path={tab.path} kind="file" expanded={false} />
              {name}
            </button>
            <button
              type="button"
              onClick={() => {
                files.close(tab.path)
              }}
              title={t('files.close', { name })}
              aria-label={t('files.close', { name })}
              // Held in the layout, shown on hover or when the tab is in front,
              // so the strip does not jump under the pointer.
              className={`text-ink-faint hover:text-ink focus-ring mr-1 flex size-5 items-center justify-center rounded transition-opacity ${
                active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
              }`}
            >
              <X aria-hidden size={12} />
            </button>
          </span>
        )
      })}
    </nav>
  )
}
