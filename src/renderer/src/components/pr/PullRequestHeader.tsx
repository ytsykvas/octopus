import {
  ArrowRight,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  RotateCw
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { shortBranchName } from '@core/branches.js'
import type { PullRequest } from '@core/pullRequests.js'
import type { PullRequestDetail } from '@core/pullRequestShapes.js'

import { IconButton } from '../paneControls.js'

type Pill = 'open' | 'draft' | 'merged' | 'closed' | 'none'

/**
 * The word, the glyph and the colour of each state.
 *
 * The colours are the sidebar's (`RequestMark.tsx`), so the row beside the pane
 * and the pane itself say the same thing about one request; only the paired
 * `*-bg` is a ground, never the status colour itself.
 */
const PILLS: Record<
  Pill,
  {
    readonly Icon: typeof GitPullRequest
    readonly tone: string
    readonly labelKey:
      | 'pullRequest.pillOpen'
      | 'pullRequest.isDraft'
      | 'pullRequest.pillMerged'
      | 'pullRequest.pillClosed'
      | 'pullRequest.pillNotOpened'
  }
> = {
  open: {
    Icon: GitPullRequest,
    tone: 'bg-success-bg text-success',
    labelKey: 'pullRequest.pillOpen'
  },
  draft: {
    Icon: GitPullRequestDraft,
    tone: 'bg-muted text-ink-soft',
    labelKey: 'pullRequest.isDraft'
  },
  merged: { Icon: GitMerge, tone: 'bg-danger-bg text-danger', labelKey: 'pullRequest.pillMerged' },
  closed: {
    Icon: GitPullRequestClosed,
    tone: 'bg-muted text-ink-soft',
    labelKey: 'pullRequest.pillClosed'
  },
  none: {
    Icon: GitPullRequest,
    tone: 'bg-muted text-ink-soft',
    labelKey: 'pullRequest.pillNotOpened'
  }
}

function pillOf(request: PullRequest | null, detail: PullRequestDetail | null): Pill {
  if (request === null) return 'none'
  // The detail's copy wins where there is one: it is the fresher read, and it
  // is what notices a request somebody else merged or retitled.
  const state = detail?.state ?? request.state
  if (state === 'open' && detail?.draft === true) return 'draft'
  return state
}

/**
 * What the branch is and where its request stands, above everything else.
 *
 * Drawn for a branch with no request as well, so the pane keeps one shape from
 * the form to the merge: the pill says "not opened" and the title is the one
 * the request does not have yet.
 */
export function PullRequestHeader({
  request,
  detail,
  readAt,
  onRefresh,
  branch,
  base
}: {
  /** Null while the branch has no request. */
  readonly request: PullRequest | null
  /** May be absent — still being read, or refused — and the rest still draws. */
  readonly detail: PullRequestDetail | null
  /** When the detail was last read; the one thing that dates a stale answer. */
  readonly readAt: string | null
  readonly onRefresh: () => void
  readonly branch: string
  readonly base: string
}): React.JSX.Element {
  const { t, i18n } = useTranslation()

  const pill = PILLS[pillOf(request, detail)]

  return (
    <div className="flex flex-col gap-1 px-3 pt-3 pb-2.5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full pr-2 pl-1.5 text-[11px] font-semibold ${pill.tone}`}
        >
          <pill.Icon aria-hidden size={12} />
          {t(pill.labelKey)}
        </span>

        {/* The number: it is what identifies the request to anyone who goes
            looking for it, here or on GitHub. */}
        {request !== null && (
          <span className="text-ink-faint font-mono text-[11px]">#{request.number}</span>
        )}

        <span className="flex-1" />

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

        {request !== null && (
          <>
            <IconButton label={t('pullRequest.refresh')} onClick={onRefresh}>
              <RotateCw aria-hidden size={12} />
            </IconButton>

            <a
              href={request.url}
              target="_blank"
              rel="noreferrer"
              title={t('pullRequest.open')}
              aria-label={t('pullRequest.open')}
              className="focus-ring text-ink-faint hover:text-ink hover:bg-muted rounded-[var(--radius-control)] p-1"
            >
              <ExternalLink aria-hidden size={12} />
            </a>
          </>
        )}
      </div>

      <p className="text-ink line-clamp-2 text-[14px] leading-snug font-semibold">
        {request === null ? t('pullRequest.newPullRequest') : (detail?.title ?? request.title)}
      </p>

      <p className="text-ink-faint flex min-w-0 items-center gap-1.5 font-mono text-[11px]">
        <GitBranch aria-hidden size={11} className="shrink-0" />
        <span className="truncate" title={branch}>
          {shortBranchName(branch)}
        </span>
        <ArrowRight aria-hidden size={10} className="shrink-0" />
        <span className="shrink-0">{base}</span>
      </p>
    </div>
  )
}
