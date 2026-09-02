import { ExternalLink, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { PullRequest } from '@core/pullRequests.js'
import type {
  PullRequestDetail,
  PullRequestState,
  ReviewDecision
} from '@core/pullRequestShapes.js'

const STATE_LABELS: Record<
  PullRequestState,
  'pullRequest.stateOpen' | 'pullRequest.stateMerged' | 'pullRequest.stateClosed'
> = {
  open: 'pullRequest.stateOpen',
  merged: 'pullRequest.stateMerged',
  closed: 'pullRequest.stateClosed'
}

const DECISIONS: Record<
  ReviewDecision,
  {
    readonly labelKey:
      | 'pullRequest.decisionApproved'
      | 'pullRequest.decisionChangesRequested'
      | 'pullRequest.decisionReviewRequired'
    readonly tone: string
  }
> = {
  approved: { labelKey: 'pullRequest.decisionApproved', tone: 'text-success' },
  changesRequested: { labelKey: 'pullRequest.decisionChangesRequested', tone: 'text-warning' },
  reviewRequired: { labelKey: 'pullRequest.decisionReviewRequired', tone: 'text-ink-faint' }
}

/**
 * What the request is and where it stands, above everything else in the pane.
 *
 * Takes the summary and the detail separately because the detail may be absent
 * — still being read, or refused — and the number, the title and the link are
 * worth drawing regardless. That is the whole reason the two are read through
 * different channels.
 */
export function PullRequestSummary({
  request,
  detail,
  readAt,
  onRefresh
}: {
  readonly request: PullRequest
  readonly detail: PullRequestDetail | null
  /** When the detail was last read; the one thing that dates a stale answer. */
  readonly readAt: string | null
  readonly onRefresh: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()

  // The detail's copy wins where there is one: it is the fresher read, and it
  // is what notices a request somebody else merged or retitled.
  const state = detail?.state ?? request.state
  const title = detail?.title ?? request.title
  const decision = detail?.decision ?? null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        {/* The number rather than the word "open": it is what identifies the
            request to anyone who goes looking for it, here or on GitHub. */}
        <p className="text-ink min-w-0 flex-1 leading-relaxed">
          {t(STATE_LABELS[state], { number: request.number })}
        </p>

        {/* Beside the control that reads again, because that is the question
            it answers. A push from the terminal raises nothing the pane can
            hear, so without a time a stale answer reads as a fresh one. The
            clock time rather than "3 minutes ago": no arithmetic, and nothing
            has to re-render for it to stay true. */}
        {readAt !== null && (
          <span className="text-ink-faint shrink-0 text-[11px]">
            {t('pullRequest.readAt', {
              time: new Date(readAt).toLocaleTimeString(i18n.language, {
                hour: '2-digit',
                minute: '2-digit'
              })
            })}
          </span>
        )}

        <button
          type="button"
          onClick={onRefresh}
          title={t('pullRequest.refresh')}
          aria-label={t('pullRequest.refresh')}
          className="focus-ring text-ink-faint hover:text-ink shrink-0 rounded-[var(--radius-control)] transition-colors"
        >
          <RotateCw aria-hidden size={12} />
        </button>
      </div>

      <div className="flex items-baseline gap-2">
        <p className="text-ink-soft min-w-0 flex-1 leading-relaxed">{title}</p>

        {detail?.draft === true && (
          <span className="text-ink-faint shrink-0">{t('pullRequest.isDraft')}</span>
        )}

        {decision !== null && (
          <span className={`shrink-0 ${DECISIONS[decision].tone}`}>
            {t(DECISIONS[decision].labelKey)}
          </span>
        )}
      </div>

      <a
        href={request.url}
        target="_blank"
        rel="noreferrer"
        className="focus-ring text-accent inline-flex items-center gap-1 self-start rounded-[var(--radius-control)]"
      >
        <ExternalLink aria-hidden size={12} />
        {t('pullRequest.open')}
      </a>
    </div>
  )
}
