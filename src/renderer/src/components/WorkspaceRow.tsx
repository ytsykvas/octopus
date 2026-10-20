import {
  AlertTriangle,
  CircleAlert,
  CircleCheck,
  CodeXml,
  GitBranchPlus,
  LoaderCircle,
  type LucideIcon,
  MessageCircleQuestion,
  MoreHorizontal,
  Pencil,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AGENT_NAMES } from '@core/chats.js'
import type { BranchRequest } from '@core/pullRequestShapes.js'
import type { WorkspaceView } from '@core/workspaces.js'

import {
  AGENT_LABELS,
  chatStatusLabel,
  chatStatusTone,
  WORKSPACE_MOODS,
  workspaceMood,
  type WorkspaceMood
} from './agentStatus.js'
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

  const mood = WORKSPACE_MOODS[workspaceMood(workspace)]

  return (
    <div
      className={`workspace-card group flex items-center gap-1 p-1.5 ${selected ? 'workspace-card-selected' : ''}`}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={() => {
          onEditingChange(true)
        }}
        className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-control)] text-left"
        title={workspace.missing ? t('workspaces.missingHint') : workspace.branch}
        // Selection is a surface and a coloured edge, neither of which a screen
        // reader can see — and the project tab and the settings rail already
        // announce it this way.
        aria-current={selected ? 'true' : undefined}
      >
        <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
          <StatusMark workspace={workspace} />
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={`truncate font-medium ${workspace.missing ? 'text-ink-faint line-through' : ''}`}
          >
            {workspace.name}
          </span>

          {/* What has become of it, then how much is in flight — the word keeps its
              width and the count is what gives way in a narrow pane. A workspace whose
              directory is gone says that instead of both: its state and its
              count describe a tree that is not there. */}
          <span className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px]">
            {workspace.missing ? (
              <span className="text-warning truncate">{t('workspaces.missing')}</span>
            ) : (
              <>
                <span className={`shrink-0 ${mood.text}`}>{t(mood.line)}</span>
                {workspace.changedFiles > 0 && (
                  <>
                    <span aria-hidden className="text-ink-faint">
                      •
                    </span>
                    <span className="text-ink-faint truncate">
                      {t('workspaces.changedFiles', { count: workspace.changedFiles })}
                    </span>
                  </>
                )}
              </>
            )}

            <RequestMark request={request} />

            {/* The worktree is standing on some other branch, so the name on this
                row is not where the work is going. Suppressed for a workspace
                whose directory is gone, which already says so louder and would
                otherwise be two answers to one question. */}
            {!workspace.headOnBranch && !workspace.missing && (
              <span
                role="img"
                aria-label={t('workspaces.headElsewhere', { branch: workspace.branch })}
                title={t('workspaces.headElsewhere', { branch: workspace.branch })}
                className="text-warning shrink-0"
              >
                <GitBranchPlus aria-hidden size={11} />
              </span>
            )}
          </span>
        </span>
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

const MOOD_ICONS: Record<WorkspaceMood, LucideIcon> = {
  running: LoaderCircle,
  waiting: MessageCircleQuestion,
  error: CircleAlert,
  done: CircleCheck,
  idle: CodeXml
}

/**
 * State at a glance, in a tile at the card's left edge.
 *
 * One mark, not two: the agent's state takes the tile while there is one to
 * report, and the code glyph is what it falls back to. The tile's own colour is
 * the same on every row, so the glyph and its tone are all that differ.
 *
 * The exception is a workspace holding several conversations, which is the one
 * thing a single glyph cannot say: two agents at work while a third waits for an
 * answer summarises to "waiting", and the row would be hiding the two that are
 * still going. Then it is one dot each, in tab order, inside the tile.
 */
function StatusMark({ workspace }: { workspace: WorkspaceView }): React.JSX.Element {
  const { t } = useTranslation()

  if (workspace.missing) {
    return <AlertTriangle aria-hidden size={15} className="text-warning" />
  }

  if (workspace.chats.length > 1) {
    return (
      <span className="flex items-center gap-[3px]">
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

  const kind = workspaceMood(workspace)
  const Icon = MOOD_ICONS[kind]
  const className = `${WORKSPACE_MOODS[kind].text} ${kind === 'running' ? 'animate-spin' : ''}`
  const label = AGENT_LABELS[workspace.status]

  if (label) {
    // Named rather than hidden: this is the one thing on the row a reader may
    // have come looking for, and a colour says nothing to a screen reader.
    return (
      <span role="img" aria-label={t(label)} title={t(label)} className={className}>
        <Icon aria-hidden size={15} />
      </span>
    )
  }

  // Finished and not started are named by the line beneath the title.
  return <Icon aria-hidden size={15} className={className} />
}
