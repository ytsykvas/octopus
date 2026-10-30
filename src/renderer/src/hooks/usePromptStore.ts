import { useCallback, useEffect, useMemo, useState } from 'react'

import type { Prompt, PromptDraft } from '@core/promptSchema.js'
import type { Store } from '@core/stores.js'

import type { Result } from '../../../preload/index.js'
import { useErrorMessage } from './useErrorMessage.js'

export interface PromptStoreController {
  readonly prompts: readonly Prompt[]
  /** The last failure in words, or null; cleared by the next write that works. */
  readonly error: string | null
  readonly create: (draft: PromptDraft) => Promise<boolean>
  readonly update: (id: string, draft: PromptDraft) => Promise<boolean>
  readonly remove: (id: string) => Promise<void>
  /** The whole new order, as a drop gives it. */
  readonly reorder: (orderedIds: readonly string[]) => Promise<void>
}

/**
 * One store's saved prompts, and the four things a settings section does to
 * them.
 *
 * The shape `useLibraryStore` has, for the same reasons: a component laying out
 * a list should not also know what an IPC failure looks like, and the list is
 * read again after every write rather than patched from the answer — disk is
 * the thing being edited. Read again after a **refused** write too: the usual
 * reason is a prompt that is no longer there, and the list should say so.
 *
 * `projectId` is taken apart from the store and put back together in a
 * `useMemo` because the caller builds the object inline on every render, and an
 * identity check would read the list again on each one.
 */
export function usePromptStore(store: Store): PromptStoreController {
  const [prompts, setPrompts] = useState<readonly Prompt[]>([])
  const [error, setError] = useState<string | null>(null)
  const describeFailure = useErrorMessage()

  const projectId = store.kind === 'project' ? store.projectId : null
  const target = useMemo<Store>(
    () => (projectId === null ? { kind: 'global' } : { kind: 'project', projectId }),
    [projectId]
  )

  const refresh = useCallback(async () => {
    const answer = await window.octopus.prompts.list(target)
    if (answer.ok) setPrompts(answer.value)
    else setError(describeFailure(answer))
  }, [target, describeFailure])

  // Its own copy of the read, with the abandon check: an effect that called
  // `refresh` would be a `setState` in an effect as far as the lint can tell, and
  // the abandon check is only wanted here — a write is awaited by its caller.
  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const answer = await window.octopus.prompts.list(target)
      if (controller.signal.aborted) return

      if (answer.ok) setPrompts(answer.value)
      else setError(describeFailure(answer))
    })()

    return () => {
      controller.abort()
    }
  }, [target, describeFailure])

  const settle = useCallback(
    async (answer: Result<unknown>): Promise<boolean> => {
      setError(answer.ok ? null : describeFailure(answer))
      await refresh()

      return answer.ok
    },
    [describeFailure, refresh]
  )

  const create = useCallback(
    async (draft: PromptDraft) => settle(await window.octopus.prompts.create(target, draft)),
    [target, settle]
  )

  const update = useCallback(
    async (id: string, draft: PromptDraft) =>
      settle(await window.octopus.prompts.update(target, id, draft)),
    [target, settle]
  )

  const remove = useCallback(
    async (id: string) => {
      await settle(await window.octopus.prompts.remove(target, id))
    },
    [target, settle]
  )

  const reorder = useCallback(
    async (orderedIds: readonly string[]) => {
      await settle(await window.octopus.prompts.reorder(target, orderedIds))
    },
    [target, settle]
  )

  return { prompts, error, create, update, remove, reorder }
}
