import { useCallback, useEffect, useRef, useState } from 'react'

import type { PullRequestDetail } from '@core/pullRequestShapes.js'

import { onChatEvent } from './chatEvents.js'
import { useErrorMessage } from './useErrorMessage.js'

export interface PullRequestDetailController {
  readonly detail: PullRequestDetail | null
  /** When `detail` was read, as an ISO time; null until it has been. */
  readonly readAt: string | null
  /** Nothing has been read yet, so there is nothing to draw and no failure. */
  readonly loading: boolean
  readonly error: string | null
  /** Reads again now, which the refresh control and a finished merge both do. */
  readonly refresh: () => void
}

/**
 * How often to look again while something is still moving.
 *
 * Long enough that a tab left open is not a request a second, short enough that
 * a check finishing is noticed in the time it takes to look away and back.
 */
const INTERVAL_MS = 15_000

/**
 * How long after a turn ends before the checks are read again.
 *
 * The diff pane's own settle, for the same reason: the `result` arrives as the
 * agent's last write is still landing, and a read that beats it reports the
 * state before the push.
 */
const SETTLE_MS = 300

/**
 * Whether there is anything left to wait for.
 *
 * The mergeability half is not an afterthought. GitHub computes it
 * asynchronously, so the first read after every push says `unknown` — and a
 * request whose repository runs no CI has no pending check to wait on either.
 * Polling on the checks alone would leave both of those unknown for ever.
 */
function settling(detail: PullRequestDetail): boolean {
  return detail.checks.some((check) => check.state === 'pending') || detail.mergeable === 'unknown'
}

/**
 * The checks, the review and the mergeability of one request.
 *
 * A hook of its own rather than a field on `usePullRequest`, because the two
 * reads fail differently and each has to be able to say so. `gh pr list`
 * failing means the branch cannot be described at all and the pane should
 * blank; this one failing leaves the number, the title and the link worth
 * drawing, and only the checks missing.
 *
 * `number` is null until the branch is known to have a request, which is what
 * stops this asking about one that does not exist.
 */
export function usePullRequestDetail(
  workspaceId: string | null,
  number: number | null,
  enabled: boolean
): PullRequestDetailController {
  const describeFailure = useErrorMessage()

  const [detail, setDetail] = useState<PullRequestDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * When `detail` was read, as an ISO time.
   *
   * The one thing that tells a fresh answer from a stale one: a push from the
   * built-in terminal raises no event this hook can hear, and a pane that says
   * nothing about when it looked reads as current however old it is.
   */
  const [readAt, setReadAt] = useState<string | null>(null)

  /** Bumped to ask again, which is the whole of what `refresh` does. */
  const [nonce, setNonce] = useState(0)

  /*
   * Which request the two above describe.
   *
   * Compared during render rather than reconciled in an effect, the way
   * `usePullRequest` does it: a pane showing the previous request's checks for
   * a frame would be reporting on a branch that is not the one on screen.
   */
  const key = workspaceId === null || number === null ? null : `${workspaceId}#${String(number)}`
  const [shownKey, setShownKey] = useState(key)

  if (key !== shownKey) {
    setShownKey(key)
    setDetail(null)
    setError(null)
    setReadAt(null)
  }

  /** Rejects a reply that arrived after the request changed under it. */
  const generation = useRef(0)

  const refresh = useCallback(() => {
    setNonce((count) => count + 1)
  }, [])

  useEffect(() => {
    if (workspaceId === null || number === null || !enabled) return

    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const attempt = ++generation.current

    const read = async (): Promise<void> => {
      const result = await window.octopus.workspaces.pullRequestDetail(workspaceId, number)
      if (stopped || attempt !== generation.current) return

      if (!result.ok) {
        setError(describeFailure(result))
        return
      }

      setDetail(result.value)
      setError(null)
      setReadAt(new Date().toISOString())

      // Rescheduled from the answer rather than run on an interval: an interval
      // would stack a second read on top of one still in flight over a slow
      // connection, and there is nothing to wait for once everything has
      // settled.
      if (settling(result.value)) timer = setTimeout(() => void read(), INTERVAL_MS)
    }

    void read()

    return () => {
      stopped = true
      clearTimeout(timer)
    }
    // `nonce` is not read in here; it is what makes a refresh re-run the effect.
  }, [workspaceId, number, enabled, nonce, describeFailure])

  /*
   * Read again when a turn ends in this workspace.
   *
   * `settling` stops the poll the moment nothing is pending — and a check that
   * has **failed** is not pending. So the pane went quiet at exactly the moment
   * a fix was on its way, and an agent pushing that fix in its own worktree
   * raised nothing this hook listened to. The pane whose job is saying whether
   * the fix worked was the one that had stopped looking.
   *
   * The diff pane's subscription, in shape and in reasons: filtered on the
   * workspace rather than the chat, since any chat here writes to the same
   * worktree; on `error` as well as `result`, since a turn that failed may
   * well have pushed before it did; skipped while hidden, since the effect
   * above reads again when the tab comes back; and settled, so a read does not
   * beat the agent's last write.
   *
   * Not a poll while a check is failed, which was the other candidate: that
   * asks GitHub about an abandoned request for ever, which is what `settling`
   * exists to prevent.
   */
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (workspaceId === null || number === null) return

    const unsubscribe = onChatEvent((announced) => {
      if (announced.workspaceId !== workspaceId) return
      if (announced.event.type !== 'result' && announced.event.type !== 'error') return
      if (!enabled) return

      if (pending.current !== null) clearTimeout(pending.current)
      pending.current = setTimeout(refresh, SETTLE_MS)
    })

    return () => {
      unsubscribe()
      if (pending.current !== null) clearTimeout(pending.current)
    }
  }, [workspaceId, number, enabled, refresh])

  return {
    detail,
    readAt,
    loading: detail === null && error === null && key !== null,
    error,
    refresh
  }
}
