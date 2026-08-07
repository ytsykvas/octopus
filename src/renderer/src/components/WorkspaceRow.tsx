import { AlertTriangle, Pencil, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { WorkspaceView } from '@core/workspaces.js'

import { NameEditor } from './NameEditor.js'

interface WorkspaceRowProps {
  readonly workspace: WorkspaceView
  readonly selected: boolean
  readonly editing: boolean
  readonly onSelect: () => void
  readonly onRename: (name: string) => void
  readonly onEditingChange: (editing: boolean) => void
  readonly onRemove: () => void
}

/**
 * One workspace under its project.
 *
 * The label is the workspace name, which tracks the branch — §10.8 puts the
 * branch first because that is what shows up in a pull request. The change
 * count stands in for agent status until the agent exists.
 */
export function WorkspaceRow({
  workspace,
  selected,
  editing,
  onSelect,
  onRename,
  onEditingChange,
  onRemove
}: WorkspaceRowProps): React.JSX.Element {
  const { t } = useTranslation()

  if (editing) {
    return (
      <NameEditor
        initial={workspace.name}
        onCommit={(name) => {
          onEditingChange(false)
          if (name !== workspace.name) onRename(name)
        }}
        onCancel={() => {
          onEditingChange(false)
        }}
      />
    )
  }

  return (
    <div
      className={`row group flex items-center gap-1 py-1 pr-1 pl-2 ${selected ? 'row-selected' : ''}`}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={() => {
          onEditingChange(true)
        }}
        className="focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] text-left"
        title={workspace.missing ? t('workspaces.missingHint') : workspace.branch}
      >
        <StatusMark workspace={workspace} />
        <span className={`truncate ${workspace.missing ? 'text-ink-faint line-through' : ''}`}>
          {workspace.name}
        </span>

        {workspace.missing ? (
          <span className="text-warning ml-auto shrink-0 text-[11px]">
            {t('workspaces.missing')}
          </span>
        ) : (
          workspace.changedFiles > 0 && (
            <span className="text-ink-faint ml-auto shrink-0 text-[11px]">
              {t('workspaces.changedFiles', { count: workspace.changedFiles })}
            </span>
          )
        )}
      </button>

      <button
        type="button"
        onClick={() => {
          onEditingChange(true)
        }}
        title={t('workspaces.rename')}
        className="text-ink-faint hover:text-ink focus-ring shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <Pencil aria-hidden size={12} />
      </button>

      <button
        type="button"
        onClick={onRemove}
        title={t('workspaces.remove')}
        className="text-ink-faint hover:text-danger focus-ring shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <X aria-hidden size={12} />
      </button>
    </div>
  )
}

/**
 * State at a glance.
 *
 * A filled dot means there is uncommitted work; hollow means clean. Once the
 * agent lands this is where its status goes.
 */
function StatusMark({ workspace }: { workspace: WorkspaceView }): React.JSX.Element {
  if (workspace.missing) {
    return <AlertTriangle aria-hidden size={11} className="text-warning shrink-0" />
  }

  return (
    <span
      aria-hidden
      className={`size-1.5 shrink-0 rounded-full ${
        workspace.changedFiles > 0 ? 'bg-accent' : 'border-ink-faint border'
      }`}
    />
  )
}
