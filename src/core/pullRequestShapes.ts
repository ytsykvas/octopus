/**
 * What GitHub says about a pull request, and what octopus makes of it.
 *
 * Schemas, lowering tables and normalisation, and nothing else: no executor, no
 * `node:` import, no error class of its own. `pullRequests.ts` runs `gh`, hands
 * the parsed JSON here and translates a refusal into a `GitHubError` — which is
 * why this file cannot reach for one, since `github.ts` pulls in `accounts.ts`
 * and with it `node:child_process`.
 *
 * That split is worth more than tidiness. Every awkward thing GitHub sends —
 * and there are ten of them, each recorded below beside the shape that answers
 * it — becomes a literal in a test here rather than a fabricated reply fed
 * through a fake `gh`. And a pure module may be imported by **value** from the
 * renderer, which `pullRequests.ts` never can.
 */

import { z } from 'zod'

/**
 * What has become of the branch.
 *
 * `none` is not a member: most branches have no pull request most of the time,
 * and that is the absence of one of these rather than a fourth kind.
 */
export type PullRequestState = 'open' | 'merged' | 'closed'

export const RemoteStateSchema = z.enum(['OPEN', 'MERGED', 'CLOSED'])

/** `gh` shouts its enums; nothing downstream should have to remember that. */
const STATES: Record<z.infer<typeof RemoteStateSchema>, PullRequestState> = {
  OPEN: 'open',
  MERGED: 'merged',
  CLOSED: 'closed'
}

/** The same lowering for the one reading that does not come through this file. */
export function toPullRequestState(state: z.infer<typeof RemoteStateSchema>): PullRequestState {
  return STATES[state]
}

// ─── checks ──────────────────────────────────────────────────────────────────

/**
 * One check, reduced to the four answers a reader acts on.
 *
 * `skipped` is deliberately not folded into `passed`: a suite where half the
 * jobs were skipped has not been run, and a green mark would say it had.
 */
export type CheckState = 'pending' | 'passed' | 'failed' | 'skipped'

export interface PullRequestCheck {
  readonly name: string
  /** The workflow it belongs to; two of them may both have a `build`. */
  readonly workflow: string | null
  readonly state: CheckState
  readonly url: string | null
  readonly startedAt: string | null
  /** Null while it is still running — see `moment`. */
  readonly completedAt: string | null
}

/** Every check at once, which is all the workspace list has room to say. */
export type ChecksSummary = 'none' | 'running' | 'passed' | 'failed'

/**
 * Go's zero time.
 *
 * `gh` marshals Go structs, so an unfinished run does not come back with a null
 * `completedAt` — it comes back with this. A duration taken from it lands two
 * thousand years before the branch existed, and it renders.
 */
const NO_TIME = '0001-01-01T00:00:00Z'

/**
 * The rollup is a union of exactly two shapes with almost disjoint keys.
 *
 * `CheckRun` is a GitHub Actions job. `StatusContext` is the older Commit
 * Status API, which is what Buildkite, CircleCI and every external service
 * still report through — so a repository can easily have both, and a schema
 * written against a sample containing only the first fails on a real one.
 *
 * Strict on `__typename` rather than lenient: GraphQL's own
 * `StatusCheckRollupContext` union has these two members and no more, so a
 * third would be a change worth failing on rather than quietly dropping.
 */
const CheckRunSchema = z.object({
  __typename: z.literal('CheckRun'),
  name: z.string(),
  workflowName: z.string().optional(),
  status: z.string(),
  /** `""` while the run is in flight — not null, and not absent. */
  conclusion: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  detailsUrl: z.string()
})

const StatusContextSchema = z.object({
  __typename: z.literal('StatusContext'),
  /* No `name`, no `conclusion`, no `completedAt`, no `detailsUrl`: this half of
     the union carries different keys, not differently typed ones. */
  context: z.string(),
  state: z.string(),
  targetUrl: z.string().nullish(),
  startedAt: z.string()
})

/**
 * How a finished run's conclusion reads.
 *
 * `CANCELLED` sits with the skips rather than the failures: a run somebody
 * stopped says nothing about the code, and an orange mark on the branch would
 * send its author looking for a fault that is not there.
 */
const CONCLUSIONS: Record<string, CheckState> = {
  SUCCESS: 'passed',
  NEUTRAL: 'skipped',
  SKIPPED: 'skipped',
  CANCELLED: 'skipped',
  STALE: 'skipped',
  FAILURE: 'failed',
  TIMED_OUT: 'failed',
  ACTION_REQUIRED: 'failed',
  STARTUP_FAILURE: 'failed'
}

