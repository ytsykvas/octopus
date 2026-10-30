/**
 * How soon the pull request tab reads again, as pure functions.
 *
 * Apart from the hook so the rule can be read, and tested, without a timer:
 * which answer means "keep looking" and how soon is the whole of what makes
 * the tab current or stale.
 */

import type { PullRequestDetail } from '@core/pullRequestShapes.js'

/**
 * How often to look again while something is still moving.
 *
 * Only the request on screen is read on this clock — the tab reads nothing
 * while it is hidden, so switching to another workspace's tab moves the clock
 * with it — which is what affords it being three times the workspace list's
 * pace: that one is paid for every open project, this one for one request.
 * Not shorter: each read is two calls to GitHub, and a tab left open on a long
 * CI run is a few hundred of them an hour already.
 */
export const INTERVAL_MS = 5_000

/**
 * How long the tab keeps that clock on one request before it falls back.
 *
 * A required check that never reports is pending for ever, and the tab left
 * open on it read every 5 s for ever — some 1440 GraphQL points an hour of the
 * 5000 the account has. Ten minutes covers an ordinary CI run. Counted from the
 * last fresh read: a push, a turn ending, Refresh or another request starts it
 * again.
 */
export const FAST_FOR_MS = 10 * 60_000

/** The clock after that: the pace the workspace list keeps while a check runs. */
export const PATIENT_INTERVAL_MS = 15_000

/**
 * How long after a push the tab hurries.
 *
 * Long enough for GitHub to take the commit in, Actions to put a check on it
 * and mergeability to be worked out — seconds each, usually. A repository with
 * no CI never gets a check on the new commit, and this is what stops the tab
 * waiting for one for ever. The workspace list uses it too, for the same push.
 */
export const PUSH_SETTLE_MS = 90_000

/** The steps between reads while GitHub catches up with a push, before the ordinary clock. */
export const CATCH_UP_MS = [2_000, 3_000] as const

/** A push heard: the commit it sent, when, and how many reads have hurried since. */
export interface Pushed {
  readonly head: string
  readonly at: number
  readonly reads: number
}

/**
 * Whether there is anything left to wait for.
 *
 * The mergeability half is not an afterthought. GitHub computes it
 * asynchronously, so the first read after every push says `unknown` — and a
 * request whose repository runs no CI has no pending check to wait on either.
 * Polling on the checks alone would leave both of those unknown for ever.
 */
export function settling(detail: PullRequestDetail): boolean {
  return detail.checks.some((check) => check.state === 'pending') || detail.mergeable === 'unknown'
}

/**
 * How long to wait before the next read, or null for none.
 *
 * Right after a push GitHub has not caught up, and what it says then is worse
 * than nothing: the previous commit's checks, finished, which `settling` reads
 * as nothing to wait for. So until it names the commit sent, puts a check on it
 * and has worked out mergeability, the tab reads on `CATCH_UP_MS` — and after
 * that, or once `PUSH_SETTLE_MS` has passed, on the ordinary clock, which slows
 * once the tab has watched the request for `FAST_FOR_MS` since `since`.
 */
export function nextDelay(
  detail: PullRequestDetail,
  pushed: Pushed | null,
  now: number,
  since: number
): number | null {
  const behind =
    pushed !== null &&
    now - pushed.at < PUSH_SETTLE_MS &&
    (detail.head !== pushed.head || detail.checks.length === 0 || detail.mergeable === 'unknown')

  if (behind) return CATCH_UP_MS[pushed.reads] ?? INTERVAL_MS
  if (!settling(detail)) return null

  return now - since < FAST_FOR_MS ? INTERVAL_MS : PATIENT_INTERVAL_MS
}
