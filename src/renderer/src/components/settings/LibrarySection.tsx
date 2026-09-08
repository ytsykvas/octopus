import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LibraryDocument } from '@core/library.js'
import { isLibraryName, type LibraryKind } from '@core/libraryNames.js'
import type { Store } from '@core/stores.js'

import { useAskText } from '../../hooks/useAskText.js'
import { useConfirm } from '../../hooks/useConfirm.js'
import { useLibraryStore } from '../../hooks/useLibraryStore.js'
import { Button } from '../Button.js'
import { DropdownMenu } from '../DropdownMenu.js'
import { LibraryEditor } from './LibraryEditor.js'
import { LibraryImport } from './LibraryImport.js'

interface LibrarySectionProps {
  readonly store: Store
  readonly kind: LibraryKind
}

/**
 * The commands or subagents of one store.
 *
 * Shared by both settings dialogs, exactly as `SkillsSection` is: the same list
 * twice over, with only the reach differing, and that is what the store says.
 *
 * No switch on a row, which is the visible difference from the skills beside
 * them. A skill can be turned off for one conversation because the SDK takes an
 * override for it; neither of these has one, so a command or a subagent is
 * present or it is not, and pretending otherwise would be a control that did
 * nothing.
 */
export function LibrarySection({ store, kind }: LibrarySectionProps): React.JSX.Element {
  const { t } = useTranslation()
  const library = useLibraryStore(store, kind)
  const { confirm, dialog } = useConfirm()
  const { ask, dialog: askDialog } = useAskText()

  const [editing, setEditing] = useState<LibraryDocument | null>(null)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)

  const taken = library.entries.map((entry) => entry.name)

  const open = async (name: string): Promise<void> => {
    const document = await window.octopus.library.read(store, kind, name)
    if (document.ok) setEditing(document.value)
  }

  const requestRename = async (name: string): Promise<void> => {
    const to = await ask({
      title: t('library.renameTitle', { name }),
      label: t('library.renameLabel'),
      confirmLabel: t('library.renameConfirm'),
      cancelLabel: t('library.renameCancel'),
      initial: name,
      // The rule core applies, asked as it is typed: the name becomes a file,
      // so a round trip spent on one it will refuse says nothing that could not
      // be said here.
      valid: isLibraryName,
      invalid: t('library.renameInvalid')
    })

    if (to !== null && to !== name) await library.rename(name, to)
  }

  const requestRemove = async (name: string): Promise<void> => {
    const { confirmed } = await confirm({
      title: t('library.removeTitle', { name }),
      message: t('library.removeMessage'),
      detail: t('library.removeDetail'),
      confirmLabel: t('library.removeConfirm'),
      cancelLabel: t('library.removeCancel'),
      destructive: true
    })

    if (confirmed) await library.remove(name)
  }

  const heading = kind === 'command' ? t('library.commands') : t('library.subagents')
  const note =
    kind === 'command'
      ? store.kind === 'global'
        ? t('library.commandsNote')
        : t('library.commandsProjectNote')
      : store.kind === 'global'
        ? t('library.subagentsNote')
        : t('library.subagentsProjectNote')

  return (
    <div className="text-[13px]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="font-medium">{heading}</p>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setImporting(true)
            }}
          >
            {t('library.import')}
          </Button>
          <Button
            variant="accent"
            onClick={() => {
              setCreating(true)
            }}
          >
            <Plus aria-hidden size={12} />
            {t(`library.add.${kind}`)}
          </Button>
        </div>
      </div>
      <p className="text-ink-faint mb-3 max-w-lg leading-relaxed">{note}</p>

      {/* Not while a dialog is open: each draws this message itself, because a
          modal covers this line and a refusal shown behind one is a refusal
          nobody reads. */}
      {library.error !== null && !importing && !creating && editing === null && (
        <p className="text-danger mb-3">{library.error}</p>
      )}

      {library.entries.length === 0 ? (
        <p className="text-ink-faint">{t(`library.empty.${kind}`)}</p>
      ) : (
        <ul className="border-line divide-line divide-y rounded-[var(--radius-panel)] border">
          {library.entries.map((entry) => (
            <li key={entry.name} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="text-ink block truncate">
                  {kind === 'command' ? `/${entry.name}` : entry.name}
                </span>
                {entry.description !== '' && (
                  <span className="text-ink-faint block truncate text-[11px]">
                    {entry.description}
                  </span>
                )}
              </span>
              <DropdownMenu
                actions={[
                  {
                    id: 'edit',
                    label: t('library.edit'),
                    onSelect: () => {
                      void open(entry.name)
                    }
                  },
                  {
                    id: 'rename',
                    label: t('library.rename'),
                    onSelect: () => {
                      void requestRename(entry.name)
                    }
                  },
                  {
                    id: 'remove',
                    label: t('library.remove'),
                    destructive: true,
                    onSelect: () => {
                      void requestRemove(entry.name)
                    }
                  }
                ]}
                trigger={({ onClick, open: menuOpen }) => (
                  <Button
                    aria-label={t('library.rowActions', { name: entry.name })}
                    aria-expanded={menuOpen}
                    onClick={onClick}
                    size="sm"
                  >
                    …
                  </Button>
                )}
              />
            </li>
          ))}
        </ul>
      )}

      {(creating || editing !== null) && (
        <LibraryEditor
          kind={kind}
          item={editing}
          taken={taken}
          onSave={creating ? library.create : library.save}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}

      {importing && (
        <LibraryImport
          kind={kind}
          taken={taken}
          onImport={library.create}
          onInspect={library.inspect}
          error={library.error}
          onClose={() => {
            setImporting(false)
          }}
        />
      )}

      {dialog}
      {askDialog}
    </div>
  )
}
