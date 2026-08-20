import { describe, expect, it } from 'vitest'

import {
  BranchListSchema,
  commentKey,
  type DetailPayload,
  DetailPayloadSchema,
  type PullRequestCheck,
  type PullRequestComment,
  summariseChecks,
  type ThreadsPayload,
  ThreadsPayloadSchema,
  toBranchRequests,
  toPullRequestDetail
} from './pullRequestShapes.js'

/*
 * Every literal in this file was printed by `gh` 2.96.0 against a real
 * repository, not written from the documentation. The three that matter most —
 * a queued run's Go zero values, a status from the older API, and a review with
 * a null url — are exactly the shapes a fabricated fixture gets wrong, and each
 * of them would have reached the screen as a rendered defect rather than as a
 * failing test.
 */

/** A finished Actions job. `rails/rails#58524`. */
const PASSED = {
  __typename: 'CheckRun',
  name: 'rails-new-docker',
  workflowName: 'rails-new-docker',
  status: 'COMPLETED',
  conclusion: 'SUCCESS',
  startedAt: '2026-08-20T10:59:48Z',
  completedAt: '2026-08-20T11:02:24Z',
  detailsUrl: 'https://github.com/rails/rails/actions/runs/32361632571/job/96402258183'
}

/** One that has not run yet. `vercel/next.js#97612` — both zero values are real. */
const QUEUED = {
  __typename: 'CheckRun',
  name: 'build / build',
  workflowName: 'Generate Stats',
  status: 'QUEUED',
  conclusion: '',
  startedAt: '2026-08-20T11:16:23Z',
  completedAt: '0001-01-01T00:00:00Z',
  detailsUrl: 'https://github.com/vercel/next.js/actions/runs/32362999714/job/96406411653'
}

/** Buildkite, through the Commit Status API. `rails/rails#58524`. */
const CONTEXT = {
  __typename: 'StatusContext',
  context: 'buildkite/rails',
  state: 'SUCCESS',
  targetUrl: 'https://buildkite.com/rails/rails/builds/132724',
  startedAt: '2026-08-20T11:06:03Z'
}

function view(overrides: Record<string, unknown> = {}): DetailPayload {
  return DetailPayloadSchema.parse({
    id: 'PR_kwDODKw3uc8AAAABATwpjg',
    state: 'OPEN',
    title: 'Fix the thing',
    url: 'https://github.com/o/p/pull/12',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    // The ordinary value on a repository with no required reviewers, which is
    // most of them.
    reviewDecision: '',
    statusCheckRollup: [],
    comments: [],
    reviews: [],
    ...overrides
  })
}

function threads(...nodes: unknown[]): ThreadsPayload {
  return ThreadsPayloadSchema.parse({ data: { node: { reviewThreads: { nodes } } } })
}

const NO_THREADS = threads()

function checksOf(overrides: Record<string, unknown>): readonly PullRequestCheck[] {
  return toPullRequestDetail(view(overrides), NO_THREADS).checks
}

function commentsOf(
  overrides: Record<string, unknown>,
  reviewThreads: ThreadsPayload = NO_THREADS
): readonly PullRequestComment[] {
  return toPullRequestDetail(view(overrides), reviewThreads).comments
}

/** One inline note, as the GraphQL query returns it. `cli/cli#14200`. */
function thread(
  isResolved: boolean,
  comment: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    isResolved,
    comments: {
      nodes: [
        {
          id: 'PRRC_kwDODKw3uc7jZJ2P',
          author: { login: 'copilot-pull-request-reviewer' },
          body: 'Add a Go doc comment for this exported constant group.',
          createdAt: '2026-08-19T16:53:18Z',
          url: 'https://github.com/cli/cli/pull/14200#discussion_r3815021967',
          diffHunk: '@@ -109,14 +110,26 @@ type TokenType string\n \n const (',
          path: 'internal/gh/gh.go',
          line: 111,
          ...comment
        }
      ]
    }
  }
}

