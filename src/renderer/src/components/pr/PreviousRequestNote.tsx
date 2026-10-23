import { ExternalLink, GitMerge } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { shortBranchName } from '@core/branches.js'
import type { PreviousRequest } from '@core/pullRequests.js'

import { Button } from '../Button.js'
import { Callout } from './Callout.js'

/**
 * The request a branch has moved past, above the form offered again.
 *
 * Without it a branch that had a request read as one that never did, and the
 * merge looked forgotten. Where the base has to come in first — after a squash
 * or a rebase merge — it also says what a new request would carry, and offers
 * the fix before the form is filled in rather than after the request is opened.
 */
export function PreviousRequestNote({
  previous,
  base,
  dirty,
  updating,
  onUpdate
}: {
  readonly previous: PreviousRequest
  readonly base: string
  /** git refuses to merge into a dirty tree, so the press waits for a clean one. */
  readonly dirty: boolean
  readonly updating: boolean
  readonly onUpdate: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { number } = previous
  const named = shortBranchName(base)
  const said =
    previous.state === 'merged' ? 'pullRequest.previousMerged' : 'pullRequest.previousClosed'

  return (
    <div className="flex flex-col gap-2 px-3 pb-3">
      <Callout tone="info">
        {t(said, { number })}{' '}
        <a
          href={previous.url}
          target="_blank"
          rel="noreferrer"
          title={t('pullRequest.openPrevious', { number })}
          aria-label={t('pullRequest.openPrevious', { number })}
          className="focus-ring text-ink-faint hover:text-ink inline-flex rounded-[var(--radius-control)] align-middle"
        >
          <ExternalLink aria-hidden size={12} />
        </a>
      </Callout>

      {previous.needsBase && (
        <Callout tone="warning">
          <span className="flex flex-col items-start gap-2">
            {t('pullRequest.needsBaseWarning', { number, base: named })}
            {dirty && (
              <span className="text-ink-soft">
                {t('pullRequest.updateNeedsClean', { base: named })}
              </span>
            )}
            <Button size="sm" disabled={dirty || updating} onClick={onUpdate}>
              <GitMerge aria-hidden size={12} />
              {t(updating ? 'pullRequest.updatingFromBase' : 'pullRequest.updateFromBase', {
                base: named
              })}
            </Button>
          </span>
        </Callout>
      )}
    </div>
  )
}
