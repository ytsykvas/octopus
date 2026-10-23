import { describe, expect, it } from 'vitest'

import type {
  PullRequestCheck,
  PullRequestComment,
  PullRequestDetail
} from '@core/pullRequestShapes.js'

import { type ChecksVerdict, type MergeVerdict, requestStatus } from './requestStatus.js'

function detail(overrides: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    state: 'open',
    title: 'Rename the thing',
    url: 'https://github.com/o/p/pull/7',
    draft: false,
    checks: [],
    comments: [],
    decision: null,
    mergeable: 'mergeable',
    mergeState: 'clean',
    capped: false,
    ...overrides
  }
}

function check(state: PullRequestCheck['state'], name: string = state): PullRequestCheck {
  return {
    name,
    workflow: 'CI',
    state,
    url: null,
    startedAt: null,
    completedAt: null,
    runId: null
  }
}

const base = {
  id: 'C_1',
  author: 'olena',
  body: 'Why?',
  createdAt: '2026-08-20T11:00:00Z',
  url: null
}

const review: PullRequestComment = { ...base, kind: 'review', verdict: 'commented' }
const issue: PullRequestComment = { ...base, kind: 'issue' }

function thread(resolved: boolean): PullRequestComment {
  return {
    ...base,
    kind: 'inline',
    threadId: 'T_1',
    path: 'a.ts',
    line: 1,
    quote: '',
    resolved
  }
}

const clean = { dirty: false, unpushedCommits: 0 }

