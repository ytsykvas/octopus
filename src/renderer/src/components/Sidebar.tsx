import {
  ChevronDown,
  ChevronRight,
  CloudDownload,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings as SettingsIcon,
  Trash2
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Project } from '@core/store.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { Button } from './Button.js'
import { DropdownMenu } from './DropdownMenu.js'
import { WorkspaceRow } from './WorkspaceRow.js'

interface SidebarProps {
  readonly projects: readonly Project[]
  readonly workspaces: ReadonlyMap<string, readonly WorkspaceView[]>
  readonly selectedProjectId: string | null
  readonly selectedWorkspaceId: string | null
  readonly onSelectProject: (projectId: string) => void
  readonly onSelectWorkspace: (workspaceId: string) => void
  readonly onAddFromDisk: () => void
  readonly onAddFromGitHub: () => void
  readonly onEditProject: (projectId: string) => void
  readonly onRemoveProject: (projectId: string) => void
  readonly onCreateWorkspace: (projectId: string) => void
  readonly onRenameWorkspace: (workspaceId: string, name: string) => void
  readonly onRemoveWorkspace: (workspaceId: string) => void
  readonly onOpenSettings: () => void
  /** Workspace whose name is being edited — set right after creation. */
  readonly editingWorkspaceId: string | null
  readonly onEditingWorkspaceChange: (workspaceId: string | null) => void
  readonly busy: boolean
}

/**
 * Left pane — projects with their workspaces nested underneath (§10.8).
 */
