import { describe, expect, it } from 'vitest'

import type { PullRequestCheck, PullRequestDetail } from '@core/pullRequestShapes.js'

import {
  CATCH_UP_MS,
  FAST_FOR_MS,
  INTERVAL_MS,
  nextDelay,
  PATIENT_INTERVAL_MS,
  type Pushed,
  PUSH_SETTLE_MS,
  settling
} from './pullRequestPace.js'

const OLD = 'a'.repeat(40)
const NEW = 'b'.repeat(40)
const NOW = 1_000_000

function detail(overrides: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    state: 'open',
    title: 'Rename the thing',
    description: '',
    url: 'https://github.com/o/p/pull/7',
    draft: false,
    head: NEW,
    checks: [],
    comments: [],
    decision: null,
    mergeable: 'mergeable',
    mergeState: 'clean',
    capped: false,
    ...overrides
  }
}

const check = (state: PullRequestCheck['state']): PullRequestCheck => ({
  name: 'build',
  workflow: null,
  state,
  url: null,
  startedAt: null,
  completedAt: null,
  runId: null
})

const pushed = (overrides: Partial<Pushed> = {}): Pushed => ({
  head: NEW,
  at: NOW,
  reads: 0,
  ...overrides
})

describe('settling', () => {
  it('waits on a pending check, and on mergeability GitHub has not worked out', () => {
    expect(settling(detail({ checks: [check('pending')] }))).toBe(true)
    expect(settling(detail({ mergeable: 'unknown' }))).toBe(true)
    expect(settling(detail({ checks: [check('passed')] }))).toBe(false)
  })
})

describe('nextDelay without a push', () => {
  it('keeps the old clock: fifteen seconds while something moves, then nothing', () => {
    expect(nextDelay(detail({ checks: [check('pending')] }), null, NOW, NOW)).toBe(INTERVAL_MS)
    expect(nextDelay(detail({ mergeable: 'unknown' }), null, NOW, NOW)).toBe(INTERVAL_MS)
    expect(nextDelay(detail({ checks: [check('failed')] }), null, NOW, NOW)).toBeNull()
  })
})

describe('nextDelay after a push', () => {
  /*
   * The bug this exists for: GitHub has not taken the push in, so it reports
   * the previous commit's checks, finished. Read alone that says there is
   * nothing to wait for, and the pane stopped looking.
   */
  it('reads again soon while GitHub is still on the commit before', () => {
    const stale = detail({ head: OLD, checks: [check('passed')] })

    expect(nextDelay(stale, pushed(), NOW, NOW)).toBe(CATCH_UP_MS[0])
  })

  it('backs off into the ordinary clock', () => {
    const stale = detail({ head: OLD, checks: [check('passed')] })

    expect(
      [0, 1, 2, 3, 4, 9].map((reads) => nextDelay(stale, pushed({ reads }), NOW, NOW))
    ).toEqual([2_000, 3_000, INTERVAL_MS, INTERVAL_MS, INTERVAL_MS, INTERVAL_MS])
  })

  // GitHub has the commit, but Actions has not put a check on it yet.
  it('reads again soon while the new commit has no checks', () => {
    expect(nextDelay(detail(), pushed(), NOW, NOW)).toBe(CATCH_UP_MS[0])
  })

  it('reads again soon while mergeability is still being worked out', () => {
    const working = detail({ checks: [check('passed')], mergeable: 'unknown' })

    expect(nextDelay(working, pushed(), NOW, NOW)).toBe(CATCH_UP_MS[0])
  })

  // Caught up: a check is running on the right commit, which is the old clock's
  // business, and minutes of it at two seconds would be a query a second.
  it('goes back to the old clock once GitHub has caught up', () => {
    const running = detail({ checks: [check('pending')] })

    expect(nextDelay(running, pushed(), NOW, NOW)).toBe(INTERVAL_MS)
    expect(nextDelay(detail({ checks: [check('passed')] }), pushed(), NOW, NOW)).toBeNull()
  })

  // A repository with no CI never gets a check on the new commit either.
  it('stops hurrying once the window after the push has passed', () => {
    expect(nextDelay(detail(), pushed({ at: NOW - PUSH_SETTLE_MS }), NOW, NOW)).toBeNull()
    expect(nextDelay(detail(), pushed({ at: NOW - PUSH_SETTLE_MS + 1 }), NOW, NOW)).toBe(
      CATCH_UP_MS[0]
    )
  })
})

describe('nextDelay on a long run', () => {
  /*
   * A required check that never reports is pending for ever, and the tab left
   * open on it read every 5 s for ever: two GraphQL points a read, some 1440
   * an hour of the 5000 the account has.
   */
  it('keeps the fast clock for ten minutes on one request, then the patient one', () => {
    const running = detail({ checks: [check('pending')] })
    const working = detail({ checks: [check('passed')], mergeable: 'unknown' })

    expect(nextDelay(running, null, NOW, NOW - FAST_FOR_MS + 1)).toBe(INTERVAL_MS)
    expect(nextDelay(running, null, NOW, NOW - FAST_FOR_MS)).toBe(PATIENT_INTERVAL_MS)
    expect(nextDelay(working, null, NOW, NOW - FAST_FOR_MS)).toBe(PATIENT_INTERVAL_MS)
  })

  // Catching up with a push is its own window, and short.
  it('does not slow the catching up after a push', () => {
    const stale = detail({ head: OLD, checks: [check('passed')] })

    expect(nextDelay(stale, pushed(), NOW, NOW - FAST_FOR_MS)).toBe(CATCH_UP_MS[0])
  })
})
