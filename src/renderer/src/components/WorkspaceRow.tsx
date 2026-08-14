import { AlertTriangle, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { WorkspaceView } from '@core/workspaces.js'

import { DropdownMenu } from './DropdownMenu.js'
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
        // Selection is a surface and a 2px mark, neither of which a screen
        // reader can see — and the project tab and the settings rail already
        // announce it this way.
        aria-current={selected ? 'true' : undefined}
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

      {/* Same menu as projects — neighbouring rows behaving differently would
          be its own kind of confusing. */}
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
            <MoreHorizontal aria-hidden size={12} />
          </button>
        )}
        actions={[
          {
            id: 'rename',
            label: t('workspaces.rename'),
            icon: <Pencil aria-hidden size={12} />,
            onSelect: () => {
              onEditingChange(true)
            }
          },
          {
            id: 'remove',
            label: t('workspaces.remove'),
            icon: <Trash2 aria-hidden size={12} />,
            destructive: true,
            onSelect: onRemove
          }
        ]}
      />
    </div>
  )
}

/**
 * What the agent is doing there, when it is doing anything.
 *
 * The whole point of a list of workspaces is that several are working at once,
 * and until this read `status` the only way to find out was to open each one.
 * The colour is the difference that matters: `warning` means the turn has
 * stopped and is waiting on you, which is the one state worth crossing the
 * window for.
 */
const AGENT_TONES: Partial<Record<WorkspaceView['status'], string>> = {
  running: 'bg-accent animate-pulse',
  waiting_permission: 'bg-warning',
  error: 'bg-danger'
}

/*
 * Written out rather than built from the status: `t` is typed against the
 * locale, and a key assembled at runtime is a string it cannot check — which is
 * the whole point of typing the locales against each other.
 */
const AGENT_LABELS: Partial<
  Record<
    WorkspaceView['status'],
    'workspaces.statusRunning' | 'workspaces.statusWaiting' | 'workspaces.statusError'
  >
> = {
  running: 'workspaces.statusRunning',
  waiting_permission: 'workspaces.statusWaiting',
  error: 'workspaces.statusError'
}

/**
 * State at a glance.
 *
 * One mark, not two: the agent's state takes the dot while there is one to
 * report, and a filled dot for uncommitted work is what it falls back to —
 * `idle` with changes is the ordinary case, and two marks side by side would
 * make the list busier than the thing it describes.
 */
function StatusMark({ workspace }: { workspace: WorkspaceView }): React.JSX.Element {
  const { t } = useTranslation()

  if (workspace.missing) {
    return <AlertTriangle aria-hidden size={11} className="text-warning shrink-0" />
  }

  const tone = AGENT_TONES[workspace.status]
  const label = AGENT_LABELS[workspace.status]

  if (tone && label) {
    // Named rather than hidden: this is the one thing on the row a reader may
    // have come looking for, and a colour says nothing to a screen reader.
    return (
      <span
        role="img"
        aria-label={t(label)}
        title={t(label)}
        className={`size-1.5 shrink-0 rounded-full ${tone}`}
      />
    )
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
