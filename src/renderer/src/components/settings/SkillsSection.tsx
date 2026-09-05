import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { isSkillName, type SkillStore, skillKey } from '@core/skillNames.js'
import type { SkillDocument, SkillEntry } from '@core/skills.js'

import { useAskText } from '../../hooks/useAskText.js'
import { useConfirm } from '../../hooks/useConfirm.js'
import { useSkillStore } from '../../hooks/useSkillStore.js'
import { Button } from '../Button.js'
import { DropdownMenu } from '../DropdownMenu.js'
import { Switch } from '../Switch.js'
import { SkillEditor } from './SkillEditor.js'
import { SkillImport } from './SkillImport.js'

interface SkillsSectionProps {
  readonly store: SkillStore
  /** Keys switched off in every new conversation of this scope. */
  readonly disabledDefaults: readonly string[]
  readonly onDefaults: (next: string[]) => void
  /**
   * A workspace of this project, or null for the installation-wide section.
   *
   * The checkout's own skills are read through one, and there is no checkout
   * to read from until the project has a workspace.
   */
  readonly workspaceId?: string | null
  /** Copies one of the checkout's skills into the installation-wide store. */
  readonly onCopyToGlobal?: (path: string) => Promise<boolean>
}

/**
 * The skills of one store, and what a conversation starts with.
 *
 * Shared by both settings dialogs because they are the same list twice over —
 * only the reach differs, and that is what the store says. Written once, the
 * two cannot drift into looking like different features.
 *
 * The switch on each row is about **new** conversations. An existing one keeps
 * whatever it was told, which is why the panel in the composer exists at all:
 * this decides what a conversation begins as, that decides what it is.
 */
