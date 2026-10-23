import type { InstructionKind } from '@core/instructions.js'
import type { MergeState, PullRequestCheck, PullRequestDetail } from '@core/pullRequestShapes.js'

/** The three views of a request, which the pane shows one at a time. */
export type RequestView = 'checks' | 'review' | 'merge'

/**
 * GitHub's own reasons for holding a request, where one is worth saying.
 *
 * `clean`, `hasHooks` and `unknown` say nothing: the first two are fine and the
 * third is a state GitHub is still working out, which a sentence about would
 * turn into a problem the reader cannot act on. `dirty` is the conflict, which
 * is said from `mergeable` instead.
 */
export type GitHubNote = 'blocked' | 'behind' | 'unstable'

const NOTES: Partial<Record<MergeState, GitHubNote>> = {
  blocked: 'blocked',
  behind: 'behind',
  unstable: 'unstable'
}

/**
 * One thing about an open request that wants doing, or waiting for.
 *
 * Not "blockers": work that is not committed or not pushed is something to do
 * before merging, and still does not stop a merge. Whether the merge button
 * takes a press is `canMerge` alone.
 */
export type Attention =
  | { readonly kind: 'uncommitted' }
  | { readonly kind: 'unpushed'; readonly count: number }
  /** The remote's copy cannot be counted from this checkout — see `unpushedCommits`. */
  | { readonly kind: 'unpushedUnknown' }
  | { readonly kind: 'failed'; readonly count: number }
  | { readonly kind: 'running'; readonly count: number }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'draft' }
  | { readonly kind: 'githubNote'; readonly note: GitHubNote }

export interface RequestStatus {
  readonly open: boolean
  /** The checks that went red, which is what the fix prompt is about. */
  readonly failedChecks: readonly PullRequestCheck[]
  readonly running: number
  /** A check is red or still going, and merging waits for it. */
  readonly waiting: boolean
  readonly conflicting: boolean
  /** Whether the merge button takes a press, apart from a merge already in flight. */
  readonly canMerge: boolean
  /** The prepared messages worth offering now, in the order they are drawn. */
  readonly offered: readonly InstructionKind[]
  /**
   * What wants doing, most pressing first — the order is what the footer's one
   * line reads from, so the work in this checkout comes before what GitHub
   * says about the work already there.
   */
  readonly attention: readonly Attention[]
  /** The view that answers the question the request is asking right now. */
  readonly recommendedView: RequestView
}

/**
 * Everything the pane decides about a request, in one place.
 *
 * The tiles, the list of conditions and the footer each draw a part of this,
 * and they used to each count for themselves — three spellings of "has a check
 * failed" are three things that can drift apart.
 */
export function requestStatus(
  detail: PullRequestDetail,
  workspace: {
    /** Uncommitted work here. */
    readonly dirty: boolean
    /** Commits the remote lacks; null when they cannot be counted. */
    readonly unpushedCommits: number | null
  }
): RequestStatus {
  const open = detail.state === 'open'
  const failedChecks = detail.checks.filter((check) => check.state === 'failed')
  const failed = failedChecks.length

  /* Counted rather than derived from `mergeState`, which is GitHub's summary of
     whether *required* checks are settled: a repository that marks none
     required reports itself perfectly mergeable while its whole suite is still
     going. The list is what the reader can see.

     And only what is reported holds the button: a repository that runs nothing
     has no checks at all, and waiting for checks that will never arrive would
     leave it unable to merge from here for ever. */
  const running = detail.checks.filter((check) => check.state === 'pending').length
  const waiting = failed > 0 || running > 0
  const conflicting = detail.mergeable === 'conflicting'
  const reviewed = detail.decision === 'changesRequested' || hasRemarks(detail)

  const offered: InstructionKind[] = []
  /* A request that is merged or closed has nothing left to do to it. The
     prompts would still run, but "review it" on a merged branch is a reading of
     history rather than of a change. */
  if (open) {
    if (failed > 0) offered.push('fixChecks')
    if (reviewed) offered.push('addressReview')
    if (conflicting) offered.push('resolveConflicts')
    offered.push('review', 'multiAgentReview')
  }

  const attention: Attention[] = []
  if (open) {
    const { dirty, unpushedCommits } = workspace
    if (dirty) attention.push({ kind: 'uncommitted' })
    if (unpushedCommits === null) attention.push({ kind: 'unpushedUnknown' })
    else if (unpushedCommits > 0) attention.push({ kind: 'unpushed', count: unpushedCommits })
    if (failed > 0) attention.push({ kind: 'failed', count: failed })
    if (running > 0) attention.push({ kind: 'running', count: running })
    if (conflicting) attention.push({ kind: 'conflict' })
    if (detail.draft) attention.push({ kind: 'draft' })

    /* GitHub's own reason only where the pane is not giving one of its own:
       `unstable` says merging is allowed anyway, which stops being true the
       moment a check of ours holds the button, and two sentences contradicting
       each other is worse than the quieter one. */
    const note = NOTES[detail.mergeState]
    if (note !== undefined && !conflicting && !waiting) attention.push({ kind: 'githubNote', note })
  }

  return {
    open,
    failedChecks,
    running,
    waiting,
    conflicting,
    /* A conflict and a draft are refusals GitHub would make anyway. A red or
       running check is not — GitHub merges over one nobody marked required,
       and turns a press during a run into auto-merge — so that one is a policy
       octopus keeps rather than a refusal it is predicting. */
    canMerge: open && !conflicting && !detail.draft && !waiting,
    offered,
    attention,
    recommendedView: !open ? 'merge' : waiting ? 'checks' : reviewed ? 'review' : 'merge'
  }
}

/**
 * Whether anybody has reviewed this.
 *
 * Not `decision === 'changesRequested'` alone: on a repository with no required
 * reviewers GitHub sends an empty decision essentially always, so that alone
 * would hide the prompt on exactly the projects this app is for. A resolved
 * thread does not count — somebody has already dealt with it.
 */
function hasRemarks(detail: PullRequestDetail): boolean {
  return detail.comments.some(
    (comment) => comment.kind === 'review' || (comment.kind === 'inline' && !comment.resolved)
  )
}
