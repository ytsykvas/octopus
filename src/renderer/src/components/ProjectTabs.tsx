import { CloudDownload, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { initials } from '@core/initials.js'
import type { Project } from '@core/store.js'

import { DropdownMenu } from './DropdownMenu.js'
import { ProjectGlyph } from './ProjectGlyph.js'

/**
 * What the initials or the icon are drawn in: the project's colour, a quarter
 * of the way towards the ink.
 *
 * The colour alone, or mixed with `--ink-faint` as these were, left the worst of
 * the fifteen at 3.3:1 in the light theme on the tile (lime) — under the 4.5:1
 * text needs, and these are letters. A quarter of ink brings every colour to at
 * least 5.2:1 on an idle tile and 4.8:1 on the chosen one, in both themes, and
 * leaves the hue plain: the tab is how a project is recognised, so it is not
 * pushed further towards grey than that. The same mix the right pane's chosen
 * tab uses.
 */
const LETTERS = 'color-mix(in srgb, var(--project-color) 75%, var(--ink))'

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
 * A tab is a colour and either two letters or an icon. The letters collide
 * readily — two repositories starting the same way give the same pair — which
 * is why an icon can be chosen instead, and why the full name is a hover away
 * either way.
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
    <nav className="bg-surface flex w-14 shrink-0 flex-col">
      <div className="flex flex-1 flex-col gap-1 overflow-y-auto py-2 pl-2.5">
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
              className="text-ink-faint hover:border-ink-faint hover:text-ink focus-ring border-line mt-1 flex size-9 items-center justify-center rounded-[10px] border border-dashed transition-colors disabled:opacity-50"
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
            // The active tab runs to the right edge of the strip and squares
            // off there, so it reads as the sidebar reaching back rather than
            // as a button sitting next to it.
            className={`focus-ring flex h-9 items-center justify-center text-[13px] font-semibold transition-[background-color,color] ${
              active ? 'w-[46px] rounded-l-[10px]' : 'w-9 rounded-[10px]'
            }`}
            style={
              active
                ? {
                    // Matches the top of the sidebar's gradient exactly: the
                    // two surfaces meet with nothing between them.
                    backgroundColor: 'color-mix(in srgb, var(--project-color) 18%, var(--surface))',
                    color: LETTERS
                  }
                : {
                    backgroundColor: 'color-mix(in srgb, var(--project-color) 14%, transparent)',
                    color: LETTERS
                  }
            }
          >
            {/* An icon replaces the initials rather than joining them: 36px
                holds one or the other, and the initials are the fallback for a
                project nobody has picked a picture for. */}
            {project.icon ? <ProjectGlyph name={project.icon} size={17} /> : initials(project.name)}
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
