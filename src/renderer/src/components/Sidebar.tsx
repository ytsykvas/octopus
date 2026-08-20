import { GitBranch, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { shortBranchName } from '@core/branches.js'
import type { Project } from '@core/store.js'
import type { BranchRequest } from '@core/pullRequestShapes.js'
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
  /**
   * What each branch's pull request is, by branch name.
   *
   * Read for the whole project at once rather than per row: the mark is wanted
   * on every row, and a read per row would be a network call per row.
   */
  readonly requests: ReadonlyMap<string, BranchRequest>
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
  requests,
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
                      request={requests.get(workspace.branch) ?? null}
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

  // A stronger line than elsewhere: this one sits on the project's colour
  // wash, where the ordinary border — chosen against a neutral surface — all
  // but disappears.
  return (
    <div className="border-line-strong flex items-start gap-1 border-b px-3 pt-2 pb-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={project.repoPath}>
          {project.name}
        </p>

        {/* The icon says "branch" so the line beneath the name is not read as a
            path. The full ref stays in the title, for when origin/ is the part
            you actually want. */}
        <p
          className="text-ink-faint flex items-center gap-1 text-[11px]"
          title={project.baseBranch}
        >
          <GitBranch aria-hidden size={11} className="shrink-0" />
          <span className="truncate font-mono">{shortBranchName(project.baseBranch)}</span>
        </p>
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
