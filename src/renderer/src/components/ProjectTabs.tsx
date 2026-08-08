import { CloudDownload, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { initials } from '@core/initials.js'
import type { Project } from '@core/store.js'

import { DropdownMenu } from './DropdownMenu.js'

interface ProjectTabsProps {
  readonly projects: readonly Project[]
  readonly activeProjectId: string | null
  readonly onSelect: (projectId: string) => void
  readonly onEdit: (projectId: string) => void
  readonly onRemove: (projectId: string) => void
  readonly onAddFromDisk: () => void
  readonly onAddFromGitHub: () => void
  readonly busy: boolean
}

/**
 * Projects as a vertical tab strip, in the manner of browser tabs.
 *
 * Switching project and moving around inside one used to be the same list,
 * where a click both selected and folded. Splitting them means the strip
 * answers "which project" and the sidebar answers "which workspace", and
 * neither has to grow past the height of the window.
 *
 * A tab is two letters and a colour. The letters collide readily — two
 * repositories starting the same way give the same pair — which is why the
 * colour exists and why the full name is a hover away.
 */
export function ProjectTabs({
  projects,
  activeProjectId,
  onSelect,
  onEdit,
  onRemove,
  onAddFromDisk,
  onAddFromGitHub,
  busy
}: ProjectTabsProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <nav className="border-line bg-surface flex w-14 shrink-0 flex-col items-center border-r">
      {/* Clears the traffic lights, and keeps the window draggable up here. */}
      <div className="titlebar-drag h-11 w-full shrink-0" />

      <div className="flex flex-1 flex-col items-center gap-1.5 overflow-auto py-1">
        {projects.map((project) => (
          <ProjectTab
            key={project.id}
            project={project}
            active={project.id === activeProjectId}
            onSelect={() => {
              onSelect(project.id)
            }}
            onEdit={() => {
              onEdit(project.id)
            }}
            onRemove={() => {
              onRemove(project.id)
            }}
          />
        ))}

        <DropdownMenu
          align="left"
          trigger={({ onClick }) => (
            <button
              type="button"
              disabled={busy}
              onClick={onClick}
              title={t('sidebar.addProject')}
              className="text-ink-faint hover:border-ink-faint hover:text-ink focus-ring border-line flex size-9 items-center justify-center rounded-[10px] border border-dashed transition-colors disabled:opacity-50"
            >
              <Plus aria-hidden size={16} />
            </button>
          )}
          actions={[
            {
              id: 'disk',
              label: t('sidebar.addFromDisk'),
              description: t('sidebar.addFromDiskHint'),
              icon: <FolderOpen aria-hidden size={15} />,
              onSelect: onAddFromDisk
            },
            {
              id: 'github',
              label: t('sidebar.addFromGitHub'),
              description: t('sidebar.addFromGitHubHint'),
              icon: <CloudDownload aria-hidden size={15} />,
              onSelect: onAddFromGitHub
            }
          ]}
        />
      </div>
    </nav>
  )
}

function ProjectTab({
  project,
  active,
  onSelect,
  onEdit,
  onRemove
}: {
  project: Project
  active: boolean
  onSelect: () => void
  onEdit: () => void
  onRemove: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      className="relative"
      style={{ '--project-color': `var(--project-${project.color})` } as React.CSSProperties}
    >
      {/* The marker sits on the strip's edge rather than on the tile, so the
          active project is findable without comparing fills. */}
      {active && (
        <span
          aria-hidden
          className="absolute top-1/2 -left-[13px] h-5 w-[3px] -translate-y-1/2 rounded-r-full"
          style={{ backgroundColor: 'var(--project-color)' }}
        />
      )}

      <DropdownMenu
        align="left"
        trigger={({ onClick }) => (
          <button
            type="button"
            onClick={onSelect}
            onContextMenu={(event) => {
              event.preventDefault()
              onClick(event)
            }}
            title={`${project.name} — ${project.baseBranch}`}
            aria-current={active ? 'true' : undefined}
            className="focus-ring flex size-9 items-center justify-center rounded-[10px] text-[13px] font-semibold transition-[background-color,color]"
            style={
              active
                ? { backgroundColor: 'var(--project-color)', color: 'var(--project-ink)' }
                : {
                    backgroundColor: 'color-mix(in srgb, var(--project-color) 26%, transparent)',
                    color: 'var(--project-color)'
                  }
            }
          >
            {initials(project.name)}
          </button>
        )}
        actions={[
          {
            id: 'edit',
            label: t('sidebar.editProject'),
            icon: <Pencil aria-hidden size={13} />,
            onSelect: onEdit
          },
          {
            id: 'remove',
            label: t('sidebar.removeProject'),
            icon: <Trash2 aria-hidden size={13} />,
            destructive: true,
            onSelect: onRemove
          }
        ]}
      />
    </div>
  )
}
