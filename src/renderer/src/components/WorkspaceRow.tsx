import { AlertTriangle, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AGENT_NAMES } from '@core/chats.js'
import type { BranchRequest } from '@core/pullRequestShapes.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { AGENT_LABELS, AGENT_TONES, chatStatusLabel, chatStatusTone } from './agentStatus.js'
import { DropdownMenu } from './DropdownMenu.js'
import { RequestMark } from './RequestMark.js'
import { NameEditor } from './NameEditor.js'

interface WorkspaceRowProps {
  readonly workspace: WorkspaceView
  /** Its branch's pull request, or null where the branch has none. */
  readonly request: BranchRequest | null
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
  request,
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

        {/* After the name, before the count: the name is what the row is, this
            is what has become of it, and the count is how much is in flight. */}
        <RequestMark request={request} />

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
 * State at a glance.
 *
 * One mark, not two: the agent's state takes the dot while there is one to
 * report, and a filled dot for uncommitted work is what it falls back to —
 * `idle` with changes is the ordinary case, and two marks side by side would
 * make the list busier than the thing it describes.
 *
 * The exception is a workspace holding several conversations, which is the one
 * thing a single dot cannot say: two agents at work while a third waits for an
 * answer summarises to "waiting", and the row would be hiding the two that are
 * still going. Then it is one dot each, in tab order.
 */
function StatusMark({ workspace }: { workspace: WorkspaceView }): React.JSX.Element {
  const { t } = useTranslation()

  if (workspace.missing) {
    return <AlertTriangle aria-hidden size={11} className="text-warning shrink-0" />
  }

  if (workspace.chats.length > 1) {
    return (
      <span className="flex shrink-0 items-center gap-[3px]">
        {workspace.chats.map((chat, index) => {
          // Named exactly as the tab strip names it, its own name included: a
          // reader told "auth refactor is waiting" has somewhere to go.
          const described = t('chat.tabStatus', {
            name:
              chat.title ?? t('chat.tab', { agent: AGENT_NAMES[chat.agent], number: index + 1 }),
            state: t(chatStatusLabel(chat.status, chat.started))
          })

          return (
            <span
              key={chat.id}
              role="img"
              aria-label={described}
              title={described}
              className={`size-1.5 shrink-0 rounded-full ${chatStatusTone(chat.status, chat.started)}`}
            />
          )
        })}
      </span>
    )
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
