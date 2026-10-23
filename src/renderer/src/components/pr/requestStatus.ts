import type { InstructionKind } from '@core/instructions.js'
import type {
  MergeState,
  PullRequestCheck,
  PullRequestDetail,
  PullRequestState
} from '@core/pullRequestShapes.js'

/** The prepared messages this pane sends; the other kinds belong elsewhere. */
export type PromptKind = Extract<
  InstructionKind,
  'fixChecks' | 'addressReview' | 'resolveConflicts' | 'review' | 'multiAgentReview'
>

/** The three views of a request, which the pane shows one at a time. */
export type RequestView = 'checks' | 'review' | 'merge'

/**
 * GitHub's own reasons for holding a request, where one is worth saying.
 *
 * `clean`, `hasHooks` and `unknown` say nothing: the first two are fine and the
 * third is GitHub still working it out, which `settling` says instead. `dirty`
 * is the conflict, which is said from `mergeable`.
 */
export type GitHubNote = Extract<MergeState, 'blocked' | 'behind' | 'unstable'>

const NOTES: ReadonlySet<MergeState> = new Set<GitHubNote>(['blocked', 'behind', 'unstable'])

function isNote(state: MergeState): state is GitHubNote {
  return NOTES.has(state)
}

/**
 * Where the checks stand, as one answer.
 *
 * `skipped` is a suite whose every job a path filter skipped: nothing failed,
 * and nothing passed either. The sidebar's `summariseChecks` folds it into
 * passed, because its mark only answers "is anything wrong"; the pane's tile
 * names what CI actually said.
 */
export type ChecksVerdict = 'failed' | 'running' | 'passed' | 'skipped' | 'none'

/**
 * Whether the request would merge, as one answer, most decisive first.
 *
 * - `conflict`, `draft`, `checks` hold the button;
 * - `held` is GitHub refusing for a reason of its own (a required review, a
 *   branch behind its base), and `settling` is GitHub not having worked it out
 *   yet — both still take a press, since `gh` turns one into auto-merge;
 * - `ready` is the only one that says so.
 */
export type MergeVerdict =
  'merged' | 'closed' | 'conflict' | 'draft' | 'checks' | 'held' | 'settling' | 'ready'

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
  | { readonly kind: 'settling' }

export interface RequestStatus {
  /** The detail's copy, which is the fresher read of the two. */
  readonly state: PullRequestState
  /** The checks that went red, which is what the fix prompt is about. */
  readonly failedChecks: readonly PullRequestCheck[]
  readonly running: number
  readonly checks: ChecksVerdict
  readonly merge: MergeVerdict
  /** GitHub has said there is no conflict — not merely not said there is one. */
  readonly noConflicts: boolean
  /** Whether the merge button takes a press, apart from a merge already in flight. */
  readonly canMerge: boolean
  /**
   * The prepared messages this moment calls for, most pressing first. The two
   * reviews are always on offer and are the menu's to add.
   */
  readonly offered: readonly PromptKind[]
  /**
   * What wants doing, most pressing first — the order is what the footer's one
   * line reads from, so the work in this checkout comes before what GitHub
   * says about the work already there.
   *
   * Every verdict but `ready` puts a reason here, so an open request with an
   * empty list is one that is ready to merge.
   */
  readonly attention: readonly Attention[]
  /** The view that answers the question the request is asking when it is opened. */
  readonly recommendedView: RequestView
}

/**
 * Everything the pane decides about a request, in one place.
 *
 * The tiles, the list of conditions and the footer each draw a part of this,
 * and they used to each decide for themselves — three spellings of "is it
 * ready" are three things that can drift apart, and two of them had.
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
  const passed = detail.checks.some((check) => check.state === 'passed')
  const checks: ChecksVerdict =
    failed > 0
      ? 'failed'
      : running > 0
        ? 'running'
        : passed
          ? 'passed'
          : detail.checks.length > 0
            ? 'skipped'
            : 'none'
  const waiting = checks === 'failed' || checks === 'running'
  const conflicting = detail.mergeable === 'conflicting'
  const settling = detail.mergeable === 'unknown' || detail.mergeState === 'unknown'
  const held = detail.mergeState === 'blocked' || detail.mergeState === 'behind'
  const reviewed = detail.decision === 'changesRequested' || hasRemarks(detail)

  /* A conflict and a draft are refusals GitHub would make anyway. A red or
     running check is not — GitHub merges over one nobody marked required, and
     turns a press during a run into auto-merge — so that one is a policy
     octopus keeps rather than a refusal it is predicting. */
  const merge: MergeVerdict =
    detail.state !== 'open'
      ? detail.state
      : conflicting
        ? 'conflict'
        : detail.draft
          ? 'draft'
          : waiting
            ? 'checks'
            : held
              ? 'held'
              : settling
                ? 'settling'
                : 'ready'

  const offered: PromptKind[] = []
  /* A request that is merged or closed has nothing left to do to it. The
     prompts would still run, but "fix the checks" on a merged branch is a
     reading of history rather than of a change. */
  if (open) {
    if (failed > 0) offered.push('fixChecks')
    if (reviewed) offered.push('addressReview')
    if (conflicting) offered.push('resolveConflicts')
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
    if (isNote(detail.mergeState) && !conflicting && !waiting) {
      attention.push({ kind: 'githubNote', note: detail.mergeState })
    }
    if (merge === 'settling') attention.push({ kind: 'settling' })
  }

  return {
    state: detail.state,
    failedChecks,
    running,
    checks,
    merge,
    noConflicts: detail.mergeable === 'mergeable',
    canMerge: merge === 'held' || merge === 'settling' || merge === 'ready',
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
