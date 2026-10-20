import type { TFunction } from 'i18next'
import { ChevronDown, ChevronUp, CircleCheck, CircleX, GitPullRequest } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { BranchRequest, StandingReason } from '@core/pullRequestShapes.js'
import type { ResourceReading } from '@core/resources.js'
import type { Project } from '@core/store.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { useNow } from '../../hooks/useNow.js'
import { chatName } from '../chat/chatName.js'
import { formatDuration } from '../chat/format.js'
import { fileSize } from '../fileSize.js'
import {
  type AgentItem,
  agentsIn,
  openRequests,
  type RequestItem,
  usageByWorkspace
} from './overview.js'
import { type StatusRow, StatusSegment } from './StatusSegment.js'

/** Where a row of the bar leads: a workspace, and what to bring forward in it. */
export interface StatusTarget {
  readonly projectId: string
  readonly workspaceId: string
  /** The conversation to put in front, when the row is about one. */
  readonly chatId?: string | null
  /** Open the pull request tab, when the row is about a request. */
  readonly pullRequest?: boolean
}

interface StatusBarProps {
  readonly open: boolean
  readonly onToggle: (open: boolean) => void
  readonly projects: readonly Project[]
  /** Every project's workspaces, not the open project's alone. */
  readonly workspaces: readonly WorkspaceView[]
  /** Each project's requests by branch, as far as each has answered. */
  readonly requests: ReadonlyMap<string, ReadonlyMap<string, BranchRequest>>
  readonly resources: ResourceReading | null
  /** The selected workspace, and the conversation in front of it. */
  readonly front: { readonly workspace: WorkspaceView; readonly chatId: string } | null
  readonly onOpen: (target: StatusTarget) => void
}

const CHEVRON =
  'text-ink-faint hover:bg-muted hover:text-ink focus-ring flex shrink-0 items-center justify-center rounded-[var(--radius-control)] transition-colors'

/**
 * The strip along the foot of the window: how everything is doing, without
 * opening each project to find out.
 *
 * Across every project, which is the point of it — the workspace list says
 * this for the open project already. On the left what wants attention (agents,
 * then requests), on the right what is happening here (the turn under way,
 * what the machine is paying). Folded away, it leaves only the chevron that
 * brings it back.
 */
export function StatusBar({
  open,
  onToggle,
  projects,
  workspaces,
  requests,
  resources,
  front,
  onOpen
}: StatusBarProps): React.JSX.Element {
  const { t } = useTranslation()

  if (!open) {
    return (
      <button
        type="button"
        aria-label={t('statusBar.show')}
        title={t('statusBar.show')}
        onClick={() => {
          onToggle(true)
        }}
        className={`${CHEVRON} bg-surface border-line fixed right-1 bottom-1 z-40 size-5 border`}
      >
        <ChevronUp aria-hidden size={12} />
      </button>
    )
  }

  const projectOf = (workspace: WorkspaceView): Project | undefined =>
    projects.find((project) => project.id === workspace.projectId)
  const where = (workspace: WorkspaceView): string =>
    [projectOf(workspace)?.name, workspace.name].filter(Boolean).join(' · ')
  const colorOf = (workspace: WorkspaceView): string | null => projectOf(workspace)?.color ?? null

  const agentRows = (items: readonly AgentItem[]): StatusRow[] =>
    items.map(({ workspace, chatId }) => ({
      key: workspace.id,
      color: colorOf(workspace),
      label: where(workspace),
      detail: workspace.branch,
      onOpen: () => {
        onOpen({ projectId: workspace.projectId, workspaceId: workspace.id, chatId })
      }
    }))

  const requestRows = (items: readonly RequestItem[]): StatusRow[] =>
    items.map(({ workspace, request, standing }) => ({
      key: workspace.id,
      color: colorOf(workspace),
      label: where(workspace),
      detail: [
        t('statusBar.request', { number: request.number }),
        standing.kind === 'needsAction'
          ? standing.reasons.map((reason) => reasonText(t, reason)).join(', ')
          : standing.kind === 'pending'
            ? t('statusBar.pending')
            : null
      ]
        .filter(Boolean)
        .join(' · '),
      onOpen: () => {
        onOpen({ projectId: workspace.projectId, workspaceId: workspace.id, pullRequest: true })
      }
    }))

  const working = agentsIn(workspaces, 'running')
  const waiting = agentsIn(workspaces, 'waiting_permission')
  const requestsOpen = openRequests(workspaces, requests)
  const needsAction = requestsOpen.filter((item) => item.standing.kind === 'needsAction')
  const ready = requestsOpen.filter((item) => item.standing.kind === 'ready')

  return (
    <footer
      aria-label={t('statusBar.label')}
      className="border-line bg-surface flex h-[22px] shrink-0 items-stretch gap-0.5 border-t px-1 py-px text-[12px]"
    >
      <StatusSegment
        label={t('statusBar.working', { count: working.length })}
        mark={<Dot className={working.length > 0 ? 'bg-accent' : 'border-ink-faint border'} />}
        quiet={working.length === 0}
        title={t('statusBar.workingTitle')}
        rows={agentRows(working)}
        empty={t('statusBar.nobodyWorking')}
      />
      <StatusSegment
        label={t('statusBar.waiting', { count: waiting.length })}
        mark={<Dot className={waiting.length > 0 ? 'bg-warning' : 'border-ink-faint border'} />}
        quiet={waiting.length === 0}
        title={t('statusBar.waitingTitle')}
        rows={agentRows(waiting)}
        empty={t('statusBar.nobodyWaiting')}
      />

      <Separator />

      <StatusSegment
        label={t('statusBar.requests', { count: requestsOpen.length })}
        mark={<GitPullRequest aria-hidden size={12} />}
        quiet={requestsOpen.length === 0}
        title={t('statusBar.requestsTitle')}
        rows={requestRows(requestsOpen)}
        empty={t('statusBar.noRequests')}
      />
      <StatusSegment
        label={t('statusBar.needsAction', { count: needsAction.length })}
        mark={
          <CircleX
            aria-hidden
            size={12}
            className={needsAction.length > 0 ? 'text-danger' : undefined}
          />
        }
        quiet={needsAction.length === 0}
        title={t('statusBar.needsActionTitle')}
        rows={requestRows(needsAction)}
        empty={t('statusBar.noneNeedsAction')}
      />
      <StatusSegment
        label={t('statusBar.ready', { count: ready.length })}
        mark={
          <CircleCheck
            aria-hidden
            size={12}
            className={ready.length > 0 ? 'text-success' : undefined}
          />
        }
        quiet={ready.length === 0}
        title={t('statusBar.readyTitle')}
        rows={requestRows(ready)}
        empty={t('statusBar.noneReady')}
      />

      <span className="flex-1" />

      {front && <TurnTimer workspace={front.workspace} chatId={front.chatId} />}

      <StatusSegment
        label={
          resources === null
            ? t('statusBar.resourcesReading')
            : t('statusBar.resources', {
                cpu: percent(resources.total.cpu),
                memory: fileSize(resources.total.memory)
              })
        }
        title={t('statusBar.resourcesTitle')}
        rows={
          resources === null ? [] : resourceRows(t, resources, workspaces, where, colorOf, onOpen)
        }
        empty={t('statusBar.resourcesReading')}
      />

      <button
        type="button"
        aria-label={t('statusBar.hide')}
        title={t('statusBar.hide')}
        onClick={() => {
          onToggle(false)
        }}
        className={`${CHEVRON} w-5`}
      >
        <ChevronDown aria-hidden size={12} />
      </button>
    </footer>
  )
}

