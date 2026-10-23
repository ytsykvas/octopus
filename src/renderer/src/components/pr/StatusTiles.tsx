import {
  AlertTriangle,
  Check,
  Circle,
  GitMerge,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
  Minus,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { PullRequestDetail } from '@core/pullRequestShapes.js'

import type { RequestStatus, RequestView } from './requestStatus.js'

/** A tile's face: the mark beside the value, and the value itself. */
interface Face {
  readonly mark: React.ReactNode
  readonly value: string
}

/**
 * Where the request stands, in three tiles that also choose the view below.
 *
 * One control for both because they answer the same question at two depths:
 * the tile says "1 failed", the view under it says which one. Buttons with
 * `aria-pressed` rather than tabs, the way `Segmented` draws a choice — a tab
 * list promises arrow keys and a panel it controls, and three buttons in a row
 * need neither.
 */
export function StatusTiles({
  detail,
  status,
  view,
  onView
}: {
  readonly detail: PullRequestDetail
  readonly status: RequestStatus
  readonly view: RequestView
  readonly onView: (view: RequestView) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  const failed = status.failedChecks.length

  const checks: Face =
    failed > 0
      ? {
          mark: <X aria-hidden size={12} className="text-danger" />,
          value: t('pullRequest.tileChecksFailed', { count: failed })
        }
      : status.running > 0
        ? {
            mark: <span aria-hidden className="agent-arc" />,
            value: t('pullRequest.tileChecksRunning', { count: status.running })
          }
        : status.passed > 0
          ? {
              mark: <Check aria-hidden size={12} className="text-success" />,
              value: t('pullRequest.tileChecksPassed')
            }
          : {
              mark: <Minus aria-hidden size={12} className="text-ink-faint" />,
              value: t(
                detail.checks.length === 0
                  ? 'pullRequest.tileChecksNone'
                  : 'pullRequest.tileChecksSkipped'
              )
            }

  const review: Face =
    detail.decision === 'changesRequested'
      ? {
          mark: <MessageSquare aria-hidden size={11} className="text-warning" />,
          value: t('pullRequest.tileReviewChanges')
        }
      : detail.decision === 'approved'
        ? {
            mark: <Check aria-hidden size={12} className="text-success" />,
            value: t('pullRequest.decisionApproved')
          }
        : detail.decision === 'reviewRequired'
          ? {
              mark: <Circle aria-hidden size={11} className="text-ink-faint" />,
              value: t('pullRequest.tileReviewRequired')
            }
          : /* Everything said, resolved threads and plain comments included:
               the count of what the Review view lists, not of what is still
               asking for an answer — that is `offered`'s question. */
            {
              mark: <MessageSquare aria-hidden size={11} className="text-ink-faint" />,
              value: t('pullRequest.tileReviewComments', { count: detail.comments.length })
            }

  const merge = mergeFace(detail, status)

  return (
    <div
      role="group"
      aria-label={t('pullRequest.views')}
      className="grid grid-cols-3 gap-1.5 px-3 pb-2.5"
    >
      <Tile
        face={checks}
        label={t('pullRequest.checks')}
        pressed={view === 'checks'}
        onClick={() => {
          onView('checks')
        }}
      />
      <Tile
        face={review}
        label={t('pullRequest.review')}
        pressed={view === 'review'}
        onClick={() => {
          onView('review')
        }}
      />
      <Tile
        face={{ mark: merge.mark, value: t(merge.labelKey) }}
        label={t('pullRequest.merge')}
        pressed={view === 'merge'}
        onClick={() => {
          onView('merge')
        }}
      />
    </div>
  )
}

/**
 * Whether merging would go through, which is not the same as what wants doing.
 *
 * Uncommitted and unpushed work is the footer's to say: it stands beside a
 * merge rather than in its way, so a tile reading "Ready" over it is true.
 */
function mergeFace(
  detail: PullRequestDetail,
  status: RequestStatus
): {
  readonly mark: React.ReactNode
  readonly labelKey:
    | 'pullRequest.pillMerged'
    | 'pullRequest.pillClosed'
    | 'pullRequest.tileMergeConflict'
    | 'pullRequest.isDraft'
    | 'pullRequest.tileMergeReady'
    | 'pullRequest.tileMergeWaiting'
} {
  if (status.state === 'merged') {
    return {
      mark: <GitMerge aria-hidden size={12} className="text-danger" />,
      labelKey: 'pullRequest.pillMerged'
    }
  }
  if (status.state === 'closed') {
    return {
      mark: <GitPullRequestClosed aria-hidden size={12} className="text-ink-faint" />,
      labelKey: 'pullRequest.pillClosed'
    }
  }
  if (status.conflicting) {
    return {
      mark: <AlertTriangle aria-hidden size={12} className="text-warning" />,
      labelKey: 'pullRequest.tileMergeConflict'
    }
  }
  if (detail.draft) {
    return {
      mark: <GitPullRequestDraft aria-hidden size={12} className="text-ink-faint" />,
      labelKey: 'pullRequest.isDraft'
    }
  }
  return status.canMerge
    ? {
        mark: <Check aria-hidden size={12} className="text-success" />,
        labelKey: 'pullRequest.tileMergeReady'
      }
    : {
        mark: <Circle aria-hidden size={11} className="text-ink-faint" />,
        labelKey: 'pullRequest.tileMergeWaiting'
      }
}

function Tile({
  face,
  label,
  pressed,
  onClick
}: {
  readonly face: Face
  readonly label: string
  readonly pressed: boolean
  readonly onClick: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const name = t('pullRequest.tileName', { view: label, value: face.value })

  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      /* Named the way it reads — the view, then where it stands — rather than
         the two spans run together. The value is cut short in a narrow pane;
         the title holds the whole of it. */
      aria-label={name}
      title={name}
      className={`workspace-card focus-ring flex min-w-0 flex-col items-start px-2.5 py-1.5 text-left ${
        pressed ? 'workspace-card-selected' : ''
      }`}
    >
      <span className="text-ink flex w-full min-w-0 items-center gap-1.5 text-[12px] font-semibold">
        <span className="flex size-3 shrink-0 items-center justify-center">{face.mark}</span>
        <span className="truncate">{face.value}</span>
      </span>
      <span className="text-ink-faint text-[11px]">{label}</span>
    </button>
  )
}