const CONTEXT_STATES: Record<string, CheckState> = {
  SUCCESS: 'passed',
  PENDING: 'pending',
  EXPECTED: 'pending',
  FAILURE: 'failed',
  ERROR: 'failed'
}

/**
 * A time, or null where GitHub has not got one.
 *
 * Two spellings of "nothing" arrive here — empty, and Go's zero time — and only
 * the second is surprising enough to be worth the constant above.
 */
function moment(value: string): string | null {
  return value === '' || value === NO_TIME ? null : value
}

/** An empty string is how `gh` spells an absent URL, having marshalled a Go string. */
function link(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === '' ? null : value
}

/**
 * The state of one entry in the rollup.
 *
 * Status first, conclusion second, and never the other way round: a run in
 * flight reports `conclusion: ""`, which is in no table and would otherwise
 * fall to whatever the unknown case is.
 */
function checkRun(entry: z.infer<typeof CheckRunSchema>): PullRequestCheck {
  return {
    name: entry.name,
    workflow: link(entry.workflowName),
    state:
      entry.status === 'COMPLETED'
        ? // An unknown conclusion is not a failure. GitHub adds them, and a red
          // mark for a word we merely have no colour for is a lie about the code.
          (CONCLUSIONS[entry.conclusion] ?? 'skipped')
        : 'pending',
    url: link(entry.detailsUrl),
    startedAt: moment(entry.startedAt),
    completedAt: moment(entry.completedAt)
  }
}

function statusContext(entry: z.infer<typeof StatusContextSchema>): PullRequestCheck {
  return {
    name: entry.context,
    // The old API has no notion of a workflow; the context string is the whole
    // of what it is called.
    workflow: null,
    state: CONTEXT_STATES[entry.state] ?? 'pending',
    url: link(entry.targetUrl),
    startedAt: moment(entry.startedAt),
    // Never sent for this half of the union. A status is a point, not a span.
    completedAt: null
  }
}

/**
 * The rollup as it arrives, and as the pane reads it.
 *
 * One schema and one mapping, used by both the detail read and the whole-project
 * one. Written twice they would drift the first time GitHub added a conclusion,
 * and the two would then disagree about the colour of the same check.
 */
const RollupSchema = z
  .array(z.discriminatedUnion('__typename', [CheckRunSchema, StatusContextSchema]))
  .nullish()

function toChecks(rollup: z.infer<typeof RollupSchema>): PullRequestCheck[] {
  // Null as well as absent: a commit with no checks answers `[]`, but nothing
  // in GraphQL's schema promises that, and the union is cheap.
  return (rollup ?? []).map((entry) =>
    entry.__typename === 'CheckRun' ? checkRun(entry) : statusContext(entry)
  )
}

/**
 * What the mark beside a workspace says.
 *
 * A failure outranks a run still going: something is already known to be wrong,
 * and a spinner over it would promise that the answer is still open.
 */
export function summariseChecks(checks: readonly PullRequestCheck[]): ChecksSummary {
  if (checks.length === 0) return 'none'
  if (checks.some((check) => check.state === 'failed')) return 'failed'
  if (checks.some((check) => check.state === 'pending')) return 'running'
  return 'passed'
}

// ─── the review ──────────────────────────────────────────────────────────────

/** What a submitted review said, in the same lowered spelling as everything else. */
export type ReviewVerdict = 'approved' | 'changesRequested' | 'commented' | 'dismissed'

const VERDICTS: Record<string, ReviewVerdict> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changesRequested',
  COMMENTED: 'commented',
  DISMISSED: 'dismissed'
}

/** GitHub's own summary of where the review stands, or null where it has none. */
export type ReviewDecision = 'approved' | 'changesRequested' | 'reviewRequired'

const DECISIONS: Record<string, ReviewDecision> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changesRequested',
  REVIEW_REQUIRED: 'reviewRequired'
}

interface CommentBase {
  readonly id: string
  /** Null for a deleted account, which GraphQL models and therefore sends. */
  readonly author: string | null
  readonly body: string
  readonly createdAt: string
  /** A review carries none; GitHub sends null for it. */
  readonly url: string | null
}

/**
 * The three things GitHub calls a comment, told apart rather than flattened.
 *
 * They differ in what they are *about*: a review is about the request, an
 * inline note is about a line, and an issue comment is about neither. Flattened
 * into one record with nullable extras, the pane would have to answer for a
 * note with a path and no line, and GitHub sends no such thing.
 */
