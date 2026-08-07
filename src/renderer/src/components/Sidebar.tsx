import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Project } from '@core/store.js'

import { Button } from './Button.js'

interface SidebarProps {
  readonly projects: readonly Project[]
  readonly selectedProjectId: string | null
  readonly onSelectProject: (projectId: string) => void
  readonly onAddFromDisk: () => void
  readonly onAddFromGitHub: () => void
  readonly onRemoveProject: (projectId: string) => void
  readonly onOpenSettings: () => void
  readonly busy: boolean
}

/**
 * Left pane — projects and workspaces (§10.8).
 *
 * Until workspaces exist it lists projects only. Step 3 will nest each
 * project's workspaces underneath it, with agent status.
 */
export function Sidebar({
  projects,
  selectedProjectId,
  onSelectProject,
  onAddFromDisk,
  onAddFromGitHub,
  onRemoveProject,
  onOpenSettings,
  busy
}: SidebarProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <aside className="border-line bg-surface flex w-60 shrink-0 flex-col border-r">
      <div className="titlebar-drag h-11 shrink-0" />

      <div className="flex items-center justify-between px-3 pb-1.5">
        <span className="section-label">{t('sidebar.projects')}</span>
        <AddMenu busy={busy} onAddFromDisk={onAddFromDisk} onAddFromGitHub={onAddFromGitHub} />
      </div>

      <nav className="flex-1 overflow-auto px-2 pb-3">
        {projects.length === 0 ? (
          <p className="text-ink-faint px-2 py-3 leading-relaxed">{t('sidebar.empty')}</p>
        ) : (
          <ul className="space-y-px">
            {projects.map((project) => (
              <li key={project.id}>
                <ProjectRow
                  project={project}
                  selected={project.id === selectedProjectId}
                  onSelect={() => {
                    onSelectProject(project.id)
                  }}
                  onRemove={() => {
                    onRemoveProject(project.id)
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </nav>

      <div className="border-line border-t p-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="row focus-ring text-ink-soft hover:text-ink flex w-full items-center gap-2 px-2 py-1.5"
        >
          <span aria-hidden>⚙</span>
          {t('sidebar.settings')}
        </button>
      </div>
    </aside>
  )
}

/**
 * Choice of where a project comes from.
 *
 * A small menu rather than two buttons: adding a project is one action with
 * two sources, and the sidebar has little room to spare.
 */
function AddMenu({
  busy,
  onAddFromDisk,
  onAddFromGitHub
}: {
  busy: boolean
  onAddFromDisk: () => void
  onAddFromGitHub: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return

    const close = (): void => {
      setOpen(false)
    }
    // Any click outside dismisses it, as a menu should.
    window.addEventListener('click', close)
    return () => {
      window.removeEventListener('click', close)
    }
  }, [open])

  return (
    <div className="relative">
      <Button
        variant="quiet"
        size="sm"
        disabled={busy}
        title={t('sidebar.addProject')}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}
      >
        {busy ? '…' : '+'}
      </Button>

      {open && (
        <div className="border-line bg-canvas absolute right-0 z-10 mt-1 w-40 rounded-[var(--radius-control)] border p-1 shadow-[var(--shadow-pop)]">
          <MenuItem
            label={t('sidebar.addFromDisk')}
            onClick={() => {
              setOpen(false)
              onAddFromDisk()
            }}
          />
          <MenuItem
            label={t('sidebar.addFromGitHub')}
            onClick={() => {
              setOpen(false)
              onAddFromGitHub()
            }}
          />
        </div>
      )}
    </div>
  )
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className="row focus-ring w-full px-2 py-1 text-left">
      {label}
    </button>
  )
}

interface ProjectRowProps {
  readonly project: Project
  readonly selected: boolean
  readonly onSelect: () => void
  readonly onRemove: () => void
}

function ProjectRow({ project, selected, onSelect, onRemove }: ProjectRowProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      className={`row group flex items-center gap-2 px-2 py-1.5 ${selected ? 'row-selected' : ''}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="focus-ring min-w-0 flex-1 rounded-[var(--radius-control)] text-left"
        title={project.repoPath}
      >
        <span className="block truncate font-medium">{project.name}</span>
        <span className="text-ink-faint block truncate font-mono text-[11px]">
          {project.baseBranch}
        </span>
      </button>

      <button
        type="button"
        onClick={onRemove}
        title={t('sidebar.removeProject')}
        className="text-ink-faint hover:text-danger focus-ring shrink-0 rounded px-1 opacity-0 transition-opacity group-hover:opacity-100"
      >
        ✕
      </button>
    </div>
  )
}
