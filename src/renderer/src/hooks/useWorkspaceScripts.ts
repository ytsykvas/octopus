import { useCallback, useEffect, useRef, useState } from 'react'

import type { ScriptsInWorkspace } from '@core/repoSource.js'

import type { Failure } from '../../../preload/index.js'
import { useTurnSettled } from './useTurnSettled.js'

/**
 * Which scripts each workspace would run, and whether they may.
 *
 * One answer per workspace rather than one for the project, because the
 * repository supplying a script is the one checked out in that worktree — a
 * branch may carry a different `.octopus/scripts/` from the branch beside it.
 * It is also what lets a runner left standing for another workspace keep its
 * own script instead of being handed the open project's.
 *
 * Read whole whenever the list changes, when a project's settings close — where
 * a script is usually first written — and on demand after an approval. The
 * workspace on screen alone is read again when it is opened and once an
 * agent's turn ends there, since the agent may have written one: nothing else
 * can have changed. A turn is heard only for the workspace on screen, so one
 * that ended in another is read when that one is opened.
 */
export function useWorkspaceScripts(
  workspaceIds: readonly string[],
  settingsKey: string | null,
  shownId: string | null
): {
  readonly scripts: ReadonlyMap<string, ScriptsInWorkspace>
  /**
   * Why a workspace has no entry above, where there is a reason.
   *
   * Kept rather than dropped. A repository whose settings cannot be parsed —
   * a merge left markers in them, an agent wrote half a file — resolves to
   * nothing, and without this the pane simply disabled Run and said not one
   * word about why.
   */
  readonly failures: ReadonlyMap<string, Failure>
  readonly refresh: () => void
} {
  const [scripts, setScripts] = useState<ReadonlyMap<string, ScriptsInWorkspace>>(new Map())
  const [failures, setFailures] = useState<ReadonlyMap<string, Failure>>(new Map())
  const [nonce, setNonce] = useState(0)
  const [turns, setTurns] = useState(0)
  /*
   * What the last whole read that finished was asked for. Until one has for
   * the inputs now, every pass reads whole: a switch that cut a whole read
   * short would otherwise read the shown workspace alone and leave the rest
   * unanswered.
   */
  const answered = useRef<string | null>(null)

  // Joined rather than passed as an array: a new array of the same ids every
  // render would re-read on every render.
  const key = workspaceIds.join('\u0000')

  useEffect(() => {
    const inputs = [key, settingsKey, nonce].join('\u0001')
    const whole = answered.current !== inputs
    const all = key === '' ? [] : key.split('\u0000')
    const ids = whole ? all : all.filter((id) => id === shownId)

    const controller = new AbortController()

    void (async () => {
      const answers = await Promise.all(
        ids.map(async (id) => [id, await window.octopus.workspaces.scripts(id)] as const)
      )
      if (controller.signal.aborted) return

      // Whole, the answers replace what was there; one workspace's, they join it.
      setScripts((current) => {
        const next = new Map(whole ? [] : current)
        for (const [id, answer] of answers) {
          if (answer.ok) next.set(id, answer.value)
          else next.delete(id)
        }
        return next
      })
      setFailures((current) => {
        const next = new Map(whole ? [] : current)
        for (const [id, answer] of answers) {
          if (answer.ok) next.delete(id)
          else next.set(id, answer)
        }
        return next
      })
      if (whole) answered.current = inputs
    })()

    return () => {
      controller.abort()
    }
  }, [key, settingsKey, shownId, nonce, turns])

  const refresh = useCallback(() => {
    setNonce((current) => current + 1)
  }, [])

  const rereadShown = useCallback(() => {
    setTurns((current) => current + 1)
  }, [])

  useTurnSettled(shownId, true, rereadShown)

  return { scripts, failures, refresh }
}