describe('the status of a request', () => {
  it('asks nothing of a clean, open request and calls it ready', () => {
    const status = requestStatus(detail({ checks: [check('passed')] }), clean)

    expect(status.attention).toEqual([])
    expect(status.offered).toEqual([])
    expect(status.merge).toBe('ready')
    expect(status.canMerge).toBe(true)
    expect(status.checks).toBe('passed')
    expect(status.noConflicts).toBe(true)
    expect(status.recommendedView).toBe('merge')
  })

  it('counts the checks that failed and keeps them for the prompt', () => {
    const red = check('failed', 'test')
    const status = requestStatus(detail({ checks: [red, check('passed')] }), clean)

    expect(status.failedChecks).toEqual([red])
    expect(status.checks).toBe('failed')
    expect(status.attention).toEqual([{ kind: 'failed', count: 1 }])
    expect(status.offered).toEqual(['fixChecks'])
    expect(status.merge).toBe('checks')
    expect(status.canMerge).toBe(false)
    expect(status.recommendedView).toBe('checks')
  })

  it('waits for a check that is still running', () => {
    const status = requestStatus(
      detail({ checks: [check('pending'), check('pending', 'b'), check('passed')] }),
      clean
    )

    expect(status.running).toBe(2)
    expect(status.checks).toBe('running')
    expect(status.attention).toEqual([{ kind: 'running', count: 2 }])
    expect(status.offered).toEqual([])
    expect(status.merge).toBe('checks')
    expect(status.canMerge).toBe(false)
    expect(status.recommendedView).toBe('checks')
  })

  /* Only what is reported holds the button: a repository that runs nothing, or
     whose every job a path filter skipped, would otherwise never merge. And
     neither is "passed" — nothing ran to pass. */
  it.each<[string, PullRequestCheck[], ChecksVerdict]>([
    ['runs no checks at all', [], 'none'],
    ['skipped every check', [check('skipped')], 'skipped']
  ])('merges a request whose repository %s', (_, checks, verdict) => {
    const status = requestStatus(detail({ checks }), clean)

    expect(status.checks).toBe(verdict)
    expect(status.merge).toBe('ready')
    expect(status.canMerge).toBe(true)
  })

  it('offers to answer a review once anybody has said anything', () => {
    for (const comments of [[review], [thread(false)]]) {
      const status = requestStatus(detail({ comments }), clean)
      expect(status.offered).toEqual(['addressReview'])
      expect(status.recommendedView).toBe('review')
    }
  })

  it('offers it on a decision even where nobody has written a word', () => {
    const status = requestStatus(detail({ decision: 'changesRequested' }), clean)
    expect(status.offered).toEqual(['addressReview'])
  })

  it('does not count a settled thread or a plain comment as a review', () => {
    const status = requestStatus(detail({ comments: [thread(true), issue] }), clean)

    expect(status.offered).toEqual([])
    expect(status.recommendedView).toBe('merge')
  })

  it('sends the reader to the checks before the review while one is red', () => {
    const status = requestStatus(
      detail({ checks: [check('failed')], decision: 'changesRequested' }),
      clean
    )
    expect(status.recommendedView).toBe('checks')
  })

  it('offers to resolve a conflict, and refuses to merge through one', () => {
    const status = requestStatus(detail({ mergeable: 'conflicting' }), clean)

    expect(status.merge).toBe('conflict')
    expect(status.noConflicts).toBe(false)
    expect(status.offered).toEqual(['resolveConflicts'])
    expect(status.attention).toEqual([{ kind: 'conflict' }])
    expect(status.canMerge).toBe(false)
  })

  it('refuses to merge a draft', () => {
    const status = requestStatus(detail({ draft: true }), clean)

    expect(status.merge).toBe('draft')
    expect(status.attention).toEqual([{ kind: 'draft' }])
    expect(status.canMerge).toBe(false)
  })

  /* The order the verdict is decided in: what GitHub would refuse first, then
     the checks octopus waits for, then GitHub's own hold, then its silence. */
  it.each<[string, Partial<PullRequestDetail>, MergeVerdict]>([
    ['a conflict over a draft', { mergeable: 'conflicting', draft: true }, 'conflict'],
    ['a draft over a red check', { draft: true, checks: [check('failed')] }, 'draft'],
    [
      'a red check over GitHub’s hold',
      { checks: [check('failed')], mergeState: 'blocked' },
      'checks'
    ],
    ['GitHub’s hold over its silence', { mergeState: 'blocked', mergeable: 'unknown' }, 'held']
  ])('puts %s', (_, overrides, verdict) => {
    expect(requestStatus(detail(overrides), clean).merge).toBe(verdict)
  })

  it('puts the work in this checkout first, then the checks, then GitHub', () => {
    const status = requestStatus(
      detail({ checks: [check('failed'), check('pending')], draft: true }),
      { dirty: true, unpushedCommits: 2 }
    )

    expect(status.attention.map((item) => item.kind)).toEqual([
      'uncommitted',
      'unpushed',
      'failed',
      'running',
      'draft'
    ])
  })

  it('ends the list with GitHub’s own word', () => {
    const status = requestStatus(detail({ draft: true, mergeState: 'blocked' }), {
      dirty: false,
      unpushedCommits: null
    })

    expect(status.attention.map((item) => item.kind)).toEqual([
      'unpushedUnknown',
      'draft',
      'githubNote'
    ])
  })

  it('says so when what is left to push cannot be counted', () => {
    const status = requestStatus(detail(), { dirty: false, unpushedCommits: null })
    expect(status.attention).toEqual([{ kind: 'unpushedUnknown' }])
  })

  it('lets uncommitted and unpushed work stand beside a merge, not in its way', () => {
    const status = requestStatus(detail(), { dirty: true, unpushedCommits: 3 })

    expect(status.merge).toBe('ready')
    expect(status.canMerge).toBe(true)
  })

  it.each([
    ['blocked', 'held'],
    ['behind', 'held'],
    ['unstable', 'ready']
  ] as const)('passes on GitHub’s %s note', (mergeState, verdict) => {
    const status = requestStatus(detail({ mergeState }), clean)

    expect(status.attention).toEqual([{ kind: 'githubNote', note: mergeState }])
    expect(status.merge).toBe(verdict)
    // A hold is GitHub's to make; the press still goes through, as auto-merge.
    expect(status.canMerge).toBe(true)
  })

  it.each(['clean', 'hasHooks', 'dirty'] as const)('says nothing for GitHub’s %s', (mergeState) => {
    expect(requestStatus(detail({ mergeState }), clean).attention).toEqual([])
  })

  /* Right after a push GitHub has not worked it out, and "ready" — or "no
     conflicts" — would be the app's guess rather than GitHub's answer. */
  it.each<[string, Partial<PullRequestDetail>, boolean]>([
    ['whether it conflicts', { mergeable: 'unknown' }, false],
    ['how it would merge', { mergeState: 'unknown' }, true]
  ])('waits while GitHub has not worked out %s', (_, overrides, noConflicts) => {
    const status = requestStatus(detail(overrides), clean)

    expect(status.merge).toBe('settling')
    expect(status.attention).toEqual([{ kind: 'settling' }])
    expect(status.noConflicts).toBe(noConflicts)
    expect(status.canMerge).toBe(true)
  })

  it('drops GitHub’s note while a check of ours, or a conflict, is giving the reason', () => {
    for (const overrides of [
      { checks: [check('failed')] },
      { checks: [check('pending')] },
      { mergeable: 'conflicting' as const }
    ]) {
      const kinds = requestStatus(detail({ mergeState: 'unstable', ...overrides }), clean).attention
      expect(kinds.map((item) => item.kind)).not.toContain('githubNote')
    }
  })

  /* What lets the footer say "ready to merge" for an empty list: every verdict
     that is not ready leaves a reason in it. */
  it('leaves a reason in the list for every verdict but ready', () => {
    const cases: Partial<PullRequestDetail>[] = [
      { mergeable: 'conflicting' },
      { draft: true },
      { checks: [check('failed')] },
      { checks: [check('pending')] },
      { mergeState: 'blocked' },
      { mergeState: 'behind' },
      { mergeable: 'unknown' },
      { mergeState: 'unknown' }
    ]
    for (const overrides of cases) {
      const status = requestStatus(detail(overrides), clean)
      expect(status.merge).not.toBe('ready')
      expect(status.attention).not.toEqual([])
    }
  })

  it.each(['merged', 'closed'] as const)(
    'has nothing left to do to a request that was %s',
    (state) => {
      const status = requestStatus(
        detail({ state, checks: [check('failed')], mergeable: 'conflicting', draft: true }),
        { dirty: true, unpushedCommits: 1 }
      )

      expect(status.state).toBe(state)
      expect(status.merge).toBe(state)
      expect(status.attention).toEqual([])
      expect(status.offered).toEqual([])
      expect(status.canMerge).toBe(false)
      expect(status.recommendedView).toBe('merge')
    }
  )
})
