import { CloudDownload, FolderOpen, Pencil, Plus, Settings as SettingsIcon, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Project } from '@core/store.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { Button } from './Button.js'
import { NameEditor } from './NameEditor.js'
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
  readonly onRemoveProject: (projectId: string) => void
  readonly onRenameProject: (projectId: string, name: string) => void
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
  onRemoveProject,
  onRenameProject,
  onCreateWorkspace,
  onRenameWorkspace,
  onRemoveWorkspace,
  onOpenSettings,
  editingWorkspaceId,
  onEditingWorkspaceChange,
  busy
}: SidebarProps): React.JSX.Element {
  const { t } = useTranslation()

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
                  selected={project.id === selectedProjectId}
                  onSelect={() => {
                    onSelectProject(project.id)
                  }}
                  onRemove={() => {
                    onRemoveProject(project.id)
                  }}
                  onRename={(name) => {
                    onRenameProject(project.id, name)
                  }}
                  onCreateWorkspace={() => {
                    onCreateWorkspace(project.id)
                  }}
                />

                <WorkspaceList
                  workspaces={workspaces.get(project.id) ?? []}
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
        <Plus aria-hidden size={14} />
      </Button>

      {open && (
        <div className="border-line bg-canvas absolute right-0 z-10 mt-1 w-40 rounded-[var(--radius-control)] border p-1 shadow-[var(--shadow-pop)]">
          <MenuItem
            icon={<FolderOpen aria-hidden size={14} />}
            label={t('sidebar.addFromDisk')}
            onClick={() => {
              setOpen(false)
              onAddFromDisk()
            }}
          />
          <MenuItem
            icon={<CloudDownload aria-hidden size={14} />}
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

function MenuItem({
  icon,
  label,
  onClick
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="row focus-ring text-ink-soft hover:text-ink flex w-full items-center gap-2 px-2 py-1 text-left"
    >
      {icon}
      {label}
    </button>
  )
}

interface ProjectRowProps {
  readonly project: Project
  readonly selected: boolean
  readonly onSelect: () => void
  readonly onRemove: () => void
  readonly onRename: (name: string) => void
  readonly onCreateWorkspace: () => void
}

function ProjectRow({
  project,
  selected,
  onSelect,
  onRemove,
  onRename,
  onCreateWorkspace
}: ProjectRowProps): React.JSX.Element {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <NameEditor
        initial={project.name}
        onCommit={(name) => {
          setEditing(false)
          if (name !== project.name) onRename(name)
        }}
        onCancel={() => {
          setEditing(false)
        }}
      />
    )
  }

  return (
    <div
      className={`row group flex items-center gap-1 px-2 py-1.5 ${selected ? 'row-selected' : ''}`}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={() => {
          setEditing(true)
        }}
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
        onClick={onCreateWorkspace}
        title={t('workspaces.create')}
        className="text-ink-faint hover:text-accent focus-ring shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <Plus aria-hidden size={13} />
      </button>

      <button
        type="button"
        onClick={() => {
          setEditing(true)
        }}
        title={t('sidebar.renameProject')}
        className="text-ink-faint hover:text-ink focus-ring shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <Pencil aria-hidden size={13} />
      </button>

      <button
        type="button"
        onClick={onRemove}
        title={t('sidebar.removeProject')}
        className="text-ink-faint hover:text-danger focus-ring shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <X aria-hidden size={13} />
      </button>
    </div>
  )
}