describe('the check rollup', () => {
  it('reads a finished job and one that has not run from the same list', () => {
    const checks = checksOf({ statusCheckRollup: [PASSED, QUEUED] })

    expect(checks).toEqual([
      {
        name: 'rails-new-docker',
        workflow: 'rails-new-docker',
        state: 'passed',
        url: PASSED.detailsUrl,
        startedAt: '2026-08-20T10:59:48Z',
        completedAt: '2026-08-20T11:02:24Z'
      },
      {
        name: 'build / build',
        workflow: 'Generate Stats',
        state: 'pending',
        url: QUEUED.detailsUrl,
        startedAt: '2026-08-20T11:16:23Z',
        completedAt: null
      }
    ])
  })

  /*
   * The bug this prevents is not a wrong label. `gh` marshals a Go struct, so
   * an unfinished run's `completedAt` is the zero time rather than null — and a
   * duration taken from it is about two thousand years, drawn beside the job.
   */
  it("drops Go's zero time rather than treating it as a moment", () => {
    expect(checksOf({ statusCheckRollup: [QUEUED] })[0]?.completedAt).toBeNull()
  })

  /* A run in flight reports `conclusion: ""`, which is in no table. Reading the
     conclusion before the status is how that becomes whatever the unknown case
     happens to be. */
  it('waits on the status before it reads the conclusion at all', () => {
    const running = { ...QUEUED, status: 'IN_PROGRESS' }

    expect(checksOf({ statusCheckRollup: [running] })[0]?.state).toBe('pending')
  })

  it('takes an entry from the older status API, which carries other keys entirely', () => {
    expect(checksOf({ statusCheckRollup: [CONTEXT] })).toEqual([
      {
        name: 'buildkite/rails',
        // The old API has no workflows, and no end time either: a status is a
        // point rather than a span.
        workflow: null,
        state: 'passed',
        url: CONTEXT.targetUrl,
        startedAt: '2026-08-20T11:06:03Z',
        completedAt: null
      }
    ])
  })

  it('reads every conclusion GitHub documents', () => {
    const states = ['SUCCESS', 'NEUTRAL', 'SKIPPED', 'CANCELLED', 'STALE'].map(
      (conclusion) => checksOf({ statusCheckRollup: [{ ...PASSED, conclusion }] })[0]?.state
    )

    expect(states).toEqual(['passed', 'skipped', 'skipped', 'skipped', 'skipped'])

    const failures = ['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].map(
      (conclusion) => checksOf({ statusCheckRollup: [{ ...PASSED, conclusion }] })[0]?.state
    )

    expect(failures).toEqual(['failed', 'failed', 'failed', 'failed'])
  })

  it('reads every state the older API documents', () => {
    const states = ['SUCCESS', 'PENDING', 'EXPECTED', 'FAILURE', 'ERROR'].map(
      (state) => checksOf({ statusCheckRollup: [{ ...CONTEXT, state }] })[0]?.state
    )

    expect(states).toEqual(['passed', 'pending', 'pending', 'failed', 'failed'])
  })

  /* GitHub adds conclusions. A red mark for a word we merely have no colour for
     sends the author looking for a fault that is not there. */
  it('does not call a conclusion it has never heard of a failure', () => {
    const strange = { ...PASSED, conclusion: 'MYSTERY' }

    expect(checksOf({ statusCheckRollup: [strange] })[0]?.state).toBe('skipped')
  })

  it('does not call a status it has never heard of a pass', () => {
    const strange = { ...CONTEXT, state: 'MYSTERY' }

    expect(checksOf({ statusCheckRollup: [strange] })[0]?.state).toBe('pending')
  })

  it('has no link where GitHub sent an empty one, rather than a link to nowhere', () => {
    const [run, context] = checksOf({
      statusCheckRollup: [
        { ...PASSED, detailsUrl: '', workflowName: undefined },
        { ...CONTEXT, targetUrl: null }
      ]
    })

    expect(run?.url).toBeNull()
    // A job outside a workflow — the key is simply absent rather than empty.
    expect(run?.workflow).toBeNull()
    expect(context?.url).toBeNull()
  })

  /* Verified against `github/gitignore`, whose pull requests have no CI at all:
     the field comes back as an empty array. Null is accepted too, because
     nothing in GraphQL's schema promises otherwise. */
  it('answers with no checks where a commit has none', () => {
    expect(checksOf({ statusCheckRollup: [] })).toEqual([])
    expect(checksOf({ statusCheckRollup: null })).toEqual([])
  })
})