export type PullRequestComment =
  | (CommentBase & { readonly kind: 'issue' })
  | (CommentBase & { readonly kind: 'review'; readonly verdict: ReviewVerdict })
  | (CommentBase & {
      readonly kind: 'inline'
      readonly path: string
      /** Null once the diff has moved past it — the note is outdated. */
      readonly line: number | null
      /** The hunk GitHub kept, which is what a quote of it survives on. */
      readonly quote: string
      readonly resolved: boolean
    })

/** What identifies a comment wherever it is held — the chip, the store, the key. */
export function commentKey(comment: PullRequestComment): string {
  return `${comment.kind}:${comment.id}`
}

// ─── the detail ──────────────────────────────────────────────────────────────

/**
 * Whether the two trees conflict.
 *
 * Separate from `mergeState` below, and they are genuinely two questions:
 * GitHub answers `MERGEABLE` beside `BLOCKED` all the time — the trees are
 * fine and a required review is missing.
 */
export type Mergeable = 'mergeable' | 'conflicting' | 'unknown'

const MERGEABLE: Record<string, Mergeable> = {
  MERGEABLE: 'mergeable',
  CONFLICTING: 'conflicting',
  UNKNOWN: 'unknown'
}

/** Why a merge would or would not go through, in GitHub's own seven answers. */
export type MergeState =
  'clean' | 'blocked' | 'behind' | 'unstable' | 'dirty' | 'hasHooks' | 'unknown'

const MERGE_STATES: Record<string, MergeState> = {
  CLEAN: 'clean',
  BLOCKED: 'blocked',
  BEHIND: 'behind',
  UNSTABLE: 'unstable',
  DIRTY: 'dirty',
  HAS_HOOKS: 'hasHooks',
  UNKNOWN: 'unknown'
}

export interface PullRequestDetail {
  /** Carried here as well as on the summary, so a poll notices a merge by somebody else. */
  readonly state: PullRequestState
  readonly title: string
  readonly url: string
  readonly draft: boolean
  readonly checks: readonly PullRequestCheck[]
  /** All three kinds in one reading order, oldest first. */
  readonly comments: readonly PullRequestComment[]
  readonly decision: ReviewDecision | null
  readonly mergeable: Mergeable
  readonly mergeState: MergeState
}

const AuthorSchema = z.object({ login: z.string() }).nullish()

/** What `gh pr view --json …` sends, narrowed to what the pane draws. */
export const DetailPayloadSchema = z.object({
  id: z.string(),
  state: RemoteStateSchema,
  title: z.string(),
  url: z.string(),
  isDraft: z.boolean(),
  mergeable: z.string(),
  mergeStateStatus: z.string(),
  /* `""` where there is none — not null, and on a repository with no required
     reviewers that is very nearly always. Anything gated on this alone would
     never fire there. */
  reviewDecision: z.string(),
  statusCheckRollup: RollupSchema,
  comments: z.array(
    z.object({
      id: z.string(),
      author: AuthorSchema,
      body: z.string(),
      createdAt: z.string(),
      url: z.string()
    })
  ),
  reviews: z.array(
    z.object({
      id: z.string(),
      author: AuthorSchema,
      body: z.string(),
      state: z.string(),
      /** Null for the viewer's own unsubmitted draft, which GitHub still lists. */
      submittedAt: z.string().nullish(),
      url: z.string().nullish()
    })
  )
})

export type DetailPayload = z.infer<typeof DetailPayloadSchema>

/**
 * What the GraphQL query for review threads sends.
 *
 * A separate call because no `--json` field carries inline comments, and it is
 * worth the round trip for one field the REST equivalent does not have:
 * `isResolved`. A settled thread shown as an open remark is how a reviewer's
 * finished work gets handed to the agent again.
 */
export const ThreadsPayloadSchema = z.object({
  data: z.object({
    node: z.object({
      reviewThreads: z.object({
        nodes: z.array(
          z.object({
            isResolved: z.boolean(),
            comments: z.object({
              nodes: z.array(
                z.object({
                  id: z.string(),
                  author: AuthorSchema,
                  body: z.string(),
                  createdAt: z.string(),
                  url: z.string(),
                  diffHunk: z.string(),
                  path: z.string(),
                  line: z.number().int().nullish()
                })
              )
            })
          })
        )
      })
    })
  })
})

export type ThreadsPayload = z.infer<typeof ThreadsPayloadSchema>

