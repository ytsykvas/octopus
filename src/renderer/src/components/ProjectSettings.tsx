import { GitBranch, Info, Terminal, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PROJECT_COLORS } from '@core/colors.js'
import type { Project, ProjectPatch } from '@core/store.js'

import { useErrorMessage } from '../hooks/useErrorMessage.js'
import { Button } from './Button.js'
import { Combobox } from './Combobox.js'
import { Field } from './Field.js'
import { Modal } from './Modal.js'
import { SectionRail } from './SectionRail.js'
import { ScriptEditor } from './ScriptEditor.js'

interface ProjectSettingsProps {
  readonly project: Project
  /** Applies a change; omitted keys are left alone. */
  readonly onUpdate: (patch: ProjectPatch) => Promise<boolean>
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
/**
 * Drops the remote prefix for display.
 *
 * Every entry in the list carries the same `origin/`, so it is noise in all of
 * them at once. Only `origin/` is stripped, not any first segment: the list
 * falls back to local branches when a repository has no remote, and `feature/x`
 * must not be shown as `x`.
 */
function shortBranch(branch: string): string {
  return branch.startsWith('origin/') ? branch.slice('origin/'.length) : branch
}

type SectionId = 'general' | 'git' | 'scripts' | 'danger'

const SECTIONS: readonly {
  readonly id: SectionId
  readonly labelKey:
    | 'project.sectionGeneral'
    | 'project.sectionGit'
    | 'project.sectionScripts'
    | 'project.sectionDanger'
  readonly Icon: typeof Info
  readonly destructive?: boolean
}[] = [
  { id: 'general', labelKey: 'project.sectionGeneral', Icon: Info },
  { id: 'git', labelKey: 'project.sectionGit', Icon: GitBranch },
  { id: 'scripts', labelKey: 'project.sectionScripts', Icon: Terminal },
  { id: 'danger', labelKey: 'project.sectionDanger', Icon: TriangleAlert, destructive: true }
]

export function ProjectSettings({
  project,
  onUpdate,
  onRemove,
  onClose
}: ProjectSettingsProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()

  const [section, setSection] = useState<SectionId>('general')
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

  return (
    <Modal
      size="lg"
      title={t('project.title')}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t('project.done')}</Button>}
    >
      {/* A rail rather than one long scroll: the sections have nothing to do
          with each other, and the same shape as the settings window means one
          way of navigating rather than two. */}
      <div className="flex min-h-0 flex-1">
        <SectionRail
          sections={SECTIONS.map((item) => ({ ...item, label: t(item.labelKey) }))}
          active={section}
          onSelect={setSection}
        />

        <div className="min-w-0 flex-1 space-y-6 overflow-auto p-6">
          {error !== null && (
            <div className="bg-danger-bg text-danger border-danger/25 rounded-[var(--radius-control)] border px-3 py-2">
              {error}
            </div>
          )}

          {section === 'general' && (
            <>
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
                  className="input focus-ring max-w-sm"
                />
              </Field>

              <Field label={t('project.color')} hint={t('project.colorHint')}>
                <div className="flex flex-wrap gap-1.5">
                  {PROJECT_COLORS.map((colour) => (
                    <button
                      key={colour}
                      type="button"
                      onClick={() => void onUpdate({ color: colour })}
                      title={colour}
                      aria-pressed={colour === project.color}
                      className={`focus-ring size-6 rounded-full transition-transform hover:scale-110 ${
                        colour === project.color ? 'ring-ink-faint ring-2 ring-offset-2' : ''
                      }`}
                      // The swatch is the colour, so it cannot come from a class.
                      style={{
                        backgroundColor: `var(--project-${colour})`,
                        // Tailwind's offset colour is a variable, not a token here.
                        ['--tw-ring-offset-color' as string]: 'var(--canvas)'
                      }}
                    />
                  ))}
                </div>
              </Field>

              <Field label={t('project.repository')}>
                <p
                  className="text-ink-faint truncate font-mono text-[11px]"
                  title={project.repoPath}
                >
                  {project.repoPath}
                </p>
              </Field>
            </>
          )}

          {/* The list is only what the repository offers. A project added before
              this dialog existed may still sit on a local `main`, and showing
              that next to `origin/main` would list two entries for what reads as
              one branch. The button shows the stored value either way, so the
              difference is visible and one click from fixed. */}
          {section === 'git' && (
            <Field label={t('project.baseBranch')} hint={t('project.baseBranchHint')}>
              <Combobox
                value={project.baseBranch}
                options={branches}
                onChange={changeBranch}
                placeholder={t('project.branchSearch')}
                emptyLabel={t('project.branchNone')}
                display={shortBranch}
              />
            </Field>
          )}

          {section === 'scripts' && (
            <>
              <ScriptEditor
                projectId={project.id}
                kind="setup"
                label={t('project.setupScript')}
                hint={t('project.setupScriptHint')}
              />

              <ScriptEditor
                projectId={project.id}
                kind="run"
                label={t('project.runScript')}
                hint={t('project.runScriptHint')}
              />
            </>
          )}

          {/* Reaching removal now takes choosing the section it lives in, which
              is a further step away from a mis-click than a scroll was. */}
          {section === 'danger' && (
            <div className="border-danger/25 bg-danger-bg/40 space-y-2.5 rounded-[var(--radius-control)] border p-3.5">
              <p className="text-danger font-medium">{t('project.dangerZone')}</p>
              <p className="text-ink-faint leading-relaxed">{t('project.removeHint')}</p>
              <Button variant="destructive" onClick={onRemove}>
                {t('sidebar.removeProject')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