export function Sidebar({
  projects,
  workspaces,
  selectedProjectId,
  selectedWorkspaceId,
  onSelectProject,
  onSelectWorkspace,
  onAddFromDisk,
  onAddFromGitHub,
  onEditProject,
  onRemoveProject,
  onCreateWorkspace,
  onRenameWorkspace,
  onRemoveWorkspace,
  onOpenSettings,
  editingWorkspaceId,
  onEditingWorkspaceChange,
  busy
}: SidebarProps): React.JSX.Element {
  const { t } = useTranslation()
  // Ephemeral on purpose: which projects are folded away is a view preference
  // for the current session, not something worth persisting.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  const toggle = (projectId: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }

  return (
    <aside className="border-line bg-surface flex w-64 shrink-0 flex-col border-r">
      <div className="titlebar-drag h-11 shrink-0" />

      <div className="flex items-center justify-between px-3 pb-1.5">
        <span className="section-label">{t('sidebar.projects')}</span>
        <AddMenu busy={busy} onAddFromDisk={onAddFromDisk} onAddFromGitHub={onAddFromGitHub} />
      </div>

      <nav className="flex-1 overflow-auto px-2 pb-3">
        {projects.length === 0 ? (
          <p className="text-ink-faint px-2 py-3 leading-relaxed">{t('sidebar.empty')}</p>
        ) : (
          <ul className="space-y-1">
            {projects.map((project) => (
              <li key={project.id}>
                <ProjectRow
                  project={project}
                  // Only one row is highlighted at a time: picking a
                  // workspace hands the highlight over to it.
                  selected={project.id === selectedProjectId && selectedWorkspaceId === null}
                  collapsed={collapsed.has(project.id)}
                  workspaceCount={(workspaces.get(project.id) ?? []).length}
                  onSelect={() => {
                    onSelectProject(project.id)
                    toggle(project.id)
                  }}
                  onEdit={() => {
                    onEditProject(project.id)
                  }}
                  onRemove={() => {
                    onRemoveProject(project.id)
                  }}
                  onCreateWorkspace={() => {
                    onCreateWorkspace(project.id)
                  }}
                />

                <WorkspaceList
                  workspaces={collapsed.has(project.id) ? [] : (workspaces.get(project.id) ?? [])}
                  selectedWorkspaceId={selectedWorkspaceId}
                  editingWorkspaceId={editingWorkspaceId}
                  onSelect={onSelectWorkspace}
                  onRename={onRenameWorkspace}
                  onRemove={onRemoveWorkspace}
                  onEditingChange={onEditingWorkspaceChange}
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
          <SettingsIcon aria-hidden size={14} />
          {t('sidebar.settings')}
        </button>
      </div>
    </aside>
  )
}

function WorkspaceList({
  workspaces,
  selectedWorkspaceId,
  editingWorkspaceId,
  onSelect,
  onRename,
  onRemove,
  onEditingChange
}: {
  workspaces: readonly WorkspaceView[]
  selectedWorkspaceId: string | null
  editingWorkspaceId: string | null
  onSelect: (workspaceId: string) => void
  onRename: (workspaceId: string, name: string) => void
  onRemove: (workspaceId: string) => void
  onEditingChange: (workspaceId: string | null) => void
}): React.JSX.Element | null {
  if (workspaces.length === 0) return null

  return (
    <ul className="border-line mt-0.5 ml-3 space-y-px border-l pl-1">
      {workspaces.map((workspace) => (
        <li key={workspace.id}>
          <WorkspaceRow
            workspace={workspace}
            selected={workspace.id === selectedWorkspaceId}
            editing={workspace.id === editingWorkspaceId}
            onSelect={() => {
              onSelect(workspace.id)
            }}
            onRename={(name) => {
              onRename(workspace.id, name)
            }}
            onRemove={() => {
              onRemove(workspace.id)
            }}
            onEditingChange={(editing) => {
              onEditingChange(editing ? workspace.id : null)
            }}
          />
        </li>
      ))}
    </ul>
  )
}

/**
 * Choice of where a project comes from.
 *
 * A menu rather than two buttons: adding a project is one action with two
 * sources, and the sidebar has little room to spare.
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

  return (
    <DropdownMenu
      trigger={({ onClick }) => (
        <Button
          variant="quiet"
          size="sm"
          disabled={busy}
          title={t('sidebar.addProject')}
          onClick={onClick}
        >
          <Plus aria-hidden size={14} />
        </Button>
      )}
      actions={[
        {
          id: 'disk',
          label: t('sidebar.addFromDisk'),
          icon: <FolderOpen aria-hidden size={14} />,
          onSelect: onAddFromDisk
        },
        {
          id: 'github',
          label: t('sidebar.addFromGitHub'),
          icon: <CloudDownload aria-hidden size={14} />,
          onSelect: onAddFromGitHub
        }
      ]}
    />
  )
}

interface ProjectRowProps {
  readonly project: Project
  readonly selected: boolean
  readonly collapsed: boolean
  readonly workspaceCount: number
  readonly onSelect: () => void
  readonly onEdit: () => void
  readonly onRemove: () => void
  readonly onCreateWorkspace: () => void
}

function ProjectRow({
  project,
  selected,
  collapsed,
  workspaceCount,
  onSelect,
  onEdit,
  onRemove,
  onCreateWorkspace
}: ProjectRowProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      className={`row group flex items-center gap-1 px-2 py-1.5 ${selected ? 'row-selected' : ''}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="focus-ring flex min-w-0 flex-1 items-center gap-1.5 rounded-[var(--radius-control)] text-left"
        title={project.repoPath}
      >
        {/* The chevron only appears once there is something to fold away. */}
        <span className="text-ink-faint w-3 shrink-0">
          {workspaceCount > 0 &&
            (collapsed ? (
              <ChevronRight aria-hidden size={12} />
            ) : (
              <ChevronDown aria-hidden size={12} />
            ))}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{project.name}</span>
          <span className="text-ink-faint block truncate font-mono text-[11px]">
            {project.baseBranch}
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={onCreateWorkspace}
        title={t('workspaces.create')}
        className="text-ink-faint hover:text-accent focus-ring shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <Plus aria-hidden size={13} />
      </button>

      {/* Both live behind a menu: occasional actions, and a button each on
          every row was more noise than the list could carry. */}
      <DropdownMenu
        trigger={({ onClick, open }) => (
          <button
            type="button"
            onClick={onClick}
            title={t('sidebar.projectActions')}
            className={`text-ink-faint hover:text-ink focus-ring shrink-0 rounded p-1 transition-opacity ${
              open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            <MoreHorizontal aria-hidden size={13} />
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