/**
 * A review, where there is one worth showing.
 *
 * Two are dropped, and neither is an edge case. A review with no `submittedAt`
 * is the viewer's own unfinished draft, which GitHub lists and nobody else can
 * see. And GitHub records a review for every batch of inline notes, including
 * the ones whose author wrote nothing themselves — those arrive as `COMMENTED`
 * with an empty body, and drawn they are a nameless empty bubble sitting above
 * the notes it contains. A verdict is worth showing without a body; a remark is
 * not.
 *
 * `flatMap` over a filter and a map, because the filter would not narrow
 * `submittedAt` for the map that followed it — and a default date standing in
 * for one a guard has already proved is there is a lie the next reader believes.
 */
function review(entry: DetailPayload['reviews'][number]): PullRequestComment[] {
  const submittedAt = entry.submittedAt
  if (submittedAt === null || submittedAt === undefined) return []

  const verdict = VERDICTS[entry.state] ?? 'commented'
  if (entry.body.trim() === '' && verdict === 'commented') return []

  return [
    {
      kind: 'review',
      id: entry.id,
      author: entry.author?.login ?? null,
      body: entry.body,
      createdAt: submittedAt,
      url: link(entry.url),
      verdict
    }
  ]
}

/** Everything anybody said, in the order they said it. */
function comments(view: DetailPayload, threads: ThreadsPayload): PullRequestComment[] {
  const issues: PullRequestComment[] = view.comments.map((comment) => ({
    kind: 'issue',
    id: comment.id,
    author: comment.author?.login ?? null,
    body: comment.body,
    createdAt: comment.createdAt,
    url: comment.url
  }))

  const reviews: PullRequestComment[] = view.reviews.flatMap(review)

  const inline: PullRequestComment[] = threads.data.node.reviewThreads.nodes.flatMap((thread) =>
    thread.comments.nodes.map((comment) => ({
      kind: 'inline' as const,
      id: comment.id,
      author: comment.author?.login ?? null,
      body: comment.body,
      createdAt: comment.createdAt,
      url: comment.url,
      path: comment.path,
      line: comment.line ?? null,
      quote: comment.diffHunk,
      resolved: thread.isResolved
    }))
  )

  return [...issues, ...reviews, ...inline].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** The two replies, as one thing the pane can draw. */
export function toPullRequestDetail(
  view: DetailPayload,
  threads: ThreadsPayload
): PullRequestDetail {
  return {
    state: STATES[view.state],
    title: view.title,
    url: view.url,
    draft: view.isDraft,
    checks: toChecks(view.statusCheckRollup),
    comments: comments(view, threads),
    decision: DECISIONS[view.reviewDecision] ?? null,
    // Unknown is treated as unknown and nowhere as conflicting: GitHub computes
    // mergeability asynchronously, so the first read after every push says
    // `UNKNOWN`, and refusing to merge on it refuses a request that is fine.
    mergeable: MERGEABLE[view.mergeable] ?? 'unknown',
    mergeState: MERGE_STATES[view.mergeStateStatus] ?? 'unknown'
  }
}

// ─── every branch of a project at once ───────────────────────────────────────

/**
 * One branch's request, as the workspace list draws it.
 *
 * Read for a whole project in a single call rather than per workspace: the mark
 * is wanted on every row at once, and a read per row is a network call per row
 * every time the list refreshes.
 */
export interface BranchRequest {
  readonly branch: string
  readonly number: number
  readonly state: PullRequestState
  readonly checks: ChecksSummary
  readonly url: string
}

export const BranchListSchema = z.array(
  z.object({
    headRefName: z.string(),
    number: z.number().int(),
    state: RemoteStateSchema,
    url: z.string(),
    statusCheckRollup: RollupSchema
  })
)

export type BranchListPayload = z.infer<typeof BranchListSchema>

/**
 * The newest request per branch.
 *
 * `gh` lists most recent first, and a branch opened, closed and opened again
 * has more than one — the current one is what a mark beside it is about, so the
 * first seen wins and the rest are dropped.
 */
export function toBranchRequests(payload: BranchListPayload): BranchRequest[] {
  const seen = new Set<string>()
  const requests: BranchRequest[] = []

  for (const entry of payload) {
    if (seen.has(entry.headRefName)) continue
    seen.add(entry.headRefName)

    requests.push({
      branch: entry.headRefName,
      number: entry.number,
      state: STATES[entry.state],
      checks: summariseChecks(toChecks(entry.statusCheckRollup)),
      url: entry.url
    })
  }

  return requests
}
