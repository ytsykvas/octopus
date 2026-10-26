import { useCallback, useEffect, useRef, useState } from 'react'

import type { DraftedPullRequest } from '@core/pullRequestDraft.js'
import type { PullRequestDraft, PullRequestView } from '@core/pullRequests.js'

import { useDraftState } from './pullRequestDrafts.js'
import { useErrorMessage } from './useErrorMessage.js'
import { useTurnSettled } from './useTurnSettled.js'

export interface PullRequestController {
  readonly view: PullRequestView | null
  /** Nothing has been read yet, so there is nothing to draw and no failure. */
  readonly loading: boolean
  readonly error: string | null
  /** True while the request is being opened, which the button reflects. */
  readonly creating: boolean
  /** Opens one, and answers with its URL — or null when it did not. */
  readonly create: (draft: PullRequestDraft) => Promise<string | null>
  /**
   * True while the agent is writing a title and a description.
   *
   * Read from main rather than kept here: the agent goes on writing when the
   * user looks at another workspace, and coming back has to say so.
   */
  readonly drafting: boolean
  /** What the agent wrote for this workspace, until the request is opened with it. */
  readonly drafted: DraftedPullRequest | null
  /**
   * Why the last thing asked for did not happen — drafting or opening.
   *
   * Separate from `error` on purpose. That one blanks the pane, which is right
   * only when the branch itself could not be read: nothing left on it is true.
   * Everything else leaves the form standing. Opening once used `error`, and a
   * request refused for having no commits took the agent's title and
   * description down with the form that held them.
   */
  readonly actionError: string | null
  /**
   * Asks the agent for a title and a description. Opens nothing.
   *
   * What it writes arrives as `drafted`, and why it could not as `actionError`
   * — the form stays as the user left it, so a failure costs them nothing they
   * had typed.
   */
  readonly draft: () => void
  /** Asks again: after a merge, after a commit, or on the refresh control. */
  readonly refresh: () => void
}

/**
 * What has become of a workspace's branch on GitHub.
 *
 * `enabled` is what stops `gh` running for a tab nobody is looking at — the
 * same rule the diff follows, and it matters more here: this one leaves the
 * machine, so a hidden tab would be a network call per workspace opened.
 *
 * Kept in step with the agent the way the diff is. A turn ending does not
 * change whether a pull request exists, but it does change what this pane
 * draws beside it — uncommitted work, commits ahead of the base, commits not
 * yet pushed. Read only when the tab opened, a pane left showing through a turn
 * went on saying there was nothing to open after the agent had committed, until
 * another tab was clicked and this one clicked back.
 */
export function usePullRequest(
  workspaceId: string | null,
  enabled: boolean
): PullRequestController {
  const describeFailure = useErrorMessage()

  const [view, setView] = useState<PullRequestView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const described = useDraftState(workspaceId)

  /*
   * The workspace the two above describe.
   *
   * Compared during render rather than reconciled in an effect: a pane showing
   * the previous workspace's pull request for a frame would be naming a branch
   * that is not the one on screen.
   */
  const [shownId, setShownId] = useState(workspaceId)

  if (workspaceId !== shownId) {
    setShownId(workspaceId)
    setView(null)
    setError(null)
    // What the pane was doing belonged to the workspace being left, and so did
    // anything it was about to complain about. A refusal held over is a
    // sentence about a branch nobody is looking at.
    setCreating(false)
    setActionError(null)
  }

  /** Bumped to ask again, which is the whole of what `refresh` does. */
  const [nonce, setNonce] = useState(0)

  /** Rejects a reply that arrived after the workspace changed under it. */
  const generation = useRef(0)

  const apply = useCallback(
    (
      result: Awaited<ReturnType<typeof window.octopus.workspaces.pullRequest>>,
      attempt: number
    ) => {
      if (attempt !== generation.current) return

      if (result.ok) {
        setView(result.value)
        setError(null)
        return
      }

      setView(null)
      setError(describeFailure(result))
    },
    [describeFailure]
  )

  // Read inline rather than through a callback, so nothing sets state until the
  // first await has passed.
  useEffect(() => {
    if (workspaceId === null || !enabled) return

    const controller = new AbortController()
    const attempt = ++generation.current

    void (async () => {
      const result = await window.octopus.workspaces.pullRequest(workspaceId)
      if (!controller.signal.aborted) apply(result, attempt)
    })()

    return () => {
      controller.abort()
    }
    // `nonce` is not read in here; it is what makes a refresh re-run the effect.
  }, [workspaceId, enabled, nonce, apply])

  const create = useCallback(
    async (draft: PullRequestDraft): Promise<string | null> => {
      if (workspaceId === null) return null

      // Claimed before the await, not after it, and that is the whole of the
      // guard. Claimed afterwards it beat the effect of the workspace opened
      // in the meantime — this call bumped the counter past the number that
      // effect had just taken — and wrote this workspace's request into a pane
      // drawing another's branch. `PullRequestPanel` then sent the workspace on
      // screen together with the number it was showing, so Merge would have run
      // against the wrong branch, which GitHub does not undo.
      const attempt = ++generation.current

      setCreating(true)
      setActionError(null)
      const result = await window.octopus.workspaces.createPullRequest(workspaceId, draft)
      if (attempt !== generation.current) return null

      setCreating(false)

      if (!result.ok) {
        setActionError(describeFailure(result))
        return null
      }

      // Read again rather than assembling the new state here: what came back is
      // a URL, and the number, the title and whether the branch is now pushed
      // are all things the next read knows and this reply does not.
      apply(await window.octopus.workspaces.pullRequest(workspaceId), attempt)

      return result.value
    },
    [workspaceId, apply, describeFailure]
  )

  const draft = useCallback(() => {
    if (workspaceId === null) return

    // No generation taken: nothing comes back here to be dropped. What the
    // agent writes is announced, and arrives through `useDraftState` for
    // whichever workspace it was — on screen or not.
    setActionError(null)
    void window.octopus.workspaces.draftPullRequest(workspaceId).then((result) => {
      if (!result.ok) setActionError(describeFailure(result))
    })
  }, [workspaceId, describeFailure])

  const refresh = useCallback(() => {
    setNonce((count) => count + 1)
  }, [])

  // Behind a hidden tab nothing fires; the effect above reads when it is shown.
  useTurnSettled(workspaceId, enabled, refresh)

  return {
    view,
    loading: view === null && error === null && workspaceId !== null,
    error,
    creating,
    create,
    drafting: described?.status === 'writing',
    drafted: described?.status === 'written' ? described.draft : null,
    // Opening, or a refusal to start, is newer than a description that failed
    // before it — and is what the form is waiting on. Silent while opening:
    // the user has moved past the failed description by pressing Open.
    actionError:
      actionError ??
      (described?.status === 'failed' && !creating ? describeFailure(described.failure) : null),
    draft,
    refresh
  }
}
