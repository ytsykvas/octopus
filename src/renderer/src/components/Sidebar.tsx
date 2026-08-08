import { MoreHorizontal, Pencil, Plus, Settings as SettingsIcon, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { Project } from '@core/store.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { DropdownMenu } from './DropdownMenu.js'
import { WorkspaceRow } from './WorkspaceRow.js'

interface SidebarProps {
  /** The project whose workspaces are listed; null when none is selected. */
  readonly project: Project | null
  readonly workspaces: readonly WorkspaceView[]
  readonly selectedWorkspaceId: string | null
  readonly onSelectWorkspace: (workspaceId: string) => void
  readonly onEditProject: () => void
  readonly onRemoveProject: () => void
  readonly onCreateWorkspace: () => void
  readonly onRenameWorkspace: (workspaceId: string, name: string) => void
  readonly onRemoveWorkspace: (workspaceId: string) => void
  readonly onOpenSettings: () => void
  /** Workspace whose name is being edited — set right after creation. */
  readonly editingWorkspaceId: string | null
  readonly onEditingWorkspaceChange: (workspaceId: string | null) => void
}

/**
 * Second pane — the workspaces of one project (§10.8).
 *
 * Projects moved out to the tab strip, so this list only ever holds one
 * project's worth of rows and stops growing with the number of repositories.
 * It carries a wash of the project's colour, which is what makes "where am I"
 * answerable without reading anything.
 */
export function Sidebar({
  project,
  workspaces,
  selectedWorkspaceId,
  onSelectWorkspace,
  onEditProject,
  onRemoveProject,
  onCreateWorkspace,
  onRenameWorkspace,
  onRemoveWorkspace,
  onOpenSettings,
  editingWorkspaceId,
  onEditingWorkspaceChange
}: SidebarProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <aside
      className={`border-line flex w-60 shrink-0 flex-col border-r ${
        project ? 'project-tinted' : 'bg-surface'
      }`}
      style={
        project
          ? ({ '--project-color': `var(--project-${project.color})` } as React.CSSProperties)
          : undefined
      }
    >
      <div className="titlebar-drag h-11 shrink-0" />

      {project ? (
        <>
          <ProjectHeader
            project={project}
            onEdit={onEditProject}
            onRemove={onRemoveProject}
            onCreateWorkspace={onCreateWorkspace}
          />

          <nav className="flex-1 overflow-auto px-2 py-2">
            {workspaces.length === 0 ? (
              <p className="text-ink-faint px-2 py-2 leading-relaxed">
                {t('workspaces.emptyForProject')}
              </p>
            ) : (
              <ul className="space-y-px">
                {workspaces.map((workspace) => (
                  <li key={workspace.id}>
                    <WorkspaceRow
                      workspace={workspace}
                      selected={workspace.id === selectedWorkspaceId}
                      editing={workspace.id === editingWorkspaceId}
                      onSelect={() => {
                        onSelectWorkspace(workspace.id)
                      }}
                      onRename={(name) => {
                        onRenameWorkspace(workspace.id, name)
                      }}
                      onRemove={() => {
                        onRemoveWorkspace(workspace.id)
                      }}
                      onEditingChange={(editing) => {
                        onEditingWorkspaceChange(editing ? workspace.id : null)
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </nav>
        </>
      ) : (
        <p className="text-ink-faint flex-1 px-4 py-3 leading-relaxed">{t('sidebar.empty')}</p>
      )}

      <div className="border-line border-t p-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="row focus-ring text-ink-soft hover:text-ink flex w-full items-center gap-2 px-2 py-1.5"
        >
          <SettingsIcon aria-hidden size={14} />
          {t('sidebar.settings')}
        </button>
      </div>
    </aside>
  )
}

/**
 * Which project this list belongs to, and what can be done to it.
 *
 * The name is here rather than on the tab because the tab has room for two
 * letters; this is where the project is actually identified.
 */
function ProjectHeader({
  project,
  onEdit,
  onRemove,
  onCreateWorkspace
}: {
  project: Project
  onEdit: () => void
  onRemove: () => void
  onCreateWorkspace: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="border-line flex items-start gap-1 border-b px-3 pb-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={project.repoPath}>
          {project.name}
        </p>
        <p className="text-ink-faint truncate font-mono text-[11px]">{project.baseBranch}</p>
      </div>

      <button
        type="button"
        onClick={onCreateWorkspace}
        title={t('workspaces.create')}
        className="text-ink-faint hover:text-ink focus-ring shrink-0 rounded p-1 transition-colors"
      >
        <Plus aria-hidden size={14} />
      </button>

      <DropdownMenu
        trigger={({ onClick }) => (
          <button
            type="button"
            onClick={onClick}
            title={t('sidebar.projectActions')}
            className="text-ink-faint hover:text-ink focus-ring shrink-0 rounded p-1 transition-colors"
          >
            <MoreHorizontal aria-hidden size={14} />
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
