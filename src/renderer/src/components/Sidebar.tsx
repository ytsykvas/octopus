import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Project } from '@core/store.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { ResizeHandle } from './ResizeHandle.js'
import { WorkspaceRow } from './WorkspaceRow.js'

/** Matches the bounds on `sidebarWidth` in the config schema. */
const MIN_WIDTH = 180
const MAX_WIDTH = 560

interface SidebarProps {
  /** The project whose workspaces are listed; null when none is selected. */
  readonly project: Project | null
  readonly workspaces: readonly WorkspaceView[]
  readonly selectedWorkspaceId: string | null
  readonly onSelectWorkspace: (workspaceId: string) => void
  readonly onCreateWorkspace: () => void
  readonly width: number
  /** Persists the width; called when a drag ends, not during it. */
  readonly onWidthChange: (width: number) => void
  readonly onRenameWorkspace: (workspaceId: string, name: string) => void
  readonly onRemoveWorkspace: (workspaceId: string) => void
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
  onCreateWorkspace,
  width,
  onWidthChange,
  onRenameWorkspace,
  onRemoveWorkspace,
  editingWorkspaceId,
  onEditingWorkspaceChange
}: SidebarProps): React.JSX.Element {
  const { t } = useTranslation()
  // The pane follows the cursor from local state; the config only hears about
  // the width once the drag is over.
  const [dragWidth, setDragWidth] = useState<number | null>(null)

  return (
    <aside
      className="border-line bg-surface relative flex shrink-0 flex-col border-r"
      style={{
        width: dragWidth ?? width,
        ...(project
          ? ({ '--project-color': `var(--project-${project.color})` } as React.CSSProperties)
          : {})
      }}
    >
      <ResizeHandle
        grows="right"
        width={dragWidth ?? width}
        min={MIN_WIDTH}
        max={MAX_WIDTH}
        onResize={setDragWidth}
        onCommit={(committed) => {
          setDragWidth(null)
          onWidthChange(committed)
        }}
      />

      {/* Left plain: the colour belongs to the project, and this strip is above
          where the project is named. */}
      <div className="titlebar-drag h-11 shrink-0" />

      {project ? (
        // Strongest at the name and fading down the list, so the colour reads
        // as belonging to the header rather than as a wash over the rows.
        <div className="project-tinted flex min-h-0 flex-1 flex-col">
          <ProjectHeader project={project} onCreateWorkspace={onCreateWorkspace} />

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
        </div>
      ) : (
        <p className="text-ink-faint flex-1 px-4 py-3 leading-relaxed">{t('sidebar.empty')}</p>
      )}
    </aside>
  )
}

/**
 * Which project this list belongs to.
 *
 * The name is here rather than on the tab because the tab has room for two
 * letters. Editing and removal are not: they live on the tab's own menu, and
 * offering them twice within one glance is noise, not convenience.
 */
function ProjectHeader({
  project,
  onCreateWorkspace
}: {
  project: Project
  onCreateWorkspace: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="border-line flex items-start gap-1 border-b px-3 pt-2 pb-2.5">
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
    </div>
  )
}
