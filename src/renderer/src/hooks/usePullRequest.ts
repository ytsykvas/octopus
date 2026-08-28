import { useCallback, useEffect, useRef, useState } from 'react'

import type { DraftedPullRequest } from '@core/pullRequestDraft.js'
import type { PullRequestDraft, PullRequestView } from '@core/pullRequests.js'

import { useErrorMessage } from './useErrorMessage.js'

export interface PullRequestController {
  readonly view: PullRequestView | null
  /** Nothing has been read yet, so there is nothing to draw and no failure. */
  readonly loading: boolean
  readonly error: string | null
  /** True while the request is being opened, which the button reflects. */
  readonly creating: boolean
  /** Opens one, and answers with its URL — or null when it did not. */
  readonly create: (draft: PullRequestDraft) => Promise<string | null>
  /** True while the agent is writing a title and a description. */
  readonly drafting: boolean
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
   * Null when it failed, and the reason is in `error` — the form stays as the
   * user left it, so a failure costs them nothing they had typed.
   */
  readonly draft: () => Promise<DraftedPullRequest | null>
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
 * Deliberately not kept in step with the agent the way the diff is. A turn
 * ending changes the working tree, and nothing about the working tree changes
 * whether a pull request exists; the read happens when the tab is opened, and
 * again after one is created.
 */
export function usePullRequest(
  workspaceId: string | null,
  enabled: boolean
): PullRequestController {
  const describeFailure = useErrorMessage()

  const [view, setView] = useState<PullRequestView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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

      setCreating(true)
      setActionError(null)
      const result = await window.octopus.workspaces.createPullRequest(workspaceId, draft)
      setCreating(false)

      if (!result.ok) {
        setActionError(describeFailure(result))
        return null
      }

      // Read again rather than assembling the new state here: what came back is
      // a URL, and the number, the title and whether the branch is now pushed
      // are all things the next read knows and this reply does not.
      const attempt = ++generation.current
      apply(await window.octopus.workspaces.pullRequest(workspaceId), attempt)

      return result.value
    },
    [workspaceId, apply, describeFailure]
  )

  const draft = useCallback(async (): Promise<DraftedPullRequest | null> => {
    if (workspaceId === null) return null

    setDrafting(true)
    setActionError(null)
    const result = await window.octopus.workspaces.draftPullRequest(workspaceId)
    setDrafting(false)

    if (!result.ok) {
      setActionError(describeFailure(result))
      return null
    }

    // Nothing is read again afterwards: this changed nothing on GitHub, and
    // nothing about the branch is different for having been described.
    return result.value
  }, [workspaceId, describeFailure])

  const refresh = useCallback(() => {
    setNonce((count) => count + 1)
  }, [])

  return {
    view,
    loading: view === null && error === null && workspaceId !== null,
    error,
    creating,
    create,
    drafting,
    actionError,
    draft,
    refresh
  }
}
