import { GitBranch, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { BranchRequest } from '@core/pullRequestShapes.js'

/**
 * What the mark says, and in what colour.
 *
 * An open request is read through its checks, because that is the question
 * being asked of a list of branches: which of these is ready. A merged one is
 * done and a closed one is abandoned, and neither has checks worth looking at.
 */
type Reading = 'running' | 'passed' | 'failed' | 'waiting' | 'merged' | 'closed'

const LABELS: Record<
  Reading,
  | 'workspaces.requestRunning'
  | 'workspaces.requestPassed'
  | 'workspaces.requestFailed'
  | 'workspaces.requestWaiting'
  | 'workspaces.requestMerged'
  | 'workspaces.requestClosed'
> = {
  running: 'workspaces.requestRunning',
  passed: 'workspaces.requestPassed',
  failed: 'workspaces.requestFailed',
  waiting: 'workspaces.requestWaiting',
  merged: 'workspaces.requestMerged',
  closed: 'workspaces.requestClosed'
}

const TONES: Record<Reading, string> = {
  running: 'text-success',
  passed: 'text-success',
  failed: 'text-warning',
  // Accent rather than a status colour: nothing has gone right or wrong yet.
  waiting: 'text-accent',
  merged: 'text-danger',
  // Neither a result nor a state to act on — a branch somebody walked away from.
  closed: 'text-ink-faint'
}

function readingOf(request: BranchRequest): Reading {
  if (request.state === 'merged') return 'merged'
  if (request.state === 'closed') return 'closed'

  if (request.checks === 'failed') return 'failed'
  if (request.checks === 'running') return 'running'
  // No checks at all is not a pass. A repository that runs nothing has said
  // nothing about the branch, and green would be this app's opinion rather
  // than an answer.
  return request.checks === 'none' ? 'waiting' : 'passed'
}

/**
 * Where a workspace's branch has got to, in one glyph beside its name.
 *
 * Nothing at all where there is no request, which is most branches most of the
 * time — a mark for "no request yet" would put an icon on every row and say
 * nothing by being there.
 *
 * The state goes out as a **word** in the title and the label as well as in the
 * colour. A colour reaches nobody using a screen reader, and it is also the
 * only handle a test has on which of six states a row is in.
 */
export function RequestMark({
  request
}: {
  readonly request: BranchRequest | null
}): React.JSX.Element | null {
  const { t } = useTranslation()

  if (request === null) return null

  const reading = readingOf(request)
  const label = t(LABELS[reading], { number: request.number })

  return (
    <span className={`shrink-0 ${TONES[reading]}`} title={label} aria-label={label} role="img">
      {reading === 'running' ? (
        // The one state that changes on its own, and the list re-reads on a
        // timer — a still mark here would look stuck rather than busy.
        <LoaderCircle aria-hidden size={11} className="animate-spin" />
      ) : (
        <GitBranch aria-hidden size={11} />
      )}
    </span>
  )
}