export function SkillsSection({
  store,
  disabledDefaults,
  onDefaults,
  workspaceId = null,
  onCopyToGlobal
}: SkillsSectionProps): React.JSX.Element {
  const { t } = useTranslation()
  const skills = useSkillStore(store)
  const { confirm, dialog } = useConfirm()
  const { ask, dialog: askDialog } = useAskText()

  const [editing, setEditing] = useState<SkillDocument | null>(null)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [carried, setCarried] = useState<readonly SkillEntry[]>([])

  useEffect(() => {
    if (workspaceId === null) return

    const controller = new AbortController()

    void (async () => {
      const answer = await window.octopus.skills.inRepository(workspaceId)
      if (!controller.signal.aborted && answer.ok) setCarried(answer.value)
    })()

    return () => {
      controller.abort()
    }
  }, [workspaceId])

  // Addressed by the directory the listing found, not by the name on the row:
  // two directories may claim one name, and the name then says nothing about
  // which of them a click meant.
  const open = async (folder: string): Promise<void> => {
    const document = await window.octopus.skills.read(store, folder)
    if (document.ok) setEditing(document.value)
  }

  /*
   * A menu action rather than the editor's name field, which stays disabled.
   * Editing the name inline would read as one more edit, and this is a
   * migration: the name is the directory *and* the key three stored answers
   * use, so core moves them together.
   */
  const requestRename = async (folder: string, name: string): Promise<void> => {
    const to = await ask({
      title: t('skills.renameTitle', { name }),
      label: t('skills.renameLabel'),
      confirmLabel: t('skills.renameConfirm'),
      cancelLabel: t('skills.renameCancel'),
      initial: name,
      // The rule core applies, asked as it is typed: the name becomes a
      // directory, so a round trip spent on one it will refuse says nothing
      // that could not be said here.
      valid: isSkillName,
      invalid: t('skills.renameInvalid')
    })

    if (to !== null && to !== name) await skills.rename(folder, to)
  }

  const requestRemove = async (folder: string, name: string): Promise<void> => {
    const { confirmed } = await confirm({
      title: t('skills.removeTitle', { name }),
      message: t('skills.removeMessage'),
      detail: t('skills.removeDetail'),
      confirmLabel: t('skills.removeConfirm'),
      cancelLabel: t('skills.removeCancel'),
      destructive: true
    })

    if (confirmed) await skills.remove(folder)
  }

  const setDefault = (name: string, on: boolean): void => {
    const key = skillKey(name)

    onDefaults(on ? disabledDefaults.filter((entry) => entry !== key) : [...disabledDefaults, key])
  }

  return (
    <div className="space-y-6 text-[13px]">
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="font-medium">
            {store.kind === 'global' ? t('skills.global') : t('skills.project')}
          </p>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                setImporting(true)
              }}
            >
              {t('skills.import')}
            </Button>
            <Button
              variant="accent"
              onClick={() => {
                setCreating(true)
              }}
            >
              <Plus aria-hidden size={12} />
              {t('skills.add')}
            </Button>
          </div>
        </div>
        <p className="text-ink-faint mb-3 max-w-lg leading-relaxed">
          {store.kind === 'global' ? t('skills.globalNote') : t('skills.projectNote')}
        </p>

        {/* Not while the import dialog is open: it draws this message itself,
            because a modal covers this line and a refusal shown behind one is a
            refusal nobody reads. */}
        {skills.error !== null && !importing && <p className="text-danger mb-3">{skills.error}</p>}

        {skills.skills.length === 0 ? (
          <p className="text-ink-faint">{t('skills.empty')}</p>
        ) : (
          <ul className="border-line divide-line divide-y rounded-[var(--radius-panel)] border">
            {skills.skills.map((skill) => (
              <li key={skill.folder} className="flex items-center gap-3 px-3 py-2">
                <Switch
                  checked={!disabledDefaults.includes(skillKey(skill.name))}
                  label={t('skills.onByDefault')}
                  onChange={(on) => {
                    setDefault(skill.name, on)
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="text-ink block truncate">{skill.name}</span>
                  {skill.description !== '' && (
                    <span className="text-ink-faint block truncate text-[11px]">
                      {skill.description}
                    </span>
                  )}
                </span>
                <DropdownMenu
                  actions={[
                    {
                      id: 'edit',
                      label: t('skills.edit'),
                      onSelect: () => {
                        void open(skill.folder)
                      }
                    },
                    {
                      id: 'rename',
                      label: t('skills.rename'),
                      onSelect: () => {
                        void requestRename(skill.folder, skill.name)
                      }
                    },
                    {
                      id: 'remove',
                      label: t('skills.remove'),
                      destructive: true,
                      onSelect: () => {
                        void requestRemove(skill.folder, skill.name)
                      }
                    }
                  ]}
                  trigger={({ onClick, open: menuOpen }) => (
                    <Button
                      aria-label={t('skills.rowActions', { name: skill.name })}
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
      </div>

      {/* The file is read-only, and deliberately so: it belongs to the
          repository, and editing it from a settings dialog would be octopus
          writing inside somebody's checkout. Whether the agent loads it is a
          different question and ours to answer — the switch records that in
          our own state and writes nothing into the checkout. */}
      {carried.length > 0 && onCopyToGlobal !== undefined && (
        <div>
          <p className="mb-1.5 font-medium">{t('skills.inRepository')}</p>
          <p className="text-ink-faint mb-3 max-w-lg leading-relaxed">
            {t('skills.inRepositoryNote')}
          </p>
          <ul className="border-line divide-line divide-y rounded-[var(--radius-panel)] border">
            {carried.map((skill) => (
              <li key={skill.folder} className="flex items-center gap-3 px-3 py-2">
                <Switch
                  checked={!disabledDefaults.includes(skillKey(skill.name))}
                  label={t('skills.onByDefault')}
                  onChange={(on) => {
                    setDefault(skill.name, on)
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="text-ink block truncate">{skill.name}</span>
                  {skill.description !== '' && (
                    <span className="text-ink-faint block truncate text-[11px]">
                      {skill.description}
                    </span>
                  )}
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    void onCopyToGlobal(skill.path)
                  }}
                >
                  {t('skills.copyToGlobal')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(creating || editing !== null) && (
        <SkillEditor
          skill={editing}
          taken={skills.skills.map((skill) => skill.name)}
          onSave={skills.save}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}

      {importing && (
        <SkillImport
          onImport={skills.bring}
          onInspect={skills.inspect}
          error={skills.error}
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
