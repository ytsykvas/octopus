import { Check, CircleDashed, ExternalLink, Minus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { CheckState, PullRequestCheck } from '@core/pullRequestShapes.js'

import { duration } from './time.js'

/**
 * The mark and the word for each state.
 *
 * Both, always. A colour and a glyph reach nobody using a screen reader, and
 * the row is also the only handle a test has on which state a check is in —
 * the lesson the right pane's tabs already carry.
 */
const STATES: Record<
  CheckState,
  {
    readonly icon: React.ReactNode
    readonly tone: string
    readonly labelKey:
      | 'pullRequest.checkPending'
      | 'pullRequest.checkPassed'
      | 'pullRequest.checkFailed'
      | 'pullRequest.checkSkipped'
  }
> = {
  pending: {
    // Spinning, because this is the one state that is going to change on its
    // own — and the pane re-reads on a timer, so a still mark would look stuck.
    icon: <CircleDashed aria-hidden size={12} className="animate-spin" />,
    tone: 'text-accent',
    labelKey: 'pullRequest.checkPending'
  },
  passed: {
    icon: <Check aria-hidden size={12} />,
    tone: 'text-success',
    labelKey: 'pullRequest.checkPassed'
  },
  failed: {
    icon: <X aria-hidden size={12} />,
    tone: 'text-danger',
    labelKey: 'pullRequest.checkFailed'
  },
  skipped: {
    icon: <Minus aria-hidden size={12} />,
    tone: 'text-ink-faint',
    labelKey: 'pullRequest.checkSkipped'
  }
}

/**
 * What CI has made of the branch, one row per check.
 *
 * Flat rather than grouped by workflow. A repository runs both GitHub Actions
 * jobs and whatever reports through the older status API, and the two have no
 * grouping in common — the workflow rides along in the row's title instead,
 * where it settles which of two jobs called `build` this one is.
 */
export function ChecksList({
  checks
}: {
  readonly checks: readonly PullRequestCheck[]
}): React.JSX.Element {
  const { t } = useTranslation()

  if (checks.length === 0) {
    return <p className="text-ink-faint leading-relaxed">{t('pullRequest.checksNone')}</p>
  }

  return (
    <ul className="space-y-0.5">
      {checks.map((check) => {
        const state = STATES[check.state]
        const took = duration(check.startedAt, check.completedAt)

        return (
          <li
            // The name is what GitHub identifies a check by within a request,
            // and two runs of one job replace rather than stack.
            key={`${check.workflow ?? ''}/${check.name}`}
            className="flex items-center gap-2"
          >
            <span className={`shrink-0 ${state.tone}`}>{state.icon}</span>

            <span className="min-w-0 flex-1 truncate" title={check.workflow ?? check.name}>
              {check.name}
            </span>

            {/* The word carries the state for anything not looking at colour;
                the duration is beside it because a check that took four minutes
                and one that took four seconds are different kinds of check. */}
            <span className="text-ink-faint shrink-0 font-mono text-[11px]">
              {took ?? t(state.labelKey)}
            </span>

            {check.url !== null && (
              <a
                href={check.url}
                target="_blank"
                rel="noreferrer"
                title={check.name}
                aria-label={`${check.name} — ${t(state.labelKey)}`}
                className="focus-ring text-ink-faint hover:text-accent shrink-0 rounded-[var(--radius-control)]"
              >
                <ExternalLink aria-hidden size={11} />
              </a>
            )}
          </li>
        )
      })}
    </ul>
  )
}