/**
 * How long the conversation in front has been at its turn.
 *
 * Its own component because it holds the second-by-second clock, and the tick
 * should redraw this line and not the rest of the bar. Nothing while the
 * conversation is between turns.
 */
function TurnTimer({
  workspace,
  chatId
}: {
  readonly workspace: WorkspaceView
  readonly chatId: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const now = useNow()

  const index = workspace.chats.findIndex((chat) => chat.id === chatId)
  const chat = workspace.chats[index]
  if (chat?.turnStartedAt == null || chat.status === 'idle' || chat.status === 'error') return null

  return (
    <span role="timer" className="text-ink-soft flex shrink-0 items-center px-2 tabular-nums">
      {t('statusBar.turn', {
        chat: chatName(t, chat, index + 1),
        elapsed: formatDuration(now - Date.parse(chat.turnStartedAt), {
          minutes: t('usage.minutes'),
          seconds: t('usage.seconds')
        })
      })}
    </span>
  )
}

function resourceRows(
  t: TFunction,
  reading: ResourceReading,
  workspaces: readonly WorkspaceView[],
  where: (workspace: WorkspaceView) => string,
  colorOf: (workspace: WorkspaceView) => string | null,
  onOpen: (target: StatusTarget) => void
): StatusRow[] {
  const rows = usageByWorkspace(reading).flatMap((usage): StatusRow[] => {
    const workspace = workspaces.find((candidate) => candidate.id === usage.workspaceId)
    if (workspace === undefined) return []
    return [
      {
        key: workspace.id,
        color: colorOf(workspace),
        label: where(workspace),
        detail: [
          t('statusBar.resources', { cpu: percent(usage.cpu), memory: fileSize(usage.memory) }),
          usage.kinds
            .map(({ kind, memory }) =>
              t('statusBar.part', { kind: t(`statusBar.${kind}`), memory: fileSize(memory) })
            )
            .join(', ')
        ].join(' · '),
        onOpen: () => {
          onOpen({ projectId: workspace.projectId, workspaceId: workspace.id })
        }
      }
    ]
  })

  return [
    ...rows,
    {
      key: 'app',
      color: null,
      label: t('statusBar.app'),
      detail: t('statusBar.resources', {
        cpu: percent(reading.app.cpu),
        memory: fileSize(reading.app.memory)
      })
    }
  ]
}

function reasonText(t: TFunction, reason: StandingReason): string {
  switch (reason) {
    case 'checksFailed':
      return t('statusBar.checksFailed')
    case 'changesRequested':
      return t('statusBar.changesRequested')
    case 'conflict':
      return t('statusBar.conflict')
  }
}

/** Percent of one core, as `ps` counts it — so a busy tree reads past 100. */
function percent(cpu: number): string {
  return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 }).format(
    cpu / 100
  )
}

function Dot({ className }: { readonly className: string }): React.JSX.Element {
  return <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${className}`} />
}

function Separator(): React.JSX.Element {
  return <span aria-hidden className="bg-line mx-1 my-1 w-px shrink-0" />
}
