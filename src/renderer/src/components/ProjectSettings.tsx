import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Project } from '@core/store.js'

import { useErrorMessage } from '../hooks/useErrorMessage.js'
import { Button } from './Button.js'
import { Field } from './Field.js'
import { Modal } from './Modal.js'

interface ProjectSettingsProps {
  readonly project: Project
  /** Applies a change; omitted keys are left alone. */
  readonly onUpdate: (patch: { name?: string; baseBranch?: string }) => Promise<boolean>
  readonly onRemove: () => void
  readonly onClose: () => void
}

/**
 * Everything about one project in one place.
 *
 * Changes save as they are made, like the settings window: nothing here is a
 * multi-step edit, and a Save button would invite closing the dialog with work
 * still pending.
 */
export function ProjectSettings({
  project,
  onUpdate,
  onRemove,
  onClose
}: ProjectSettingsProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()

  const [name, setName] = useState(project.name)
  const [branches, setBranches] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const result = await window.octopus.projects.branches(project.id)
      if (controller.signal.aborted) return

      if (result.ok) {
        setBranches(result.value)
      } else {
        setError(describeFailure(result))
      }
    })()

    return () => {
      controller.abort()
    }
  }, [project.id, describeFailure])

  const commitName = (): void => {
    const trimmed = name.trim()
    // An empty field is a slip, not an instruction to erase the name.
    if (trimmed === '' || trimmed === project.name) {
      setName(project.name)
      return
    }

    void onUpdate({ name: trimmed })
  }

  const changeBranch = (baseBranch: string): void => {
    void (async () => {
      // A branch can be deleted between this list being read and this click,
      // so a refusal has to be visible rather than assumed away.
      if (!(await onUpdate({ baseBranch }))) setError(t('project.branchFailed'))
    })()
  }

  // The stored branch may be gone from the repository. Keeping it in the list
  // means the field shows what is actually configured instead of silently
  // displaying someone else's branch.
  const options = branches.includes(project.baseBranch)
    ? branches
    : [project.baseBranch, ...branches]

  return (
    <Modal
      title={t('project.title')}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t('project.done')}</Button>}
    >
      <div className="space-y-6">
        {error !== null && (
          <div className="bg-danger-bg text-danger border-danger/25 rounded-[var(--radius-control)] border px-3 py-2">
            {error}
          </div>
        )}

        <Field label={t('project.name')} hint={t('project.nameHint')}>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value)
            }}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') setName(project.name)
            }}
            className="border-line bg-canvas focus-ring h-8 w-full max-w-sm rounded-[var(--radius-control)] border px-2"
          />
        </Field>

        <Field label={t('project.baseBranch')} hint={t('project.baseBranchHint')}>
          <select
            value={project.baseBranch}
            onChange={(event) => {
              changeBranch(event.target.value)
            }}
            className="border-line bg-canvas focus-ring h-8 w-full max-w-sm rounded-[var(--radius-control)] border px-2 font-mono"
          >
            {options.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('project.repository')}>
          <p className="text-ink-faint truncate font-mono text-[11px]" title={project.repoPath}>
            {project.repoPath}
          </p>
        </Field>

        {/* Destructive actions sit apart and below, so reaching one is a
            deliberate move rather than a mis-click on the way past. */}
        <div className="border-danger/25 space-y-3 rounded-[var(--radius-control)] border p-4">
          <p className="text-danger font-medium">{t('project.dangerZone')}</p>
          <div className="flex items-center justify-between gap-4">
            <p className="text-ink-faint max-w-sm leading-relaxed">{t('project.removeHint')}</p>
            <Button variant="danger" onClick={onRemove}>
              {t('sidebar.removeProject')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