describe('summarising the checks for a workspace row', () => {
  const check = (state: PullRequestCheck['state']): PullRequestCheck => ({
    name: state,
    workflow: null,
    state,
    url: null,
    startedAt: null,
    completedAt: null
  })

  it('says there are none where there are none', () => {
    expect(summariseChecks([])).toBe('none')
  })

  it('says passed when everything that ran passed or was skipped', () => {
    expect(summariseChecks([check('passed'), check('skipped')])).toBe('passed')
  })

  it('says running while something is still going', () => {
    expect(summariseChecks([check('passed'), check('pending')])).toBe('running')
  })

  /* A failure outranks a run still going. Something is already known to be
     wrong, and a spinner over it would say the answer is still open. */
  it('says failed even while something else is still running', () => {
    expect(summariseChecks([check('failed'), check('pending')])).toBe('failed')
  })
})

describe('what people said on a pull request', () => {
  it('reads an ordinary comment', () => {
    const comments = commentsOf({
      comments: [
        {
          id: 'IC_kwDODKw3uc8AAAABPg32RQ',
          author: { login: 'ytsykvas' },
          body: 'Thanks for this.',
          createdAt: '2026-08-19T00:42:41Z',
          url: 'https://github.com/o/p/pull/12#issuecomment-5336069701'
        }
      ]
    })

    expect(comments).toEqual([
      {
        kind: 'issue',
        id: 'IC_kwDODKw3uc8AAAABPg32RQ',
        author: 'ytsykvas',
        body: 'Thanks for this.',
        createdAt: '2026-08-19T00:42:41Z',
        url: 'https://github.com/o/p/pull/12#issuecomment-5336069701'
      }
    ])
  })

  /* GraphQL models a deleted account as no author at all and sends null, and it
     does so for all three kinds — so all three are asked, since each builds its
     own record and one of them forgetting is invisible from the other two. */
  it('keeps what somebody said after they deleted their account', () => {
    const comments = commentsOf(
      {
        comments: [
          {
            id: 'IC_1',
            author: null,
            body: 'Still worth reading.',
            createdAt: '2026-08-19T00:42:41Z',
            url: 'https://github.com/o/p/pull/12#issuecomment-1'
          }
        ],
        reviews: [
          {
            id: 'PRR_1',
            author: null,
            body: 'And so is this.',
            state: 'COMMENTED',
            submittedAt: '2026-08-19T00:43:00Z',
            url: null
          }
        ]
      },
      threads(thread(false, { author: null, createdAt: '2026-08-19T00:44:00Z' }))
    )

    expect(comments.map((comment) => comment.author)).toEqual([null, null, null])
  })

  it('reads a submitted review, whose url GitHub does not send', () => {
    const comments = commentsOf({
      reviews: [
        {
          id: 'PRR_kwDODKw3uc8AAAABKINcsw',
          author: { login: 'babakks' },
          body: 'LGTM! Thanks for fixing this!',
          state: 'APPROVED',
          submittedAt: '2026-08-11T09:47:21Z',
          url: null
        }
      ]
    })

    expect(comments).toEqual([
      {
        kind: 'review',
        id: 'PRR_kwDODKw3uc8AAAABKINcsw',
        author: 'babakks',
        body: 'LGTM! Thanks for fixing this!',
        createdAt: '2026-08-11T09:47:21Z',
        url: null,
        verdict: 'approved'
      }
    ])
  })

  it('reads every verdict a review can carry', () => {
    const verdicts = ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'].map((state) => {
      const [comment] = commentsOf({
        reviews: [
          {
            id: state,
            author: { login: 'olena' },
            body: 'a word',
            state,
            submittedAt: '2026-08-11T09:47:21Z',
            url: null
          }
        ]
      })

      return comment?.kind === 'review' ? comment.verdict : null
    })

    expect(verdicts).toEqual(['approved', 'changesRequested', 'commented', 'dismissed'])
  })

  it('treats a verdict it has never heard of as a remark', () => {
    const [comment] = commentsOf({
      reviews: [
        {
          id: 'PRR_1',
          author: { login: 'olena' },
          body: 'a word',
          state: 'MYSTERY',
          submittedAt: '2026-08-11T09:47:21Z',
          url: null
        }
      ]
    })

    expect(comment?.kind === 'review' && comment.verdict).toBe('commented')
  })

  /* A bare approval has an empty body and is the whole point of the review, so
     it stays. The batch record GitHub writes for a set of inline notes is also
     empty-bodied and says nothing at all — drawn, it is a nameless empty bubble
     above the notes it contains. */
  it('shows an approval with no words and drops a remark with none', () => {
    const bare = (state: string): readonly PullRequestComment[] =>
      commentsOf({
        reviews: [
          {
            id: state,
            author: { login: 'olena' },
            body: '',
            state,
            submittedAt: '2026-08-11T09:47:21Z',
            url: null
          }
        ]
      })

    expect(bare('APPROVED')).toHaveLength(1)
    expect(bare('COMMENTED')).toHaveLength(0)
  })

  /* GitHub lists the viewer's own unfinished review, which nobody else can see
     and which has no time to sort by. */
  it('drops a review that has never been submitted', () => {
    const pending = {
      id: 'PRR_1',
      author: { login: 'olena' },
      body: 'half a thought',
      state: 'PENDING',
      url: null
    }

    expect(commentsOf({ reviews: [{ ...pending, submittedAt: null }] })).toHaveLength(0)
    // Absent rather than null, which is the other way GitHub spells it.
    expect(commentsOf({ reviews: [pending] })).toHaveLength(0)
  })

  it('reads an inline note with the hunk it was written against', () => {
    const comments = commentsOf({}, threads(thread(false)))

    expect(comments).toEqual([
      {
        kind: 'inline',
        id: 'PRRC_kwDODKw3uc7jZJ2P',
        author: 'copilot-pull-request-reviewer',
        body: 'Add a Go doc comment for this exported constant group.',
        createdAt: '2026-08-19T16:53:18Z',
        url: 'https://github.com/cli/cli/pull/14200#discussion_r3815021967',
        path: 'internal/gh/gh.go',
        line: 111,
        quote: '@@ -109,14 +110,26 @@ type TokenType string\n \n const (',
        resolved: false
      }
    ])
  })

  it('carries whether the thread it belongs to has been settled', () => {
    const [comment] = commentsOf({}, threads(thread(true)))

    expect(comment?.kind === 'inline' && comment.resolved).toBe(true)
  })

  /* A note whose lines the diff has moved past has no line any more — GitHub
     sends null, and the note is still worth reading. */
  it('keeps a note that the diff has moved past', () => {
    const [comment] = commentsOf({}, threads(thread(false, { line: null })))

    expect(comment?.kind === 'inline' && comment.line).toBeNull()
  })

  it('puts all three kinds in one reading order, oldest first', () => {
    const comments = commentsOf(
      {
        comments: [
          {
            id: 'IC_1',
            author: { login: 'ivan' },
            body: 'last',
            createdAt: '2026-08-19T18:00:00Z',
            url: 'https://github.com/o/p/pull/12#issuecomment-1'
          }
        ],
        reviews: [
          {
            id: 'PRR_1',
            author: { login: 'olena' },
            body: 'second',
            state: 'COMMENTED',
            submittedAt: '2026-08-19T17:00:00Z',
            url: null
          }
        ]
      },
      threads(thread(false, { createdAt: '2026-08-19T16:00:00Z', body: 'first' }))
    )

    expect(comments.map((comment) => comment.body)).toEqual(['first', 'second', 'last'])
  })

  it('names a comment by its kind as well as its id', () => {
    // An inline comment's id is a number in REST and a node id here; nothing
    // promises the two namespaces never collide, and the kind settles it.
    expect(commentKey({ kind: 'issue', id: '7' } as PullRequestComment)).toBe('issue:7')
    expect(commentKey({ kind: 'inline', id: '7' } as PullRequestComment)).toBe('inline:7')
  })
})

