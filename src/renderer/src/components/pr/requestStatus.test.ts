import { describe, expect, it } from 'vitest'

import type {
  PullRequestCheck,
  PullRequestComment,
  PullRequestDetail
} from '@core/pullRequestShapes.js'

import { requestStatus } from './requestStatus.js'

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
  it('asks nothing of a clean, open request but a review and a merge', () => {
    const status = requestStatus(detail(), clean)

    expect(status.attention).toEqual([])
    expect(status.offered).toEqual(['review', 'multiAgentReview'])
    expect(status.canMerge).toBe(true)
    expect(status.waiting).toBe(false)
    expect(status.recommendedView).toBe('merge')
  })

  it('counts the checks that failed and keeps them for the prompt', () => {
    const red = check('failed', 'test')
    const status = requestStatus(detail({ checks: [red, check('passed')] }), clean)

    expect(status.failedChecks).toEqual([red])
    expect(status.attention).toEqual([{ kind: 'failed', count: 1 }])
    expect(status.offered[0]).toBe('fixChecks')
    expect(status.canMerge).toBe(false)
    expect(status.recommendedView).toBe('checks')
  })

  it('waits for a check that is still running', () => {
    const status = requestStatus(
      detail({ checks: [check('pending'), check('pending', 'b')] }),
      clean
    )

    expect(status.running).toBe(2)
    expect(status.attention).toEqual([{ kind: 'running', count: 2 }])
    expect(status.offered).not.toContain('fixChecks')
    expect(status.canMerge).toBe(false)
    expect(status.recommendedView).toBe('checks')
  })

  it('merges a request whose repository runs no checks at all', () => {
    expect(requestStatus(detail({ checks: [] }), clean).canMerge).toBe(true)
  })

  it('offers to answer a review once anybody has said anything', () => {
    for (const comments of [[review], [thread(false)]]) {
      const status = requestStatus(detail({ comments }), clean)
      expect(status.offered).toContain('addressReview')
      expect(status.recommendedView).toBe('review')
    }
  })

  it('offers it on a decision even where nobody has written a word', () => {
    const status = requestStatus(detail({ decision: 'changesRequested' }), clean)
    expect(status.offered).toContain('addressReview')
  })

  it('does not count a settled thread or a plain comment as a review', () => {
    const status = requestStatus(detail({ comments: [thread(true), issue] }), clean)

    expect(status.offered).not.toContain('addressReview')
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

    expect(status.conflicting).toBe(true)
    expect(status.offered).toEqual(['resolveConflicts', 'review', 'multiAgentReview'])
    expect(status.attention).toEqual([{ kind: 'conflict' }])
    expect(status.canMerge).toBe(false)
  })

  it('refuses to merge a draft', () => {
    const status = requestStatus(detail({ draft: true }), clean)

    expect(status.attention).toEqual([{ kind: 'draft' }])
    expect(status.canMerge).toBe(false)
  })

  it('puts the work in this checkout first', () => {
    const status = requestStatus(detail({ checks: [check('failed')], mergeable: 'conflicting' }), {
      dirty: true,
      unpushedCommits: 2
    })

    expect(status.attention.map((item) => item.kind)).toEqual([
      'uncommitted',
      'unpushed',
      'failed',
      'conflict'
    ])
  })

  it('says so when what is left to push cannot be counted', () => {
    const status = requestStatus(detail(), { dirty: false, unpushedCommits: null })
    expect(status.attention).toEqual([{ kind: 'unpushedUnknown' }])
  })

  it('lets uncommitted and unpushed work stand beside a merge, not in its way', () => {
    expect(requestStatus(detail(), { dirty: true, unpushedCommits: 3 }).canMerge).toBe(true)
  })

  it.each([
    ['blocked', 'blocked'],
    ['behind', 'behind'],
    ['unstable', 'unstable']
  ] as const)('passes on GitHub’s %s note', (mergeState, note) => {
    expect(requestStatus(detail({ mergeState }), clean).attention).toEqual([
      { kind: 'githubNote', note }
    ])
  })

  it.each(['clean', 'hasHooks', 'unknown', 'dirty'] as const)(
    'says nothing for GitHub’s %s',
    (mergeState) => {
      expect(requestStatus(detail({ mergeState }), clean).attention).toEqual([])
    }
  )

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

  it.each(['merged', 'closed'] as const)(
    'has nothing left to do to a request that was %s',
    (state) => {
      const status = requestStatus(
        detail({ state, checks: [check('failed')], mergeable: 'conflicting', draft: true }),
        { dirty: true, unpushedCommits: 1 }
      )

      expect(status.open).toBe(false)
      expect(status.attention).toEqual([])
      expect(status.offered).toEqual([])
      expect(status.canMerge).toBe(false)
      expect(status.recommendedView).toBe('merge')
    }
  )
})