describe('where a pull request stands', () => {
  it('lowers what GitHub shouts', () => {
    const detail = toPullRequestDetail(view({ state: 'MERGED', isDraft: true }), NO_THREADS)

    expect(detail).toMatchObject({
      state: 'merged',
      title: 'Fix the thing',
      url: 'https://github.com/o/p/pull/12',
      draft: true
    })
  })

  it('reads a review decision, and has none where GitHub sends none', () => {
    const decisions = ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED', '', 'MYSTERY'].map(
      (reviewDecision) => toPullRequestDetail(view({ reviewDecision }), NO_THREADS).decision
    )

    expect(decisions).toEqual(['approved', 'changesRequested', 'reviewRequired', null, null])
  })

  /*
   * Mergeability is computed asynchronously, so the first read after every push
   * says `UNKNOWN`. Treated as conflicting it would refuse a request that is
   * perfectly mergeable — GitHub's own interface treats it as clean until it
   * knows otherwise, and so does this.
   */
  it('keeps unknown mergeability as unknown rather than as a conflict', () => {
    const answers = ['MERGEABLE', 'CONFLICTING', 'UNKNOWN', 'MYSTERY'].map(
      (mergeable) => toPullRequestDetail(view({ mergeable }), NO_THREADS).mergeable
    )

    expect(answers).toEqual(['mergeable', 'conflicting', 'unknown', 'unknown'])
  })

  /* Two axes, not one: GitHub answers `MERGEABLE` beside `BLOCKED` whenever the
     trees are fine and a required review is missing. */
  it('reads the merge state apart from whether the trees conflict', () => {
    const blocked = toPullRequestDetail(
      view({ mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED' }),
      NO_THREADS
    )

    expect(blocked).toMatchObject({ mergeable: 'mergeable', mergeState: 'blocked' })

    const states = ['CLEAN', 'BEHIND', 'UNSTABLE', 'DIRTY', 'HAS_HOOKS', 'UNKNOWN', 'MYSTERY'].map(
      (mergeStateStatus) => toPullRequestDetail(view({ mergeStateStatus }), NO_THREADS).mergeState
    )

    expect(states).toEqual([
      'clean',
      'behind',
      'unstable',
      'dirty',
      'hasHooks',
      'unknown',
      'unknown'
    ])
  })
})

describe('every branch of a project at once', () => {
  const entry = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    headRefName: 'ytsykvas/anna',
    number: 12,
    state: 'OPEN',
    url: 'https://github.com/o/p/pull/12',
    statusCheckRollup: [PASSED],
    ...overrides
  })

  it('summarises each branch down to what a row can say', () => {
    expect(toBranchRequests(BranchListSchema.parse([entry()]))).toEqual([
      {
        branch: 'ytsykvas/anna',
        number: 12,
        state: 'open',
        checks: 'passed',
        url: 'https://github.com/o/p/pull/12'
      }
    ])
  })

  it('reads a closed branch and a merged one', () => {
    const requests = toBranchRequests(
      BranchListSchema.parse([
        entry({ headRefName: 'a', state: 'MERGED' }),
        entry({ headRefName: 'b', state: 'CLOSED' })
      ])
    )

    expect(requests.map((request) => request.state)).toEqual(['merged', 'closed'])
  })

  /* A branch opened, closed and opened again has more than one request, and
     `gh` lists the most recent first. The mark beside the row is about the
     current one. */
  it('keeps only the newest request for a branch', () => {
    const requests = toBranchRequests(
      BranchListSchema.parse([entry({ number: 12 }), entry({ number: 3, state: 'CLOSED' })])
    )

    expect(requests).toHaveLength(1)
    expect(requests[0]?.number).toBe(12)
  })

  it('says a branch has no checks where its repository runs none', () => {
    const requests = toBranchRequests(BranchListSchema.parse([entry({ statusCheckRollup: [] })]))

    expect(requests[0]?.checks).toBe('none')
  })
})
